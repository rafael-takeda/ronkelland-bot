/**
 * PROVA DAS DUAS PEÇAS QUE DEIXAM O LAÇO VIVER 24 HORAS.
 *
 *   node teste_varre.js
 *
 * O serviço do VPS reiniciava a cada 50 minutos e agora fica vivo um dia. Isso
 * exigiu duas coisas, e as duas ficam sob teste porque a falha de cada uma é
 * silenciosa:
 *
 *   regrasRenovadas  as regras do painel valem na volta seguinte, e uma leitura
 *                    ruim NUNCA troca por regra velha;
 *   travaFresca      a revarredura diária pausa o laço sem parar o serviço, e
 *                    uma trava esquecida não deixa o laço mudo pra sempre.
 */
process.env.UPSTASH_REDIS_REST_URL = 'https://redis.de-mentira'
process.env.UPSTASH_REDIS_REST_TOKEN = 'x'

const { regrasRenovadas } = await import('./lib/painelrota.js')
const { travaFresca, TETO_DA_TRAVA_MS } = await import('./lib/trava.js')
const { mkdtempSync, writeFileSync, utimesSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')

let falhas = 0
const conf = (c, m, e = '') => {
  if (!c) {
    falhas++
    console.error('  FALHOU  ' + m + '  ' + e)
  } else console.log('  ok      ' + m + (e ? '  ' + e : ''))
}

const original = globalThis.fetch
/** O Redis de mentira: só o GET de `rl:regras`, devolvendo o que o teste mandar. */
const redisCom = (resultado, { quebra = false } = {}) => {
  globalThis.fetch = async () => {
    if (quebra) throw new Error('rede caiu')
    return new Response(JSON.stringify({ result: resultado }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
}

const REGRA_A = { nome: 'Ronkeverse chad', cargo: '1350643017999974481', tipo: 'ERC-721', contrato: '0x810b6d1374ac7ba0e83612e7d49f49a13f1de019', casas: 0, minimo: 10 }
const REGRA_B = { nome: 'Ronke', cargo: '1537651450602070087', tipo: 'score', minimo: 69 }
const atuais = [REGRA_A]

console.log('\nAS REGRAS DO PAINEL, DE VOLTA EM VOLTA\n')

redisCom(JSON.stringify([REGRA_A, REGRA_B]))
let novas = await regrasRenovadas(atuais)
conf(novas !== atuais && novas.length === 2, 'regra criada no painel entra na volta seguinte', `${novas.length} regras`)

redisCom(JSON.stringify([REGRA_A]))
conf((await regrasRenovadas(atuais)) === atuais, 'nada mudou: devolve o MESMO array (o laço só loga quando muda)')

redisCom(null)
conf((await regrasRenovadas(atuais)) === atuais, 'painel nunca usado (nulo): mantém as de antes, NÃO cai no regras.json velho')

redisCom('isto nao e json')
conf((await regrasRenovadas(atuais)) === atuais, 'JSON corrompido no Redis: mantém as de antes')

redisCom(JSON.stringify([]))
conf((await regrasRenovadas(atuais)) === atuais, 'lista vazia: mantém (apagar a última regra só vale no próximo reinício)')

redisCom(JSON.stringify([{ nome: 'quebrada', cargo: 'x', tipo: 'ERC-721', contrato: 'nao-e-endereco', minimo: -1 }]))
conf((await regrasRenovadas(atuais)) === atuais, 'regra malformada: mantém as de antes, nada roda com regra quebrada')

redisCom(null, { quebra: true })
conf((await regrasRenovadas(atuais)) === atuais, 'Redis fora do ar: mantém as de antes, sem lançar')

globalThis.fetch = original

console.log('\nA TRAVA DA REVARREDURA\n')

const dir = mkdtempSync(join(tmpdir(), 'trava-'))
const arq = join(dir, 'revarre.trava')

conf(travaFresca(arq) === false, 'sem arquivo: não há trava')
conf(travaFresca(undefined) === false, 'sem TRAVA_REVARRE no ambiente (Actions, terminal): nunca há trava')

writeFileSync(arq, '')
conf(travaFresca(arq) === true, 'arquivo recém-criado: o laço espera')

const velho = new Date(Date.now() - TETO_DA_TRAVA_MS - 60_000)
utimesSync(arq, velho, velho)
conf(travaFresca(arq) === false, 'trava esquecida (mais velha que o teto): vale como inexistente, o laço volta sozinho')

const quaseVelho = new Date(Date.now() - TETO_DA_TRAVA_MS + 60_000)
utimesSync(arq, quaseVelho, quaseVelho)
conf(travaFresca(arq) === true, 'logo abaixo do teto ainda vale')
conf(TETO_DA_TRAVA_MS > 45 * 60_000, 'e o teto é maior que o TimeoutStartSec da revarredura (45 min)', `${TETO_DA_TRAVA_MS / 60000} min`)

console.log(falhas ? `\n${falhas} FALHA(S)\n` : '\nTUDO OK\n')
process.exitCode = falhas ? 1 : 0
