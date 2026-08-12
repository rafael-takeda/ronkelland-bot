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
import { decideCargos } from './lib/regras.js'

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

console.log(falhas ? `\n${falhas} FALHA(S)\n` : '\nTUDO OK\n')
process.exitCode = falhas ? 1 : 0
