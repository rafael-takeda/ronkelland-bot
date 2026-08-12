/**
 * ============================================================================
 * DISCORD — ler e mexer em cargos
 * ============================================================================
 *
 * Só o que o bot precisa: ver os cargos do servidor, ver os cargos de um membro,
 * dar e tirar cargo. Nada de gateway, nada de biblioteca — quatro chamadas HTTP.
 *
 * ---------------------------------------------------------------------------
 * O TOKEN É DO DONO DA APLICAÇÃO
 * ---------------------------------------------------------------------------
 * Quem tiver ele controla o bot dentro do servidor. Vem de variável de ambiente
 * e nunca de arquivo versionado. Se vazar, quem criou a aplicação aperta "Reset
 * Token" e a cópia vazada morre na hora — sem depender de ninguém devolver
 * nada.
 *
 * ---------------------------------------------------------------------------
 * DAR CARGO É PUT, TIRAR É DELETE — e os dois são IDEMPOTENTES
 * ---------------------------------------------------------------------------
 * Dar um cargo que a pessoa já tem devolve 204 e não faz nada. Isso importa:
 * a varredura periódica repassa por todo mundo, e sem idempotência ela geraria
 * uma enxurrada de eventos de auditoria no servidor a cada volta.
 */

const API = 'https://discord.com/api/v10'

function token() {
  const t = process.env.DISCORD_TOKEN
  if (!t) throw new Error('DISCORD_TOKEN não configurado')
  return t
}

async function chama(caminho, opcoes = {}) {
  const r = await fetch(API + caminho, {
    ...opcoes,
    headers: {
      Authorization: `Bot ${token()}`,
      'Content-Type': 'application/json',
      ...(opcoes.headers || {}),
    },
  })
  /*
   * 429 É NORMAL E TEM QUE SER RESPEITADO. O Discord diz quantos segundos
   * esperar; ignorar isso leva a bloqueio temporário da aplicação inteira, e aí
   * o bot para pra todo mundo. Uma tentativa a mais resolve o caso comum.
   */
  if (r.status === 429) {
    const espera = Number((await r.json()).retry_after || 1)
    await new Promise((f) => setTimeout(f, espera * 1000 + 250))
    return chama(caminho, opcoes)
  }
  if (r.status === 204) return null
  const texto = await r.text()
  if (!r.ok) throw new Error(`Discord ${caminho}: HTTP ${r.status} ${texto.slice(0, 200)}`)
  return texto ? JSON.parse(texto) : null
}

/** Cargos do servidor, com permissões e posição — o que a trava de segurança lê. */
export async function cargosDoServidor(servidor) {
  return chama(`/guilds/${servidor}/roles`)
}

/**
 * A posição do cargo mais alto do PRÓPRIO bot.
 *
 * É o teto do que ele consegue atribuir: o Discord recusa cargo igual ou acima,
 * e recusa em silêncio. Sem este número, "não deu cargo" não teria explicação.
 */
export async function posicaoDoBot(servidor, idDoBot) {
  const [membro, cargos] = await Promise.all([
    chama(`/guilds/${servidor}/members/${idDoBot}`),
    cargosDoServidor(servidor),
  ])
  const meus = new Set(membro.roles || [])
  return cargos.filter((c) => meus.has(c.id)).reduce((alto, c) => Math.max(alto, c.position), 0)
}

export async function cargosDoMembro(servidor, membro) {
  const m = await chama(`/guilds/${servidor}/members/${membro}`)
  return m.roles || []
}

export async function daCargo(servidor, membro, cargo, motivo = 'Ronkelland') {
  await chama(`/guilds/${servidor}/members/${membro}/roles/${cargo}`, {
    method: 'PUT',
    headers: { 'X-Audit-Log-Reason': motivo },
  })
}

export async function tiraCargo(servidor, membro, cargo, motivo = 'Ronkelland') {
  await chama(`/guilds/${servidor}/members/${membro}/roles/${cargo}`, {
    method: 'DELETE',
    headers: { 'X-Audit-Log-Reason': motivo },
  })
}

/**
 * Aplica o que `decideCargos` decidiu.
 *
 * NÃO LANÇA por cargo. Um cargo que falha (apagado no meio do caminho, ou
 * arrastado pra cima do bot) não pode impedir os outros — nem derrubar a
 * varredura inteira e deixar 300 pessoas sem cargo por causa de um.
 */
export async function aplica(servidor, membro, { dar, tirar }, motivo) {
  const erros = []
  for (const c of dar) {
    try {
      await daCargo(servidor, membro, c, motivo)
    } catch (e) {
      erros.push(`dar ${c}: ${e.message}`)
    }
  }
  for (const c of tirar) {
    try {
      await tiraCargo(servidor, membro, c, motivo)
    } catch (e) {
      erros.push(`tirar ${c}: ${e.message}`)
    }
  }
  return erros
}

/** Posta a mensagem fixa com o botão no canal de verificação. */
export async function postaNoCanal(canal, corpo) {
  return chama(`/channels/${canal}/messages`, { method: 'POST', body: JSON.stringify(corpo) })
}

/** Registra os comandos. Escopo de SERVIDOR aparece na hora; global demora ~1h. */
export async function registraComandos(aplicacao, servidor, comandos) {
  return chama(`/applications/${aplicacao}/guilds/${servidor}/commands`, {
    method: 'PUT',
    body: JSON.stringify(comandos),
  })
}

/** Edita a resposta "pensando…" depois que a verificação termina. */
export async function editaResposta(aplicacao, tokenInteracao, corpo) {
  const r = await fetch(`${API}/webhooks/${aplicacao}/${tokenInteracao}/messages/@original`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  })
  if (!r.ok) throw new Error(`Discord editaResposta: HTTP ${r.status}`)
  return r.json()
}
