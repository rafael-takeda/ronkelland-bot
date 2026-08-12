/**
 * PROVA DA PORTA DE ENTRADA.
 *
 *   node teste_assinatura.js
 *
 * Esta é a checagem mais importante do bot inteiro: sem ela, quem descobrir a
 * URL manda "fulano clicou em verificar" e ganha cargo sem carteira nenhuma.
 *
 * O teste gera um par de chaves Ed25519 de mentira, assina como o Discord
 * assinaria, e confere que o que é válido passa e que CADA forma de adulteração
 * é recusada. Um validador que só testa o caso feliz não prova nada — ele
 * poderia estar retornando `true` sempre.
 */
import { generateKeyPairSync, sign } from 'node:crypto'
import { valida } from './lib/assinatura.js'

let falhas = 0
const conf = (c, m, e = '') => {
  if (!c) {
    falhas++
    console.error('  FALHOU  ' + m + '  ' + e)
  } else console.log('  ok      ' + m + (e ? '  ' + e : ''))
}

console.log('\nASSINATURA DO DISCORD\n')

// Um par de chaves fingindo ser o do Discord.
const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const pubHex = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('hex')

const corpo = JSON.stringify({ type: 3, data: { custom_id: 'verificar' }, member: { user: { id: '123' } } })
const agora = String(Math.floor(Date.now() / 1000))
const assina = (t, c, chave = privateKey) =>
  sign(null, Buffer.from(t + c, 'utf8'), chave).toString('hex')

const boa = assina(agora, corpo)

conf(valida(corpo, boa, agora, pubHex), 'requisição legítima passa')

// ---------------------------------------------- cada adulteração é recusada
conf(!valida(corpo + ' ', boa, agora, pubHex), 'corpo alterado é recusado')
conf(!valida(corpo, boa, String(Number(agora) + 1), pubHex), 'timestamp trocado é recusado')
conf(!valida(corpo, 'ff'.repeat(64), agora, pubHex), 'assinatura falsa é recusada')
conf(!valida(corpo, boa, agora, 'ab'.repeat(32)), 'chave pública errada é recusada')
conf(!valida(corpo, boa, agora, ''), 'sem chave pública, recusa')
conf(!valida('', boa, agora, pubHex), 'corpo vazio é recusado')
conf(!valida(corpo, '', agora, pubHex), 'sem assinatura, recusa')
conf(!valida(corpo, 'nao-e-hex', agora, pubHex), 'assinatura que nem é hex: recusa sem explodir')

/*
 * OUTRA APLICAÇÃO NÃO SERVE. Se o validador comparasse só o formato, uma
 * requisição assinada por qualquer outra chave passaria — e a URL do bot é
 * pública.
 */
const outro = generateKeyPairSync('ed25519')
conf(
  !valida(corpo, assina(agora, corpo, outro.privateKey), agora, pubHex),
  'assinada por OUTRA chave é recusada',
)

/*
 * REPLAY. Uma requisição capturada não pode valer pra sempre — "fulano clicou"
 * é barato demais de repetir.
 */
const velho = String(Math.floor(Date.now() / 1000) - 3600)
conf(!valida(corpo, assina(velho, corpo), velho, pubHex), 'requisição de uma hora atrás é recusada')

const recente = String(Math.floor(Date.now() / 1000) - 60)
conf(valida(corpo, assina(recente, corpo), recente, pubHex), 'de um minuto atrás ainda vale')

/*
 * O ERRO CLÁSSICO: remontar o corpo com parse + stringify. Os campos são os
 * mesmos, os bytes não — e a assinatura é sobre os BYTES. Este teste existe pra
 * ninguém "arrumar" o código passando o objeto já parseado.
 */
const remontado = JSON.stringify(JSON.parse(corpo))
const mudou = remontado !== corpo
conf(
  !mudou || !valida(remontado, boa, agora, pubHex),
  'corpo remontado por parse+stringify não valida',
  mudou ? 'bytes mudaram, como esperado' : '(neste caso os bytes coincidiram)',
)

console.log(falhas ? `\n${falhas} FALHA(S)\n` : '\nTUDO OK\n')
process.exitCode = falhas ? 1 : 0
