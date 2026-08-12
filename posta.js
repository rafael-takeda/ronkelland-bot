/**
 * ============================================================================
 * POSTA A MENSAGEM FIXADA — o botão que o membro vê
 * ============================================================================
 *
 *   node --env-file=.env posta.js <idDoCanal>          publica e fixa
 *   node --env-file=.env posta.js <idDoCanal> --ver    só mostra, não publica
 *
 * É a única coisa deste bot que fica visível pra todo mundo. Todo o resto —
 * endereço, saldo, cargo — é resposta individual.
 *
 * ---------------------------------------------------------------------------
 * RODAR DUAS VEZES NÃO PODE CRIAR DUAS MENSAGENS
 * ---------------------------------------------------------------------------
 * Duas mensagens iguais fixadas no mesmo canal é o tipo de bagunça que ninguém
 * limpa depois, e pior: metade da comunidade clica na velha. Então antes de
 * publicar, este script PROCURA uma mensagem do próprio bot já fixada com este
 * botão. Se achar, EDITA aquela em vez de criar outra.
 *
 * O efeito prático é bom: mudar o texto da mensagem vira rodar de novo.
 */
import { mensagemDoCanal } from './lib/resposta.js'

const canal = process.argv[2]
const soVer = process.argv.includes('--ver')
const token = process.env.DISCORD_TOKEN

if (!/^\d{17,20}$/.test(String(canal || ''))) {
  console.error('Uso: node --env-file=.env posta.js <idDoCanal>')
  console.error('')
  console.error('O ID do canal: clique com o botão direito no canal -> Copiar ID.')
  console.error('(precisa do Modo Desenvolvedor: Config. do usuário -> Avançado)')
  process.exit(1)
}
if (!token) {
  console.error('Falta DISCORD_TOKEN.')
  process.exit(1)
}

const corpo = mensagemDoCanal()

// ------------------------------------------------------------------ preview
console.log('\n┌─ como vai aparecer ' + '─'.repeat(46))
console.log('│')
console.log('│  ' + corpo.embeds[0].title)
for (const linha of corpo.embeds[0].description.split('\n')) {
  console.log('│  ' + linha.replace(/\*\*/g, ''))
}
console.log('│')
console.log('│  [ ' + corpo.components[0].components[0].label + ' ]')
console.log('│')
console.log('└' + '─'.repeat(66) + '\n')

if (soVer) process.exit(0)

const api = async (caminho, opcoes = {}) => {
  const r = await fetch('https://discord.com/api/v10' + caminho, {
    ...opcoes,
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
      ...(opcoes.headers || {}),
    },
  })
  const texto = await r.text()
  return { ok: r.ok, status: r.status, dados: texto ? JSON.parse(texto || '{}') : null }
}

/*
 * CONFERE O CANAL ANTES DE ESCREVER NELE.
 *
 * Um id errado (do servidor, de outro canal, de um canal de voz) daria um 403 ou
 * 404 cru no meio do caminho. Perguntar primeiro custa uma chamada e transforma
 * um erro de API num aviso legível.
 */
const info = await api(`/channels/${canal}`)
if (!info.ok) {
  console.error(`Não consegui abrir esse canal (${info.status}).`)
  console.error('Confira se o ID é de um canal de TEXTO e se o bot enxerga ele.')
  process.exit(1)
}
if (info.dados.type !== 0) {
  console.error(`"${info.dados.name}" não é canal de texto (type ${info.dados.type}).`)
  process.exit(1)
}
console.log(`canal: #${info.dados.name}`)

// ---------------------------------------- já existe uma fixada nossa?
const eu = await api('/users/@me')
const fixadas = await api(`/channels/${canal}/pins`)
const antiga = (fixadas.ok ? fixadas.dados : []).find(
  (m) =>
    m.author?.id === eu.dados?.id &&
    m.components?.[0]?.components?.some((c) => c.custom_id === 'verificar'),
)

if (antiga) {
  const r = await api(`/channels/${canal}/messages/${antiga.id}`, {
    method: 'PATCH',
    body: JSON.stringify(corpo),
  })
  if (!r.ok) {
    console.error(`Não consegui editar a mensagem existente (${r.status}).`)
    process.exit(1)
  }
  console.log(`\nJá havia uma fixada — editei aquela, não criei outra.`)
  console.log(`https://discord.com/channels/${info.dados.guild_id}/${canal}/${antiga.id}`)
  process.exit(0)
}

const nova = await api(`/channels/${canal}/messages`, {
  method: 'POST',
  body: JSON.stringify(corpo),
})
if (!nova.ok) {
  console.error(`Não consegui publicar (${nova.status}).`)
  console.error('O bot precisa de "Send Messages" e "Embed Links" neste canal.')
  process.exit(1)
}

const fixa = await api(`/channels/${canal}/messages/${nova.dados.id}/pin`, { method: 'PUT' })
console.log('\npublicada' + (fixa.ok ? ' e fixada' : ' (mas NÃO consegui fixar — falta "Manage Messages")'))
console.log(`https://discord.com/channels/${info.dados.guild_id}/${canal}/${nova.dados.id}`)
