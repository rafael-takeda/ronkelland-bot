/**
 * O QUE ESTÁ GRAVADO NO REDIS — só leitura.
 *
 *   node --env-file=.env leredis.js
 *
 * Produção lê as regras do Redis; o `regras.json` só vale enquanto o painel
 * nunca escreveu. Mexer no arquivo sem olhar aqui é mexer no lugar errado.
 */
const URL_ = process.env.UPSTASH_REDIS_REST_URL
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN
if (!URL_ || !TOKEN) { console.error('faltam as variáveis do Upstash no .env'); process.exit(1) }

async function redis(...comando) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(comando),
  })
  const j = await r.json()
  if (j.error) throw new Error(j.error)
  return j.result
}

const cru = await redis('GET', 'rl:regras')

if (!cru) {
  console.log('rl:regras está VAZIO — produção está usando o regras.json do repositório.')
} else {
  const regras = JSON.parse(cru)
  console.log(`rl:regras tem ${regras.length} regra(s) — é ISTO que vale em produção:\n`)
  for (const r of regras) {
    const ids = Array.isArray(r.ids) ? `${r.ids.length} ids` : '—'
    console.log(`  ${String(r.nome).padEnd(18)} ${String(r.tipo || '?').padEnd(14)} cargo ${r.cargo}  ${ids}  min ${r.minimo ?? '—'}`)
  }
  const lord = regras.find((r) => r.tipo === 'ERC-721-ids')
  if (lord) {
    console.log(`\n  a regra de posse-de-id tem ${lord.ids.length} ids`)
    console.log(`  primeiros: ${lord.ids.slice(0, 6).join(', ')}`)
    console.log(`  últimos  : ${lord.ids.slice(-6).join(', ')}`)
  }
}
