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
  let dados = null
  try {
    dados = texto ? JSON.parse(texto) : null
  } catch {
    // Resposta que não é JSON (204 vazio, HTML de gateway) não pode derrubar o
    // script — o status já diz o que precisa ser dito.
    dados = null
  }
  return { ok: r.ok, status: r.status, dados }
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

/*
 * JÁ EXISTE UMA NOSSA NESTE CANAL?
 *
 * A primeira versão procurava só entre as FIXADAS — e isso amarrava a checagem
 * de duplicata ao sucesso de fixar. Quando o Discord recusou o pin, a mensagem
 * publicada ficou invisível pra esta busca, e a execução seguinte publicou uma
 * segunda. Duas mensagens de verificação idênticas no mesmo canal, e metade da
 * comunidade clicando na errada.
 *
 * Agora procura no HISTÓRICO recente, que não depende de nada ter dado certo
 * antes. As fixadas continuam sendo olhadas porque uma mensagem antiga pode ter
 * saído das últimas 100.
 */
const eu = await api('/users/@me')
const [recentes, fixadas] = await Promise.all([
  api(`/channels/${canal}/messages?limit=100`),
  api(`/channels/${canal}/pins`),
])

const nossa = (m) =>
  m.author?.id === eu.dados?.id &&
  m.components?.[0]?.components?.some((c) => c.custom_id === 'verificar')

const candidatas = [
  ...(Array.isArray(recentes.dados) ? recentes.dados : []),
  ...(Array.isArray(fixadas.dados) ? fixadas.dados : []),
].filter(nossa)

// A MAIS ANTIGA, e não a mais nova: se houver duplicata, quem fica é a que a
// comunidade já pode ter visto e fixado.
const antiga = candidatas.sort((a, b) => (a.id < b.id ? -1 : 1))[0]

if (candidatas.length > 1) {
  console.log(`\nATENÇÃO: há ${candidatas.length} mensagens de verificação neste canal.`)
  for (const m of candidatas) {
    console.log(`  https://discord.com/channels/${info.dados.guild_id}/${canal}/${m.id}`)
  }
  console.log('Vou editar a mais antiga. Apague as outras à mão.')
}

if (antiga) {
  const r = await api(`/channels/${canal}/messages/${antiga.id}`, {
    method: 'PATCH',
    body: JSON.stringify(corpo),
  })
  if (!r.ok) {
    console.error(`Não consegui editar a mensagem existente (${r.status}).`)
    process.exit(1)
  }
  console.log(`\nJá havia uma neste canal — editei aquela, não criei outra.`)
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

/*
 * FIXAR É `/pins/`, e não `/messages/<id>/pin`.
 *
 * O segundo caminho existe na minha cabeça e não na API: devolve 404. E como o
 * código tratava qualquer falha como "falta permissão", o 404 virava uma
 * mensagem afirmando uma causa errada — e eu fui atrás da permissão, que estava
 * certa, em vez do caminho, que estava errado.
 *
 * Por isso agora o motivo REAL é impresso. Um erro que chuta a causa custa mais
 * caro que um erro que só diz o que aconteceu.
 */
const fixa = await api(`/channels/${canal}/pins/${nova.dados.id}`, { method: 'PUT' })
console.log('\npublicada' + (fixa.ok ? ' e fixada' : ''))
if (!fixa.ok) {
  console.log(`NÃO fixada — o Discord respondeu ${fixa.status}.`)
  console.log('A mensagem está publicada; dá pra fixar na mão (botão direito → Fixar).')
}
console.log(`https://discord.com/channels/${info.dados.guild_id}/${canal}/${nova.dados.id}`)
