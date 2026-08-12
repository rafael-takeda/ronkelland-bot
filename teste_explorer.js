/**
 * PROVA DA BUSCA PELO EXPLORER.
 *
 *   node teste_explorer.js            só a lógica (rede dublada)
 *   node teste_explorer.js --rede     também bate na API de verdade
 *
 * A busca por bloco tinha dois defeitos que se combinaram num estrago real: era
 * cara (429 derrubou a varredura) e só enxergava a janela varrida (pagamento que
 * caiu com a varredura parada ficava pra trás pra sempre, e a pessoa perdia o
 * gas sem ganhar cargo nem receber aviso).
 *
 * O explorer resolve os dois. Mas ele é um índice de terceiro, e o que está em
 * jogo é conceder cargo — então metade destes testes é sobre ele NÃO ser a
 * autoridade.
 */
import { pagamentosPara } from './lib/prova.js'

let falhas = 0
const conf = (c, m, e = '') => {
  if (!c) {
    falhas++
    console.error('  FALHOU  ' + m + '  ' + e)
  } else console.log('  ok      ' + m + (e ? '  ' + e : ''))
}

const ALVO = '0x89664d4d04d00cc95ab65c73df63512365f658a1'
const PAGADOR = '0xc24566e78709ce989db5211bb088ead4dce81b74'
const HASH = '0xf9e47b6b16c704bbf5ef109af7ef8c1d9df419bfd313bed60b7cf2bf17baf133'
const original = globalThis.fetch

const json = (c, status = 200) =>
  new Response(JSON.stringify(c), { status, headers: { 'Content-Type': 'application/json' } })

/** `naCadeia` é o que o RPC responde pra `eth_getTransactionByHash`. */
function rede({ noExplorer, naCadeia, explorerQuebrado }) {
  const conta = { explorer: 0, rpc: 0 }
  globalThis.fetch = async (url, opcoes) => {
    if (String(url).includes('explorer')) {
      conta.explorer++
      if (explorerQuebrado) return json({}, 503)
      return json({ message: 'OK', result: noExplorer })
    }
    conta.rpc++
    return json({ result: naCadeia })
  }
  return conta
}

const txExplorer = (extra = {}) => ({
  to: ALVO,
  from: PAGADOR,
  hash: HASH,
  value: '10000000000000',
  blockNumber: '59542570',
  timeStamp: String(Math.floor(Date.now() / 1000)),
  isError: '0',
  ...extra,
})

const txCadeia = (extra = {}) => ({ to: ALVO, from: PAGADOR, hash: HASH, blockNumber: '0x38c3d0a', ...extra })

console.log('\nA BUSCA PELO EXPLORER\n')

// ------------------------------------------------------------ caminho feliz
let conta = rede({ noExplorer: [txExplorer()], naCadeia: txCadeia() })
let r = await pagamentosPara(ALVO, Date.now() - 600_000)
conf(r.ok && r.achados.length === 1, 'acha o pagamento', `${r.achados.length}`)
conf(r.achados[0].remetente === PAGADOR, 'e o REMETENTE é a prova', r.achados[0]?.remetente)
conf(conta.explorer === 1, 'uma chamada ao explorer, não uma por bloco', `${conta.explorer}`)

conta = rede({ noExplorer: [], naCadeia: null })
r = await pagamentosPara(ALVO, Date.now() - 600_000)
conf(r.ok && r.achados.length === 0, 'ninguém pagou ainda: lista vazia é RESPOSTA, não erro')
conf(conta.rpc === 0, 'e nem toca o RPC quando não há o que conferir')

/* ==========================================================================
 * O EXPLORER APONTA. A CADEIA DECIDE.
 * ==========================================================================
 * Ele é um índice mantido por terceiro. Se ele bastasse, um índice comprometido
 * concederia cargo a qualquer um — bastaria inventar uma transação.
 */
console.log('\nO EXPLORER NÃO É A AUTORIDADE\n')

conta = rede({ noExplorer: [txExplorer()], naCadeia: null })
r = await pagamentosPara(ALVO, Date.now() - 600_000)
conf(r.achados.length === 0, 'transação que o RPC não conhece NÃO vale')
conf(conta.rpc === 1, 'e ela foi de fato conferida no RPC', `${conta.rpc} chamada`)

/*
 * O CASO QUE MAIS IMPORTA: o explorer diz que o pagamento foi pro endereço da
 * pessoa, mas a cadeia diz que foi pra outro lugar. Se isso passasse, qualquer
 * transação do mundo viraria prova de qualquer verificação.
 */
conta = rede({
  noExplorer: [txExplorer()],
  naCadeia: txCadeia({ to: '0x9999999999999999999999999999999999999999' }),
})
r = await pagamentosPara(ALVO, Date.now() - 600_000)
conf(r.achados.length === 0, 'explorer mentindo sobre o DESTINO não concede nada')

/*
 * E o remetente sai da CADEIA, nunca do explorer. É ele que vira a carteira
 * amarrada — trocá-lo daria o cargo a quem não pagou.
 */
conta = rede({
  noExplorer: [txExplorer({ from: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' })],
  naCadeia: txCadeia(),
})
r = await pagamentosPara(ALVO, Date.now() - 600_000)
conf(r.achados[0]?.remetente === PAGADOR, 'o remetente vem da cadeia, não do explorer', r.achados[0]?.remetente)

// ----------------------------------------------------------------- filtros
console.log('\nO QUE ELE DESCARTA\n')

conta = rede({ noExplorer: [txExplorer({ isError: '1' })], naCadeia: txCadeia() })
conf((await pagamentosPara(ALVO, Date.now() - 600_000)).achados.length === 0, 'transação que falhou não conta')

conta = rede({ noExplorer: [txExplorer({ to: '0x1111111111111111111111111111111111111111' })], naCadeia: txCadeia() })
conf((await pagamentosPara(ALVO, Date.now() - 600_000)).achados.length === 0, 'transação que SAIU do endereço não conta')

/*
 * PAGAMENTO ANTIGO NÃO REVALIDA. Sem este corte, quem pagou uma vez ficaria
 * verificado pra sempre a cada clique — e a prova deixaria de ser "mandei agora"
 * pra virar "mandei um dia".
 */
conta = rede({
  noExplorer: [txExplorer({ timeStamp: String(Math.floor(Date.now() / 1000) - 86400) })],
  naCadeia: txCadeia(),
})
conf((await pagamentosPara(ALVO, Date.now() - 600_000)).achados.length === 0, 'pagamento de ontem não revalida hoje')

// --------------------------------------------------------- explorer caído
console.log('\nQUANDO O EXPLORER CAI\n')

conta = rede({ explorerQuebrado: true })
r = await pagamentosPara(ALVO, Date.now() - 600_000)
conf(r.ok === false, 'explorer fora do ar devolve ok:false')
conf(r.achados.length === 0, 'e nada de achados')
console.log('          (o ciclo cai na varredura de blocos — lenta e míope, mas sem terceiro)')

globalThis.fetch = original

// ------------------------------------------------------------- de verdade
if (process.argv.includes('--rede')) {
  console.log('\n  --- contra a API de verdade ---')
  const t = Date.now()
  const vivo = await pagamentosPara(ALVO, 0)
  conf(vivo.ok, 'o explorer responde', `${Date.now() - t} ms`)
  conf(vivo.achados.length >= 1, 'e acha o pagamento real, confirmado na cadeia', `${vivo.achados.length}`)
  if (vivo.achados[0]) conf(vivo.achados[0].remetente === PAGADOR, 'com o remetente certo')

  const virgem = await pagamentosPara('0x1111111111111111111111111111111111111199', 0)
  conf(virgem.ok && virgem.achados.length === 0, 'endereço que nunca recebeu nada não é erro')
}

console.log(falhas ? `\n${falhas} FALHA(S)\n` : '\nTUDO OK\n')
process.exitCode = falhas ? 1 : 0
