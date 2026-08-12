/**
 * PROVA DO RONKE SCORE — a leitura da API de analytics.
 *
 *   node teste_score.js            só a lógica (rede dublada)
 *   node teste_score.js --rede     também bate na API de verdade
 *
 * O que está sob teste aqui não é "sabe somar", é a DISTINÇÃO que o resto do bot
 * depende: "essa carteira não pontua" e "não consegui perguntar" chegam do mesmo
 * lugar e não podem virar a mesma coisa. Confundir as duas é como se tira cargo
 * de quem não fez nada.
 */
import { esqueceTudo, preaquece, scoreDe } from './lib/score.js'

let falhas = 0
const conf = (c, m, e = '') => {
  if (!c) {
    falhas++
    console.error('  FALHOU  ' + m + '  ' + e)
  } else console.log('  ok      ' + m + (e ? '  ' + e : ''))
}

const A = '0x1111111111111111111111111111111111111111'
const B = '0x2222222222222222222222222222222222222222'

const original = globalThis.fetch
let chamadas = []

/** Troca a rede por uma resposta combinada. Registra o que foi pedido. */
function dubla(responder) {
  chamadas = []
  globalThis.fetch = async (url) => {
    chamadas.push(String(url))
    return responder(String(url))
  }
}
const json = (corpo, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })

console.log('\nRONKE SCORE\n')

// ------------------------------------------------------- o caminho feliz
esqueceTudo()
dubla(() =>
  json({
    data: { address: A, found: true, score: 4820, rank: 312, percentile: 94.9 },
    meta: { as_of: '2026-08-12T13:17:03.207Z' },
  }),
)
let r = await scoreDe(A)
conf(r.ok && r.score === 4820, 'lê o score de quem pontua', String(r.score))
conf(r.rank === 312 && r.percentil === 94.9, 'traz rank e percentil junto')

// -------------------------------------------- "não pontua" É UMA RESPOSTA
esqueceTudo()
dubla(() => json({ data: { address: B, found: false, score: 0, rank: null }, meta: {} }))
r = await scoreDe(B)
conf(r.ok === true && r.score === 0, 'found:false vira zero, e zero é resposta VÁLIDA')
conf(r.rank === null, 'sem rank quando não pontua (não é "último lugar")')

/*
 * A LINHA QUE SEPARA AS DUAS. Daqui pra baixo é tudo "não consegui perguntar", e
 * TODO caso tem que sair com ok:false. Um só que escape vira score zero, e score
 * zero tira cargo de quem está com tudo em ordem.
 */
esqueceTudo()
dubla(() => json({ error: { code: 'internal' } }, 500))
conf((await scoreDe(A)).ok === false, 'HTTP 500 NÃO é zero')

esqueceTudo()
dubla(() => json({ error: { code: 'invalid_address' } }, 400))
conf((await scoreDe(A)).ok === false, 'HTTP 400 NÃO é zero')

esqueceTudo()
dubla(() => {
  throw new Error('getaddrinfo ENOTFOUND')
})
conf((await scoreDe(A)).ok === false, 'rede fora do ar NÃO é zero')

esqueceTudo()
dubla(() => json({ data: { address: A, found: true } }, 200))
conf((await scoreDe(A)).ok === false, 'resposta 200 sem o campo score NÃO é zero')

esqueceTudo()
dubla(() => new Response('<html>gateway</html>', { status: 200 }))
conf((await scoreDe(A)).ok === false, 'HTML no lugar de JSON NÃO é zero')

// ------------------------------------------------------------- a memória
esqueceTudo()
dubla(() => json({ data: { address: A, found: true, score: 900 }, meta: {} }))
await scoreDe(A)
await scoreDe(A)
await scoreDe(A.toUpperCase())
conf(chamadas.length === 1, 'pergunta uma vez só, mesmo em maiúscula', `${chamadas.length} chamada(s)`)

/*
 * FALHA NÃO FICA GUARDADA. Uma piscada de rede de um segundo não pode virar
 * quinze minutos de gente sem cargo — e viraria, se o erro entrasse na memória.
 */
esqueceTudo()
let vez = 0
dubla(() => {
  vez++
  return vez === 1 ? json({}, 500) : json({ data: { address: A, found: true, score: 77 }, meta: {} })
})
conf((await scoreDe(A)).ok === false, 'primeira tentativa falha')
const depois = await scoreDe(A)
conf(depois.ok && depois.score === 77, 'a seguinte pergunta DE NOVO e acerta', String(depois.score))

// ------------------------------------------------------------------ o lote
esqueceTudo()
dubla(() =>
  json({
    data: {
      scores: [
        { address: B, found: true, score: 222 },
        { address: A, found: true, score: 111 },
      ],
    },
    meta: { as_of: 'x' },
  }),
)
await preaquece([A, B])
conf(chamadas.length === 1, 'duas carteiras, uma chamada só', `${chamadas.length}`)
conf(/addresses=.*,/.test(chamadas[0]), 'manda as duas na mesma query')

/*
 * CASADO POR ENDEREÇO, NÃO POR POSIÇÃO. A resposta acima veio com B antes de A,
 * ao contrário da ordem pedida. Se o casamento fosse por índice, A receberia o
 * score de B — e um membro ganharia cargo pelo histórico de outro.
 */
let individuais = 0
globalThis.fetch = async () => {
  individuais++
  return json({}, 500)
}
const dA = await scoreDe(A)
const dB = await scoreDe(B)
conf(dA.score === 111 && dB.score === 222, 'cada uma com o SEU score, não o do vizinho', `${dA.score}/${dB.score}`)
conf(individuais === 0, 'o pré-aquecimento evitou as consultas individuais')

// ---------------------------------------------------------- lote grande
esqueceTudo()
dubla(() => json({ data: { scores: [] }, meta: {} }))
await preaquece(Array.from({ length: 120 }, (_, i) => '0x' + String(i).padStart(40, '0')))
conf(chamadas.length === 3, '120 carteiras viram 3 lotes de até 50', `${chamadas.length} lote(s)`)
conf(
  chamadas.every((u) => u.split('addresses=')[1].split(',').length <= 50),
  'nenhum lote passa do teto de 50 da API',
)

esqueceTudo()
dubla(() => json({ data: { scores: [] }, meta: {} }))
await preaquece(['nao-e-endereco', '0xabc', A])
conf(
  chamadas.length === 1 && !chamadas[0].includes('nao-e-endereco'),
  'endereço mal formado fica de fora (um só reprovaria a chamada inteira)',
)

globalThis.fetch = original

// ------------------------------------------------------------- de verdade
if (process.argv.includes('--rede')) {
  console.log('\n  --- contra a API de verdade ---')
  esqueceTudo()
  const vivo = await scoreDe('0x0000000000000000000000000000000000000001')
  conf(vivo.ok, 'a API responde', vivo.ok ? `as_of ${vivo.as_of}` : vivo.erro || '')
  conf(vivo.score === 0, 'carteira inventada pontua zero, sem erro', String(vivo.score))
}

console.log(falhas ? `\n${falhas} FALHA(S)\n` : '\nTUDO OK\n')
process.exitCode = falhas ? 1 : 0
