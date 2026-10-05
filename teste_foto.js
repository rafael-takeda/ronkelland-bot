/**
 * PROVA DA FOTO DOS 1/1 — quando a varredura refaz e quando ela deixa quieta.
 *
 *   node teste_foto.js
 *
 * A foto vale 3 h (`VALIDADE_LORDS`) e é refeita uma hora ANTES de vencer
 * (`REFAZ_ANTES_MS`). Antes de 05/10/2026 ela só era refeita depois de vencida,
 * e com a fila ocupada na hora do vencimento o botão ficava sem foto — ver o
 * comentário de `REFAZ_ANTES_MS` em lib/ciclo.js.
 *
 * Redis e RPC são dublados num ponto só (`fetch`), como em teste_conclui.js.
 */
process.env.UPSTASH_REDIS_REST_URL = 'https://redis.de-mentira'
process.env.UPSTASH_REDIS_REST_TOKEN = 'x'

const { atualizaLords, impressaoDosIds } = await import('./lib/ciclo.js')

let falhas = 0
const conf = (c, m, e = '') => {
  if (!c) {
    falhas++
    console.error('  FALHOU  ' + m + '  ' + e)
  } else console.log('  ok      ' + m + (e ? '  ' + e : ''))
}

const NFT = '0x810b6d1374ac7ba0e83612e7d49f49a13f1de019'
const IDS = [14, 24, 777]
const REGRAS = [{ contrato: NFT, cargo: '333333333333333333', tipo: 'ERC-721-ids', ids: IDS, nome: 'Ronke Lord' }]
const H = 60 * 60 * 1000
const DONO = '0x' + 'ab'.repeat(20)

const json = (corpo, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })

/** Redis e cadeia de mentira: `foto` é o que está guardado; conta o que foi perguntado. */
function monta(foto) {
  const visto = { ownerOf: 0, guardou: null }
  globalThis.fetch = async (url, opcoes) => {
    const corpo = JSON.parse(opcoes.body)
    if (Array.isArray(corpo)) {
      const [cmd, chave, valor] = corpo
      if (cmd === 'GET' && chave === 'rl:lords') return json({ result: foto ? JSON.stringify(foto) : null })
      if (cmd === 'SET' && chave === 'rl:lords') {
        visto.guardou = JSON.parse(valor)
        return json({ result: 'OK' })
      }
      return json({ result: null })
    }
    if (corpo.method === 'eth_call' && corpo.params[0].data.startsWith('0x6352211e')) {
      visto.ownerOf++
      return json({ result: '0x' + DONO.slice(2).padStart(64, '0') })
    }
    return json({ result: null })
  }
  return visto
}

const fotoCom = (idadeMs, extra = {}) => ({
  contrato: NFT,
  completo: true,
  quando: Date.now() - idadeMs,
  impressao: impressaoDosIds(IDS),
  donos: {},
  total: IDS.length,
  ...extra,
})

console.log('\nQUANDO A FOTO É REFEITA\n')

let v = monta(fotoCom(1.5 * H))
let r = await atualizaLords(REGRAS)
conf(r.pulou === 'foto ainda vale' && v.ownerOf === 0, 'foto de 1h30: deixa quieta, sem chamada', JSON.stringify(r))

v = monta(fotoCom(2.5 * H))
r = await atualizaLords(REGRAS)
conf(r.donos === 1 && v.ownerOf === IDS.length, 'foto de 2h30 (ainda válida): REFEITA antes de vencer', JSON.stringify(r))
conf(v.guardou && v.guardou.completo && v.guardou.donos[DONO]?.length === IDS.length, '  e a nova foto é guardada, completa')
conf(v.guardou && Date.now() - v.guardou.quando < 60_000, '  com a hora de agora')

v = monta(fotoCom(3.5 * H))
r = await atualizaLords(REGRAS)
conf(r.donos === 1, 'foto vencida (3h30): refeita, como sempre foi')

v = monta(fotoCom(0.5 * H, { completo: false }))
r = await atualizaLords(REGRAS)
conf(r.donos === 1, 'foto incompleta, mesmo nova: refeita')

v = monta(fotoCom(0.5 * H, { impressao: impressaoDosIds([...IDS, 99999]) }))
r = await atualizaLords(REGRAS)
conf(r.donos === 1, 'foto de outra lista de ids: refeita')

v = monta(null)
r = await atualizaLords(REGRAS)
conf(r.donos === 1, 'sem foto nenhuma: tirada')

console.log(falhas ? `\n${falhas} FALHA(S)\n` : '\nTUDO OK\n')
process.exitCode = falhas ? 1 : 0
