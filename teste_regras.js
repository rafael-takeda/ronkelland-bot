/**
 * PROVA DAS REGRAS — a parte que decide quem entra onde.
 *
 *   node teste_regras.js
 *
 * Aqui nao ha cadeia nem Discord: e logica pura, e por isso mesmo e onde um erro
 * passa despercebido ate alguem perder um cargo que nao devia perder.
 */
import { cargosPara, decideCargos, validaRegras } from './lib/regras.js'

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

console.log(falhas ? `\n${falhas} FALHA(S)\n` : '\nTUDO OK\n')
process.exitCode = falhas ? 1 : 0
