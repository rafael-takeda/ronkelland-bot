/*
 * Por que alguns cargos não aparecem na lista do painel?
 *
 * O `escolheCargo` manda um role select NATIVO (tipo 6) e não filtra nada — a
 * lista quem monta é o cliente do Discord. Então a resposta tem que estar em
 * alguma propriedade dos cargos que somem. Este script imprime, de cada um:
 * posição, se é gerenciado por integração, e se o BOT conseguiria dá-lo.
 *
 * Só leitura. Não cria, não edita, não apaga nada.
 *
 *   node --env-file=.env diagnostico_cargos.js
 */

const TOKEN = process.env.DISCORD_TOKEN
const GUILD = process.env.DISCORD_GUILD_ID
const APP = process.env.DISCORD_APP_ID
if (!TOKEN || !GUILD) {
  console.error('falta DISCORD_TOKEN ou DISCORD_GUILD_ID no .env')
  process.exit(1)
}

async function api(caminho) {
  const r = await fetch('https://discord.com/api/v10' + caminho, {
    headers: { Authorization: `Bot ${TOKEN}` },
  })
  const txt = await r.text()
  if (!r.ok) throw new Error(`${caminho} → http ${r.status}: ${txt.slice(0, 200)}`)
  return JSON.parse(txt)
}

const cargos = await api(`/guilds/${GUILD}/roles`)
const eu = await api(`/guilds/${GUILD}/members/${APP}`)

/* A posição que vale pro bot é a do cargo MAIS ALTO dele. */
const meus = cargos.filter((c) => eu.roles.includes(c.id))
const minhaPos = Math.max(0, ...meus.map((c) => c.position))
const meuCargo = meus.find((c) => c.position === minhaPos)

console.log(`cargos no servidor: ${cargos.length}`)
console.log(`cargo do bot      : ${meuCargo?.name} — posição ${minhaPos}`)
console.log(`o bot tem Manage Roles?`, meus.some((c) => (BigInt(c.permissions) & (1n << 28n)) !== 0n) ? 'sim' : 'NÃO')
console.log('')

const ordenados = [...cargos].sort((a, b) => b.position - a.position)

console.log('pos   membros  gerido  bot-pode  nome')
console.log('─'.repeat(64))
for (const c of ordenados) {
  if (c.name === '@everyone') continue
  const podeDar = c.position < minhaPos && !c.managed
  console.log(
    String(c.position).padStart(3) + '   ' +
    String(c.tags?.bot_id ? '(bot)' : '').padStart(7) + '  ' +
    (c.managed ? ' SIM  ' : '  -   ') + '  ' +
    (podeDar ? '  sim   ' : '  NÃO   ') + '  ' +
    c.name,
  )
}

console.log('')
console.log('OS QUE O BOT NÃO CONSEGUE DAR')
console.log('─'.repeat(64))
const travados = ordenados.filter((c) => c.name !== '@everyone' && (c.position >= minhaPos || c.managed))
if (!travados.length) console.log('  nenhum — o bot alcança todos')
for (const c of travados) {
  console.log(`  ${c.name} — ${c.managed ? 'gerido por integração (ninguém pode dar)' : `posição ${c.position}, acima do bot (${minhaPos})`}`)
}

/* Os que o Abrah citou por nome, pra olhar de perto. */
console.log('')
console.log('OS QUE O ABRAH CITOU')
console.log('─'.repeat(64))
for (const alvo of ['ronke club', 'ronke raider', 'ronke lord', 'ronke artists', 'ronke', 'brainrot']) {
  const c = cargos.find((x) => x.name.toLowerCase() === alvo)
  if (!c) { console.log(`  "${alvo}" — não existe com esse nome exato`); continue }
  console.log(
    `  ${c.name.padEnd(16)} id ${c.id}  pos ${String(c.position).padStart(3)}  ` +
    `${c.managed ? 'GERIDO  ' : '        '}bot-pode-dar: ${c.position < minhaPos && !c.managed ? 'sim' : 'NÃO'}`,
  )
}

/*
 * E, por fim, a tela DE VERDADE: os cargos reais passados pela função real. Se
 * o cargo que o Abrah procura não aparecer aqui, o conserto não funcionou.
 */
const { escolheCargo } = await import('./lib/painel.js')
const tela = escolheCargo('regra de teste', cargos, minhaPos)
console.log('')
console.log('O QUE O PAINEL VAI MOSTRAR AGORA')
console.log('─'.repeat(64))
console.log('  ' + tela.embeds[0].description.replace(/\n/g, '\n  '))
console.log('')
const lista = tela.components[0]?.components?.[0]
if (lista?.options) {
  lista.options.forEach((o, i) => console.log(`  ${String(i + 1).padStart(2)}. ${o.label}`))
} else {
  console.log('  (sem lista — nenhum cargo alcançável)')
}
