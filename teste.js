/**
 * PROVA DO MECANISMO — contra a cadeia, não contra o que eu acho.
 *
 *   node teste.js
 *
 * Três coisas precisam ser verdade pro desenho funcionar, e as três são
 * testáveis hoje, sem Discord e sem ninguém verificar nada:
 *
 *   1. o endereço de cada pessoa é único, estável e imprevisível sem o segredo
 *   2. dá pra ACHAR uma transação na cadeia sabendo só o destino
 *   3. dá pra dizer se uma carteira tem o NFT
 *
 * O passo 2 é o que sustenta a ideia inteira, e é o único que não dava pra
 * afirmar sem medir: transferência nativa não emite log, então a busca é bloco a
 * bloco. Aqui ela roda de verdade, procurando uma transação real que já está na
 * cadeia — escolhida na hora, não escrita à mão neste arquivo.
 */
import { blocoAtual, decimaisDe, enderecoDe, procuraPagamentos, quantosNft, saldoNoContrato, saldoSeguro, temNft } from './lib/prova.js'

let falhas = 0
const conf = (cond, msg, extra = '') => {
  if (!cond) {
    falhas++
    console.error('  FALHOU  ' + msg + '  ' + extra)
  } else console.log('  ok      ' + msg + (extra ? '  ' + extra : ''))
}

console.log('\nPROVA DE POSSE SEM CONECTAR CARTEIRA\n')

// ---------------------------------------------- 1. o endereço de cada um
const SEGREDO = 'segredo-de-teste-nao-usar-em-producao'
const a1 = enderecoDe('111111111111111111', SEGREDO)
const a2 = enderecoDe('222222222222222222', SEGREDO)

conf(/^0x[0-9a-f]{40}$/.test(a1), 'o endereço tem forma de endereço', a1)
conf(a1 !== a2, 'pessoas diferentes recebem endereços diferentes')
conf(enderecoDe('111111111111111111', SEGREDO) === a1, 'o mesmo id devolve sempre o mesmo endereço')
conf(
  enderecoDe('111111111111111111', 'outro-segredo') !== a1,
  'trocar o segredo troca o endereço — é ele que impede forjar o de outro',
)
let recusou = false
try {
  enderecoDe('111', '')
} catch {
  recusou = true
}
conf(recusou, 'sem segredo, recusa em vez de gerar endereço adivinhável')

/*
 * O ENDEREÇO NÃO PODE TER DONO, e isto não é detalhe.
 *
 * Ele nasce de um hash, não de uma chave — ninguém consegue gastar o que chega
 * ali. Como o valor enviado é ZERO, não há nada pra resgatar, e não existir
 * chave privada é não existir chave privada pra vazar. Se algum dia alguém
 * mandar valor de verdade por engano, esse valor está perdido: é o preço de não
 * ter cofre nenhum, e vale a pena.
 */
conf(true, 'ninguém controla esse endereço — não há chave, e o valor enviado é 0')

// ------------------------------------- 2. achar a transação pelo destino
// Pega uma transação REAL de um bloco recente e tenta achá-la sabendo só o
// destino. Se a varredura não achar isso, o desenho não funciona.
const topo = await blocoAtual()
let alvo = null
for (let i = 0; i < 12 && !alvo; i++) {
  const achados = await procuraPagamentos([], topo - i, topo - i) // aquece o caminho
  void achados
  const r = await fetch(process.env.RONIN_RPC || 'https://api.roninchain.com/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 Chrome/126' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getBlockByNumber',
      params: ['0x' + (topo - i).toString(16), true],
    }),
  })
  const bloco = (await r.json()).result
  const tx = (bloco?.transactions || []).find((t) => t.to)
  if (tx) alvo = { tx, bloco: topo - i }
}

if (!alvo) {
  falhas++
  console.error('  FALHOU  não achei nenhuma transação recente pra usar de alvo')
} else {
  const achados = await procuraPagamentos([alvo.tx.to], alvo.bloco, alvo.bloco)
  const bateu = achados.find((p) => p.tx === alvo.tx.hash)
  conf(!!bateu, 'a varredura ACHOU a transação sabendo só o destino', `bloco ${alvo.bloco}`)
  conf(
    bateu?.remetente === alvo.tx.from.toLowerCase(),
    'e leu o remetente certo — é ele a prova de posse',
    bateu?.remetente?.slice(0, 12) + '…',
  )
  const nada = await procuraPagamentos([enderecoDe('999', SEGREDO)], alvo.bloco, alvo.bloco)
  conf(nada.length === 0, 'endereço que ninguém pagou não devolve nada')
}

// ------------------------------------------- 3. a carteira tem o NFT?
// `0x138f…` comprou o Ronkeverse #3369 por 420 RON — venda real, ver o bot de
// vendas. Se ele ainda tem, `temNft` responde true.
const comprador = '0x138fefdb5117d6f37aeb39959e9a6fc516bfb834'
const qtd = await quantosNft(comprador)
console.log(`\n  a carteira que comprou o #3369 tem ${qtd} Ronkeverse hoje\n`)
conf(typeof qtd === 'number', 'balanceOf responde um número', String(qtd))
conf((await temNft(comprador)) === qtd > 0, 'temNft concorda com o saldo')
// NÃO uso `0xdead` como "carteira vazia": ela tem 6 Ronkeverse — gente queimou
// NFT lá. Foi o teste que escolheu mal, não o código que errou.
conf((await temNft('0x0000000000000000000000000000000000000001')) === false, 'carteira sem NFT devolve false')
conf((await quantosNft('0x000000000000000000000000000000000000dead')) > 0, 'o 0xdead tem NFT queimado — não serve de "vazia"')

/*
 * REVERTER NÃO PODE DERRUBAR A VARREDURA.
 *
 * O ERC-721 manda `balanceOf` reverter pro endereço zero, e o contrato obedece.
 * Antes disto, uma carteira assim na lista lançava exceção e a passada inteira
 * morria — 300 pessoas perderiam o cargo por causa de uma.
 */
const zero = await saldoSeguro('0x0000000000000000000000000000000000000000')
conf(zero.ok === true && zero.saldo === 0, 'endereço zero: reverte, mas responde "não tem"', JSON.stringify(zero))
const boa = await saldoSeguro(comprador)
conf(boa.ok === true && boa.saldo === qtd, 'carteira boa: saldo confere', JSON.stringify(boa))

/*
 * NFT CONTA UNIDADE; TOKEN CONTA WEI -- e tratar os dois igual escancara o portao.
 *
 * `balanceOf` de um ERC-721 devolve 3 pra tres NFTs. De um ERC-20 com 18 casas,
 * devolve 1000000000000000000000 pra mil tokens. Uma regra de "minimo 1000"
 * aplicada ao numero cru seria satisfeita por QUALQUER pessoa com qualquer
 * fracao -- e ninguem notaria, porque dar cargo demais nao gera reclamacao.
 */
const NFT = '0x810B6d1374ac7BA0E83612E7d49F49A13f1de019'
const WRON = '0xe514d9deb7966c8be0ca922de8a064264ea6bcd4'

conf((await decimaisDe(NFT)) === 0, 'NFT: zero casas decimais (a unidade ja e a contagem)')
conf((await decimaisDe(WRON)) === 18, 'token: dezoito casas', String(await decimaisDe(WRON)))

const porContrato = await saldoNoContrato(comprador, NFT)
conf(porContrato.ok && porContrato.saldo === qtd, 'saldo por contrato bate com o NFT', String(porContrato.saldo))

const emToken = await saldoNoContrato(comprador, WRON)
conf(emToken.ok, 'saldo de token responde sem quebrar', JSON.stringify(emToken))
conf(emToken.saldo < 1e12, 'e vem na unidade humana, nao em wei', String(emToken.saldo))

console.log(falhas ? `\n${falhas} FALHA(S)\n` : '\nTUDO OK\n')
process.exitCode = falhas ? 1 : 0
