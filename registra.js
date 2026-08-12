/**
 * REGISTRA OS COMANDOS no Ronke Guild.
 *
 *   node --env-file=.env registra.js
 *
 * ESCOPO DE SERVIDOR e nao global: comando de servidor aparece na hora, global
 * demora ate uma hora pra propagar. Como o bot serve UM servidor, nao ha razao
 * pra esperar -- nem pra o comando existir em servidores que nao sao esse.
 *
 * Roda de novo sempre que a forma dos comandos mudar. E um PUT: substitui a
 * lista inteira, entao comando removido daqui some de la.
 */
import { registraComandos } from './lib/discord.js'
import { COMANDOS, validaComandos } from './lib/comandos.js'

const erros = validaComandos(COMANDOS)
if (erros.length) {
  // Conferir antes de mandar: o Discord recusa com "Invalid Form Body" e um
  // caminho ilegivel tipo `options.0.options.2.name`.
  console.error('forma invalida, nao vou registrar:\n' + erros.join('\n'))
  process.exitCode = 1
} else {
  const r = await registraComandos(
    process.env.DISCORD_APP_ID,
    process.env.DISCORD_GUILD_ID,
    COMANDOS,
  )
  console.log(`registrados ${r.length} comando(s):`)
  for (const c of r) {
    const subs = (c.options || [])
      .flatMap((o) => (o.options || []).map((s) => `${o.name} ${s.name}`))
      .join(' | ')
    console.log(`  /${c.name}${subs ? '  -> ' + subs : ''}`)
  }
}
