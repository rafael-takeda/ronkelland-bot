/**
 * PROVA DA BUSCA PELO SALDO.
 *
 *   node teste_saldo.js            só a lógica (cadeia dublada)
 *   node teste_saldo.js --rede     também acha o pagamento real de 14/10/2026
 *
 * Em 14/10/2026 o explorer disse "nenhuma transação" por cinco minutos com o
 * pagamento de um membro na cadeia, e ele ouviu "I do not see your transaction
 * yet" até a janela fechar. A busca pelo saldo só pergunta ao nó: o endereço
 * derivado não tem dono, então o saldo só sobe, e cada subida é um pagamento.
 */
import { pagamentoDe, pagamentoNaCadeia } from './lib/prova.js'

let falhas = 0
const conf = (c, m, e = '') => {
  if (!c) {
    falhas++
    console.error('  FALHOU  ' + m + '  ' + e)
  } else console.log('  ok      ' + m + (e ? '  ' + e : ''))
}

const ALVO = '0x89664d4d04d00cc95ab65c73df63512365f658a1'
const CERTA = '0xaaaa000000000000000000000000000000000001'
const ERRADA = '0xbbbb000000000000000000000000000000000002'
const TOPO = 60_000_000
const original = globalThis.fetch

const json = (c, status = 200) =>
  new Response(JSON.stringify(c), { status, headers: { 'Content-Type': 'application/json' } })

/**
 * A cadeia de mentira. `pagas` são os pagamentos ao ALVO, `{ de, bloco, hash }`;
 * `porContrato` põe o RON no saldo sem transação pro endereço no bloco, que é o
 * que acontece quando ele chega por dentro de um contrato. `quebra` derruba um
 * método do RPC. `explorer` é o que o índice responde.
 */
function cadeia({ pagas = [], quebra = null, explorer = [] } = {}) {
  const conta = { rpc: 0, blocos: 0, explorer: 0 }
  globalThis.fetch = async (url, opcoes) => {
    if (String(url).includes('explorer')) {
      conta.explorer++
      return json({ message: 'OK', result: explorer })
    }
    conta.rpc++
    const { method, params } = JSON.parse(opcoes.body)
    if (method === quebra) return json({ jsonrpc: '2.0', id: 1, error: { message: 'missing trie node' } })
    if (method === 'eth_blockNumber') return json({ result: '0x' + TOPO.toString(16) })
    if (method === 'eth_getBalance') {
      const n = Number(BigInt(params[1]))
      return json({ result: '0x' + pagas.filter((p) => p.bloco <= n).length.toString(16) })
    }
    if (method === 'eth_getBlockByNumber') {
      conta.blocos++
      const n = Number(BigInt(params[0]))
      const transactions = pagas
        .filter((p) => p.bloco === n && !p.porContrato)
        .map((p) => ({ hash: p.hash, from: p.de, to: ALVO, value: '0x1' }))
      return json({ result: { number: params[0], transactions } })
    }
    if (method === 'eth_getTransactionByHash') {
      const t = explorer.find((x) => x.hash === params[0])
      return json({ result: t ? { to: t.to, from: t.from, hash: t.hash, blockNumber: '0x1' } : null })
    }
    return json({ result: '0x0' })
  }
  return conta
}

const janela = () => Date.now() - 10 * 60_000

console.log('\nA BUSCA PELO SALDO\n')

let conta = cadeia()
let r = await pagamentoNaCadeia(ALVO, janela())
conf(r.ok && r.achados.length === 0, 'ninguém pagou: lista vazia é resposta, não erro')
conf(conta.rpc === 3, 'e custa 3 chamadas: o topo e o saldo nas duas pontas', `${conta.rpc}`)

conta = cadeia({ pagas: [{ de: CERTA, bloco: TOPO - 100, hash: '0x01' }] })
r = await pagamentoNaCadeia(ALVO, janela())
conf(r.ok && r.achados.length === 1, 'acha o pagamento da janela')
conf(r.achados[0]?.remetente === CERTA, 'e o remetente é quem assinou a transação', r.achados[0]?.remetente)
conf(r.achados[0]?.bloco === TOPO - 100, 'no bloco certo', String(r.achados[0]?.bloco))
conf(conta.rpc <= 14, 'em até 14 chamadas pra uma janela de 10 minutos', `${conta.rpc}`)
conf(conta.blocos === 1, 'abrindo UM bloco, não a janela inteira', `${conta.blocos}`)

/* A pessoa mandou da carteira errada, percebeu e mandou da certa. */
cadeia({
  pagas: [
    { de: ERRADA, bloco: TOPO - 250, hash: '0x02' },
    { de: CERTA, bloco: TOPO - 40, hash: '0x03' },
  ],
})
r = await pagamentoNaCadeia(ALVO, janela())
conf(r.achados.length === 1 && r.achados[0].remetente === CERTA, 'dois pagamentos na janela: fica o MAIS NOVO', r.achados[0]?.remetente)

/* Mandei um dia não é mandei agora: pagamento de antes da janela não revalida. */
cadeia({ pagas: [{ de: CERTA, bloco: TOPO - 5000, hash: '0x04' }] })
r = await pagamentoNaCadeia(ALVO, janela())
conf(r.ok && r.achados.length === 0, 'pagamento de antes da janela não conta')

cadeia({ pagas: [{ de: CERTA, bloco: TOPO - 30, hash: '0x05', porContrato: true }] })
r = await pagamentoNaCadeia(ALVO, janela())
conf(r.ok && r.achados.length === 0 && r.viaContrato === true, 'RON que chegou por contrato: viaContrato, sem carteira nenhuma')

console.log('\nQUANDO O NÓ FALHA\n')

cadeia({ pagas: [{ de: CERTA, bloco: TOPO - 100, hash: '0x01' }], quebra: 'eth_getBalance' })
r = await pagamentoNaCadeia(ALVO, janela())
conf(r.ok === false, 'nó sem saldo histórico: ok:false, nunca "ninguém pagou"')

cadeia({ pagas: [{ de: CERTA, bloco: TOPO - 100, hash: '0x01' }], quebra: 'eth_getBlockByNumber' })
r = await pagamentoNaCadeia(ALVO, janela())
conf(r.ok === false, 'bloco que não abre: ok:false')

console.log('\nA CADEIA PRIMEIRO, O EXPLORER DE RESERVA\n')

const doExplorer = {
  to: ALVO,
  from: ERRADA,
  hash: '0x06',
  value: '1',
  isError: '0',
  timeStamp: String(Math.floor(Date.now() / 1000)),
}

conta = cadeia({ explorer: [doExplorer] })
r = await pagamentoDe(ALVO, janela())
conf(r.ok && r.achados.length === 0 && r.fonte === 'saldo', 'se o nó diz que ninguém pagou, vale o nó', r.fonte)
conf(conta.explorer === 0, 'e o explorer nem é consultado', `${conta.explorer}`)

conta = cadeia({ quebra: 'eth_getBalance', explorer: [doExplorer] })
r = await pagamentoDe(ALVO, janela())
conf(r.ok && r.achados[0]?.remetente === ERRADA && r.fonte === 'explorer', 'nó falhou: o explorer responde, conferido no RPC', r.fonte)

globalThis.fetch = original

/*
 * DE VERDADE. Depende do nó guardar o saldo histórico até a manhã de 14/10, e
 * isso foi medido (18 mil blocos pra trás) mas não é promessa de ninguém. Confere
 * a carteira e não a transação: se o membro refizer a verificação, o pagamento
 * mais novo muda, a carteira que tem o NFT não.
 */
if (process.argv.includes('--rede')) {
  console.log('\n  --- contra a cadeia de verdade ---')
  const t = Date.now()
  const vivo = await pagamentoNaCadeia('0x4aa047a425abe41ab295b2cd798fa1b1218cc76e', Date.parse('2026-10-14T03:50:00Z'))
  conf(vivo.ok, 'o nó responde o saldo histórico', `${Date.now() - t} ms`)
  conf(
    vivo.achados[0]?.remetente === '0x69099fcd1acee9601372e434d514ad8a692be4b8',
    'e acha o pagamento que o explorer não achou, com o remetente certo',
    vivo.achados[0]?.tx,
  )
}

console.log(falhas ? `\n${falhas} FALHA(S)\n` : '\nTUDO OK\n')
process.exitCode = falhas ? 1 : 0
