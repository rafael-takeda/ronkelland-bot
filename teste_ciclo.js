/**
 * PROVA DO CICLO — a lógica que decide quem ganha e quem perde cargo.
 *
 *   node teste_ciclo.js
 *
 * Aqui não há Discord nem Redis: as dependências são trocadas por versões de
 * mentira, e o que está sob teste é a DECISÃO. É onde um erro custa caro e não
 * aparece — dar cargo demais ninguém reclama, e tirar cargo de quem não devia
 * o membro nem entende.
 */
import { cargosPara, decideCargos } from './lib/regras.js'
import { medidasDe } from './lib/ciclo.js'
import { esqueceTudo } from './lib/score.js'
import { avisaDepois } from './lib/discord.js'
import { msg } from './lib/mensagens.js'

let falhas = 0
const conf = (c, m, e = '') => {
  if (!c) {
    falhas++
    console.error('  FALHOU  ' + m + '  ' + e)
  } else console.log('  ok      ' + m + (e ? '  ' + e : ''))
}

console.log('\nCICLO: QUEM GANHA E QUEM PERDE CARGO\n')

const NFT = '0x810b6d1374ac7ba0e83612e7d49f49a13f1de019'
const TOK = '0xf988f63bf26c3ed3fbf39922149e3e7b1e5c27cb'
const HOLDER = '111111111111111111'
const WHALE = '222222222222222222'
const MOD = '999999999999999999'

const REGRAS = [
  { contrato: NFT, cargo: HOLDER, minimo: 1, casas: 0, nome: 'Ronkeverse Holder' },
  { contrato: NFT, cargo: WHALE, minimo: 10, casas: 0, nome: 'Ronkeverse Whale' },
  { contrato: TOK, cargo: HOLDER, minimo: 100, casas: 18, nome: '$RONKE Holder' },
]

// ------------------------------------------------- o caminho de todo dia
conf(
  decideCargos({ [NFT]: 1, [TOK]: 0 }, REGRAS, []).dar.join() === HOLDER,
  'um NFT: ganha Holder',
)
conf(
  decideCargos({ [NFT]: 0, [TOK]: 500 }, REGRAS, []).dar.join() === HOLDER,
  'só token acima do mínimo: ganha Holder pelo outro caminho',
)
conf(
  decideCargos({ [NFT]: 0, [TOK]: 50 }, REGRAS, []).dar.length === 0,
  'token abaixo do mínimo: não ganha',
)
conf(
  decideCargos({ [NFT]: 12, [TOK]: 0 }, REGRAS, []).dar.length === 2,
  'doze NFTs: Holder e Whale',
)
conf(
  decideCargos({ [NFT]: 0, [TOK]: 0 }, REGRAS, [HOLDER, WHALE]).tirar.length === 2,
  'vendeu tudo: perde os dois',
)

/*
 * O CARGO QUE NÃO É DELE. Quem vende o NFT perde o Holder e MANTÉM a moderação.
 * Sem essa trava, um bot de verificação num servidor de terceiros seria uma
 * bomba — e o estrago seria em cargos que ninguém pediu pra ele tocar.
 */
const comMod = decideCargos({ [NFT]: 0, [TOK]: 0 }, REGRAS, [HOLDER, MOD])
conf(comMod.tirar.join() === HOLDER, 'tira só o Holder')
conf(!comMod.tirar.includes(MOD), 'não encosta na moderação')

/*
 * O MESMO CARGO POR DOIS CAMINHOS. Quem tem NFT e token não pode "perder" o
 * Holder porque uma das duas condições caiu — basta uma valer.
 */
const doisCaminhos = decideCargos({ [NFT]: 1, [TOK]: 500 }, REGRAS, [HOLDER])
conf(
  doisCaminhos.dar.length === 0 && doisCaminhos.tirar.length === 0,
  'NFT e token ao mesmo tempo: nada muda',
)
const soUm = decideCargos({ [NFT]: 0, [TOK]: 500 }, REGRAS, [HOLDER])
conf(soUm.tirar.length === 0, 'caiu o NFT mas o token segura o cargo')

/*
 * QUANDO O RPC NÃO RESPONDE, NÃO SE TIRA NADA.
 *
 * `aplicaCargos` zera a lista de remoção se algum contrato ficou incerto. Este
 * teste reproduz a decisão: com saldo desconhecido tratado como zero, a pessoa
 * perderia o cargo — e o motivo seria uma piscada de rede, não uma venda.
 */
const comoSeFosseZero = decideCargos({ [NFT]: 0, [TOK]: 0 }, REGRAS, [HOLDER])
conf(comoSeFosseZero.tirar.length === 1, 'tratando incerto como zero, ele TIRARIA o cargo')
console.log('          (por isso `aplicaCargos` zera a remoção quando há contrato incerto)')

/* ==========================================================================
 * AS MEDIDAS — quantas perguntas o bot faz, e quais
 * ==========================================================================
 * Aqui a rede inteira é dublada num ponto só: `fetch`. O RPC da Ronin e a API do
 * score passam os dois por ele, então dá pra CONTAR o que foi perguntado — e é a
 * contagem que interessa, porque o custo desta parte é chamada de rede.
 */
console.log('\nAS MEDIDAS: QUANTAS PERGUNTAS, E QUAIS\n')

const LORD = '333333333333333333'
const SABIO = '444444444444444444'
const UM_DE_UM = [14, 24, 777]

const COMPLETO = [
  { contrato: TOK, cargo: HOLDER, tipo: 'ERC-20', casas: 18, minimo: 1, nome: 'Ronke Holder' },
  { contrato: TOK, cargo: WHALE, tipo: 'ERC-20', casas: 18, minimo: 1000000, nome: 'Ronke Chad' },
  { contrato: NFT, cargo: '555555555555555555', tipo: 'ERC-721', casas: 0, minimo: 1, nome: 'Ronkeverse' },
  { contrato: NFT, cargo: LORD, tipo: 'ERC-721-ids', ids: UM_DE_UM, nome: 'Ronke Lord' },
  { cargo: SABIO, tipo: 'score', minimo: 2000, nome: 'Ronke Sage' },
]

const CARTEIRA = '0xabcdef0123456789abcdef0123456789abcdef01'
const original = globalThis.fetch
const hex = (n) => '0x' + BigInt(n).toString(16).padStart(64, '0')
const endereco32 = (a) => '0x' + a.replace(/^0x/, '').padStart(64, '0')

/**
 * Rede de mentira. `mundo` diz o que a carteira tem; o contador registra o que
 * foi perguntado.
 */
function montaRede(mundo) {
  const conta = { saldo: 0, dono: 0, score: 0 }
  globalThis.fetch = async (url, opcoes) => {
    const u = String(url)
    if (u.includes('ronke-analytics')) {
      conta.score++
      if (mundo.scoreQuebrado) return new Response('{}', { status: 500 })
      return new Response(
        JSON.stringify({ data: { address: CARTEIRA, found: true, score: mundo.score }, meta: {} }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    const corpo = JSON.parse(opcoes.body)
    const dado = corpo.params[0].data
    const alvo = corpo.params[0].to.toLowerCase()
    let resultado
    if (dado.startsWith('0x70a08231')) {
      conta.saldo++
      /*
       * O TOKEN VOLTA EM WEI, e o mock tem que respeitar isso: `mundo.token` é
       * em $RONKE inteiros, e a cadeia responde em base 10^18. Sem esta conta o
       * teste dublaria uma cadeia que não existe — e passaria a testar ficção.
       */
      resultado = hex(alvo === TOK ? BigInt(mundo.token || 0) * 10n ** 18n : BigInt(mundo.nfts || 0))
    } else if (dado.startsWith('0x6352211e')) {
      conta.dono++
      const id = Number(BigInt('0x' + dado.slice(10)))
      resultado = endereco32((mundo.tem1de1 || []).includes(id) ? CARTEIRA : '0x' + '9'.repeat(40))
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: resultado }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return conta
}

/*
 * O ATALHO QUE FAZ A REGRA DOS 1/1 SER VIÁVEL.
 *
 * Não existe chamada que pergunte "tem algum destes 107?": só `ownerOf`, um a
 * um. Pra quem NÃO tem nenhum NFT isso seriam 107 chamadas pra descobrir um
 * "não" — e quem não tem nenhum é a maioria de quem passa por aqui.
 */
esqueceTudo()
let conta = montaRede({ token: 0, nfts: 0, score: 0 })
let m = await medidasDe(CARTEIRA, COMPLETO)
conf(conta.dono === 0, 'carteira sem NFT nenhum: ZERO chamadas de ownerOf', `${conta.dono}`)
conf(m.medidas[`ids:${NFT}:${LORD}`] === 0, 'e a medida do Lord sai zero mesmo assim')

esqueceTudo()
conta = montaRede({ token: 5, nfts: 2, score: 0, tem1de1: [] })
await medidasDe(CARTEIRA, COMPLETO)
conf(conta.dono === UM_DE_UM.length, 'carteira COM NFT: aí sim pergunta id por id', `${conta.dono}`)

esqueceTudo()
conta = montaRede({ token: 5, nfts: 9, score: 0, tem1de1: [24] })
m = await medidasDe(CARTEIRA, COMPLETO)
conf(m.medidas[`ids:${NFT}:${LORD}`] === 1, 'quem tem o 1/1 mede 1')
conf(conta.dono === 2, 'e para no que encontrou, sem perguntar o resto', `${conta.dono} de ${UM_DE_UM.length}`)

/*
 * UMA PERGUNTA SERVE DUAS REGRAS. `Ronke Holder` (1 $RONKE) e `Ronke Chad`
 * (1.000.000) olham o mesmo saldo. Perguntar duas vezes seria pagar dobrado pela
 * mesma resposta.
 */
esqueceTudo()
conta = montaRede({ token: 2000000, nfts: 3, score: 5000, tem1de1: [777] })
m = await medidasDe(CARTEIRA, COMPLETO)
conf(conta.saldo === 2, 'cinco regras, DOIS balanceOf (um por contrato)', `${conta.saldo}`)
conf(conta.score === 1, 'e uma consulta de score só', `${conta.score}`)
conf(m.incerto.length === 0, 'nada incerto quando tudo responde')

const merece = new Set(cargosPara(m.medidas, COMPLETO))
conf(merece.size === 5, 'a baleia com 1/1 e score alto merece os CINCO cargos', `${merece.size}`)
conf(merece.has(LORD), 'inclusive o Ronke Lord — que antes nunca saía')
conf(merece.has(SABIO), 'inclusive o cargo por score')

/*
 * A API DO SCORE FORA DO AR NÃO PODE VIRAR "SCORE ZERO".
 *
 * Se virasse, todo mundo com cargo por score perderia o cargo no dia em que a
 * analytics piscasse — e o membro não fez nada. A medida tem que ficar AUSENTE e
 * o incerto tem que apontar pra ela; é isso que faz `aplicaCargos` não remover.
 */
esqueceTudo()
conta = montaRede({ token: 2000000, nfts: 3, score: 5000, tem1de1: [777], scoreQuebrado: true })
m = await medidasDe(CARTEIRA, COMPLETO)
conf(!('score' in m.medidas), 'score fora do ar: a medida fica AUSENTE, não vira zero')
conf(m.incerto.includes('score'), 'e entra na lista de incertos')
conf(!new Set(cargosPara(m.medidas, COMPLETO)).has(SABIO), 'sem a medida, o cargo não é concedido')
conf(
  decideCargos(m.medidas, COMPLETO, [SABIO]).tirar.includes(SABIO),
  'e SERIA removido — por isso `aplicaCargos` zera a remoção quando há incerto',
)

globalThis.fetch = original

/* ==========================================================================
 * O AVISO — a única coisa que a pessoa recebe sem ter clicado
 * ==========================================================================
 * O fluxo termina minutos depois do clique, num processo separado. Sem aviso,
 * quem mandou a transação fica sem saber se deu certo — e silêncio depois de
 * mandar dinheiro pra um endereço é indistinguível de erro.
 */
console.log('\nO AVISO DE VERIFICAÇÃO\n')

const CARTEIRA_AVISO = '0xc24566e78709ce989db5211bb088ead4dce81b74'
const comCargos = msg.verificado(CARTEIRA_AVISO, [HOLDER, WHALE])

conf(comCargos.includes('0xc245') && comCargos.includes('1b74'), 'diz QUAL carteira ficou amarrada')
conf(!comCargos.includes(CARTEIRA_AVISO), 'e abrevia — 42 caracteres numa frase ninguém lê')
conf(
  comCargos.includes(`<@&${HOLDER}>`) && comCargos.includes(`<@&${WHALE}>`),
  'menciona os cargos com <@&id>, pra o Discord desenhar a pílula de verdade',
)
conf(comCargos.toLowerCase().includes('sell'), 'avisa que vender tira o cargo')

/*
 * QUEM NÃO ALCANÇOU NADA TAMBÉM PRECISA DE RESPOSTA. Sem ela, a pessoa que
 * verificou uma carteira vazia fica esperando pra sempre uma mensagem que nunca
 * vem, e conclui que o bot quebrou.
 */
const semCargo = msg.verificado(CARTEIRA_AVISO, [])
conf(semCargo.includes('Verified'), 'carteira sem nada AINDA recebe confirmação')
conf(!semCargo.includes('<@&'), 'e não menciona cargo nenhum')
conf(semCargo.toLowerCase().includes('not hold enough'), 'e explica por que não veio cargo')

/*
 * NÃO PODE SER DM, E ISSO É SEGURANÇA.
 *
 * A mensagem fixada promete "we will never DM you first". Um membro acostumado a
 * receber DM legítima do bot é um membro preparado pra cair na DM do golpista
 * que copia nome e avatar. A promessa só vale enquanto for absoluta.
 *
 * Por isso o aviso sai pela webhook da interação — o mesmo lugar onde a pessoa
 * clicou. Este teste falha se alguém trocar por DM sem pensar nisso.
 */
let caminhoUsado = ''
globalThis.fetch = async (url, opcoes) => {
  caminhoUsado = String(url)
  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
}
await avisaDepois('app123', 'token456', 'oi')
globalThis.fetch = original

conf(caminhoUsado.includes('/webhooks/app123/token456'), 'o aviso sai pela webhook da interação', caminhoUsado.replace('https://discord.com/api/v10', ''))
conf(!/\/users\/@me\/channels/.test(caminhoUsado), 'e NÃO abre DM — a mensagem fixada promete que o bot nunca manda DM primeiro')

/*
 * AVISO QUE FALHA NÃO PODE DERRUBAR A VARREDURA. Token vencido é o caso comum
 * (varredura atrasada), e o cargo já foi dado nessa altura. Se isto estourasse,
 * o aviso de um custaria a verificação de todos os que vêm depois na fila.
 */
globalThis.fetch = async () => new Response('{}', { status: 401 })
const ruim = await avisaDepois('app', 'vencido', 'oi')
globalThis.fetch = original
conf(ruim.ok === false && ruim.status === 401, 'token vencido devolve falha em vez de estourar', String(ruim.status))

console.log(falhas ? `\n${falhas} FALHA(S)\n` : '\nTUDO OK\n')
process.exitCode = falhas ? 1 : 0
