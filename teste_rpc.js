/**
 * PROVA DA TEIMOSIA DO RPC.
 *
 *   node teste_rpc.js
 *
 * A varredura é o único componente que alguém está esperando em tempo real, e é
 * o mais faminto: transferência nativa não emite log, então achar uma exige
 * abrir bloco por bloco. O RPC público limita a taxa, e mais cedo ou mais tarde
 * ele diz não.
 *
 * Isto aconteceu em produção — 429 virou exceção, a varredura morreu com alguém
 * ainda na fila, e o aviso de confirmação (token de 15 minutos) nunca chegou.
 * Estes testes travam o comportamento que impede a repetição.
 */
import { blocoAtual, saldoNoContrato } from './lib/prova.js'

let falhas = 0
const conf = (c, m, e = '') => {
  if (!c) {
    falhas++
    console.error('  FALHOU  ' + m + '  ' + e)
  } else console.log('  ok      ' + m + (e ? '  ' + e : ''))
}

const original = globalThis.fetch
let chamadas = 0

const json = (corpo, status = 200, cabecalhos = {}) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json', ...cabecalhos },
  })

const responde = (fn) => {
  chamadas = 0
  globalThis.fetch = async () => {
    chamadas++
    return fn(chamadas)
  }
}

console.log('\nO RPC TEM QUE SER TEIMOSO\n')

// ---------------------------------------------------------- 429 é "devagar"
responde((n) => (n < 3 ? json({}, 429) : json({ result: '0x10' })))
let r = await blocoAtual()
conf(r === 16, '429 duas vezes e acerta na terceira', `bloco ${r} em ${chamadas} chamadas`)
conf(chamadas === 3, 'tentou de novo em vez de estourar')

responde((n) => (n < 2 ? json({}, 503) : json({ result: '0x20' })))
conf((await blocoAtual()) === 32, '5xx também é motivo pra tentar de novo')

responde((n) => {
  if (n < 2) throw new Error('ECONNRESET')
  return json({ result: '0x30' })
})
conf((await blocoAtual()) === 48, 'rede que cai no meio também')

/*
 * DESISTIR TAMBÉM É NECESSÁRIO. Tentar pra sempre trava a varredura numa volta
 * só, e o resto da fila fica esperando alguém que nunca vai ser atendido.
 */
responde(() => json({}, 429))
let estourou = false
try {
  await blocoAtual()
} catch {
  estourou = true
}
conf(estourou, '429 pra sempre acaba estourando, em vez de travar')
conf(chamadas === 4, 'e tenta um número limitado de vezes', `${chamadas} tentativas`)

/*
 * ERRO DENTRO DO JSON-RPC NÃO SE REPETE. "execution reverted" é o contrato
 * dizendo NÃO — é resposta, não falha de transporte. Repetir não muda nada e
 * gasta justamente a cota que faltou.
 */
responde(() => json({ error: { message: 'execution reverted' } }))
const revertido = await saldoNoContrato(
  '0x1111111111111111111111111111111111111111',
  '0x2222222222222222222222222222222222222222',
  0,
)
conf(chamadas === 1, 'revert não é repetido — é resposta, não falha', `${chamadas} chamada`)
conf(revertido.ok === true && revertido.saldo === 0, 'e vira saldo zero, não "não consegui perguntar"')

/*
 * 4xx QUE NÃO É 429 TAMBÉM NÃO SE REPETE. 400 e 404 são erro nosso: a chamada
 * está malformada, e mandá-la de novo dá o mesmo resultado.
 */
responde(() => json({}, 400))
estourou = false
try {
  await blocoAtual()
} catch {
  estourou = true
}
conf(estourou && chamadas === 1, '400 estoura de primeira, sem insistir à toa', `${chamadas} chamada`)

// ------------------------------------------------------------ Retry-After
responde((n) => (n < 2 ? json({}, 429, { 'retry-after': '1' }) : json({ result: '0x1' })))
const t0 = Date.now()
await blocoAtual()
const levou = Date.now() - t0
conf(levou >= 900, 'obedece o Retry-After do servidor em vez de chutar menos', `esperou ${levou}ms`)

globalThis.fetch = original

console.log(falhas ? `\n${falhas} FALHA(S)\n` : '\nTUDO OK\n')
process.exitCode = falhas ? 1 : 0
