/**
 * PROVA DAS REGRAS — a parte que decide quem entra onde.
 *
 *   node teste_regras.js
 *
 * Aqui nao ha cadeia nem Discord: e logica pura, e por isso mesmo e onde um erro
 * passa despercebido ate alguem perder um cargo que nao devia perder.
 */
import { cargosPara, chaveDaMedida, decideCargos, validaRegras } from './lib/regras.js'
import { readFileSync } from 'node:fs'

let falhas = 0
const conf = (c, m, e = '') => { if (!c) { falhas++; console.error('  FALHOU  ' + m + '  ' + e) } else console.log('  ok      ' + m + (e ? '  ' + e : '')) }

const HOLDER = '111111111111111111'
const WHALE  = '222222222222222222'
const MOD    = '999999999999999999' // cargo do servidor, FORA das regras
const NFT   = '0x810b6d1374ac7ba0e83612e7d49f49a13f1de019' // Ronkeverse
const TOKEN = '0xe514d9deb7966c8be0ca922de8a064264ea6bcd4' // outro contrato
const REGRAS = [
  { contrato: NFT, cargo: HOLDER, minimo: 1,  nome: 'Ronkeverse Holder' },
  { contrato: NFT, cargo: WHALE,  minimo: 10, nome: 'Ronkeverse Whale' },
]
// saldo vira MAPA por contrato
const so = (n) => ({ [NFT]: n })

console.log('\nREGRAS DE CARGO\n')

conf(validaRegras(REGRAS).length === 0, 'regra bem formada passa')
conf(validaRegras([{ contrato: NFT, cargo: 'Ronkeverse Holder', minimo: 1 }]).length > 0, 'nome no lugar do ID e recusado')
conf(validaRegras([{ cargo: HOLDER, minimo: 1 }]).length > 0, 'regra SEM contrato e recusada')
conf(validaRegras([{ contrato: 'nao-e-endereco', cargo: HOLDER, minimo: 1 }]).length > 0, 'contrato mal formado e recusado')
conf(validaRegras([{ contrato: NFT, cargo: HOLDER, minimo: 0 }]).length > 0, 'minimo zero e recusado')
conf(validaRegras([]).length > 0, 'lista vazia e recusada')

conf(cargosPara(so(0), REGRAS).length === 0, 'quem nao tem nada nao ganha cargo')
conf(cargosPara(so(1), REGRAS).join() === HOLDER, 'um NFT vira Holder')
conf(cargosPara(so(10), REGRAS).length === 2, 'dez NFTs viram Holder E Whale (acumulativo)', cargosPara(so(10), REGRAS).join())

// ---- o que dar e o que tirar, que e onde mora o perigo
const a = decideCargos(so(1), REGRAS, [])
conf(a.dar.join() === HOLDER && a.tirar.length === 0, 'novato com 1 NFT: ganha Holder')

const b = decideCargos(so(0), REGRAS, [HOLDER])
conf(b.tirar.join() === HOLDER && b.dar.length === 0, 'vendeu tudo: perde Holder')

const c = decideCargos(so(20), REGRAS, [HOLDER])
conf(c.dar.join() === WHALE && c.tirar.length === 0, 'comprou mais: ganha Whale, mantem Holder')

const d = decideCargos(so(5), REGRAS, [HOLDER, WHALE])
conf(d.tirar.join() === WHALE && d.dar.length === 0, 'vendeu ate cair de faixa: perde so o Whale')

/*
 * A REGRA DE OURO. Quem tem cargo de moderador e vende o NFT perde o Holder e
 * NAO perde a moderacao. Sem isso, um bot de verificacao viraria uma bomba num
 * servidor de terceiros -- e o estrago seria em cargos que ninguem pediu pra ele
 * tocar.
 */
const e = decideCargos(so(0), REGRAS, [HOLDER, MOD])
conf(e.tirar.join() === HOLDER, 'tira o Holder')
conf(!e.tirar.includes(MOD), 'e NAO encosta em cargo que nao e dele', e.tirar.join() || '(nada mais)')

const f = decideCargos(so(50), REGRAS, [HOLDER, WHALE, MOD])
conf(f.dar.length === 0 && f.tirar.length === 0, 'quem ja esta certo nao gera mexida nenhuma')

/* ==========================================================================
 * OS TIPOS DE REGRA — tres perguntas diferentes
 * ========================================================================== */
console.log('\nTIPOS DE REGRA\n')

const LORD = '333333333333333333'
const SABIO = '444444444444444444'

const IDS = { contrato: NFT, cargo: LORD, tipo: 'ERC-721-ids', ids: [14, 24, 777], nome: 'Ronke Lord' }
const SCORE = { cargo: SABIO, tipo: 'score', minimo: 2000, nome: 'Ronke Sage' }

conf(validaRegras([IDS]).length === 0, 'regra de posse-de-id passa sem "minimo"')
conf(validaRegras([{ ...IDS, ids: [] }]).length > 0, 'posse-de-id com lista VAZIA e recusada')
conf(validaRegras([{ ...IDS, ids: undefined }]).length > 0, 'posse-de-id sem "ids" e recusada')
conf(validaRegras([{ ...IDS, ids: ['14'] }]).length > 0, 'id em texto e recusado')
/*
 * "minimo: 2" numa regra de id e recusado de proposito: `temAlgumToken` para no
 * primeiro que encontra, entao o bot nao SABE dizer "tem dois". Aceitar o campo
 * seria obedecer pela metade, e calado.
 */
conf(validaRegras([{ ...IDS, minimo: 2 }]).length > 0, 'posse-de-id com minimo 2 e recusada (o bot nao sabe contar isso)')
conf(validaRegras([{ ...IDS, minimo: 1 }]).length === 0, 'minimo 1 explicito e aceito')

conf(validaRegras([SCORE]).length === 0, 'regra de score passa SEM contrato')
conf(validaRegras([{ ...SCORE, contrato: NFT }]).length > 0, 'score COM contrato e recusado (score nao sai de contrato)')
conf(validaRegras([{ ...SCORE, minimo: 0 }]).length > 0, 'score com corte zero e recusado')
conf(validaRegras([{ cargo: SABIO, tipo: 'ERC-1155', contrato: NFT, minimo: 1 }]).length > 0, 'tipo desconhecido e recusado')
conf(validaRegras([SCORE, { ...SCORE, minimo: 5000 }]).length > 0, 'duas regras de score no MESMO cargo e repeticao')
conf(validaRegras([SCORE, { ...SCORE, cargo: LORD, minimo: 5000 }]).length === 0, 'duas faixas de score em cargos diferentes e legitimo')

/*
 * A REGRESSAO DO RONKE LORD.
 *
 * Esta regra ficou no `regras.json` sem NUNCA ser concedida: `cargosPara`
 * comparava `>= r.minimo`, e a regra de posse-de-id nao tem `minimo`, entao a
 * comparacao dava falso pra todo mundo -- inclusive pra quem tinha o 1/1.
 *
 * O sintoma de uma regra morta e NADA ACONTECER, que e igualzinho a "ninguem se
 * qualificou ainda". Por isso o teste tem que afirmar o positivo: com a medida
 * dizendo que a pessoa TEM, o cargo sai.
 */
const cheio = [...REGRAS, IDS, SCORE]
const chaveIds = `ids:${NFT}:${LORD}`

conf(
  cargosPara({ [NFT]: 3, [chaveIds]: 1 }, cheio).includes(LORD),
  'quem tem um 1/1 RECEBE o Ronke Lord',
)
conf(
  !cargosPara({ [NFT]: 3, [chaveIds]: 0 }, cheio).includes(LORD),
  'quem tem 3 NFTs comuns NAO recebe o Ronke Lord',
)
conf(
  !cargosPara({ [NFT]: 50 }, cheio).includes(LORD),
  'medida ausente nao concede: 50 NFTs sem a medida de id nao viram Lord',
)
conf(
  cargosPara({ score: 2000 }, cheio).includes(SABIO),
  'score exatamente no corte concede (>= e nao >)',
)
conf(!cargosPara({ score: 1999 }, cheio).includes(SABIO), 'um ponto abaixo do corte nao concede')
conf(!cargosPara({}, cheio).includes(SABIO), 'sem score nenhum nao concede')

/*
 * E O ARQUIVO DE PRODUCAO. O teste acima usa regras de mentira; este le o
 * `regras.json` de verdade e exige que CADA regra dele consiga disparar. Uma
 * regra que nao dispara pra medida nenhuma e uma regra morta, e foi exatamente
 * assim que o Ronke Lord passou meses sem funcionar.
 */
const producao = JSON.parse(readFileSync(new URL('./regras.json', import.meta.url), 'utf8')).regras
conf(validaRegras(producao).length === 0, 'o regras.json de producao e valido', validaRegras(producao).join('; '))

const tudoLigado = {}
for (const r of producao) tudoLigado[chaveDaMedida(r)] = Number.MAX_SAFE_INTEGER
const podem = new Set(cargosPara(tudoLigado, producao))
for (const r of producao) {
  conf(podem.has(String(r.cargo)), `"${r.nome}" consegue ser concedida`)
}

console.log(falhas ? `\n${falhas} FALHA(S)\n` : '\nTUDO OK\n')
process.exitCode = falhas ? 1 : 0
