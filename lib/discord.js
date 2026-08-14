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

/*
 * A POSIÇÃO DO CARGO DO BOT — que é o teto do que ele consegue atribuir, porque
 * o Discord recusa cargo igual ou acima do seu, e recusa em silêncio.
 *
 * Não mora mais aqui. Quem precisa dela também precisa da lista de cargos (pra
 * montar o seletor), e buscar as duas coisas em chamadas separadas buscava a
 * lista duas vezes. Virou `cargosPraEscolher`, em painelrota.js, que devolve as
 * duas de uma ida só.
 */

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

/**
 * AVISA A PESSOA DEPOIS, no mesmo lugar onde ela clicou.
 *
 * O clique e a confirmação são separados por minutos: entre um e outro a pessoa
 * precisa mandar a transação e a varredura precisa achá-la. Sem este aviso, o
 * fluxo termina em silêncio — e "silêncio" é indistinguível de "quebrou", que é
 * exatamente o que alguém pensa depois de mandar dinheiro pra um endereço.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NÃO É DM
 * ---------------------------------------------------------------------------
 * Seria mais fácil mandar DM, e é o que muitos bots fazem. Não fazemos, e o
 * motivo está escrito na nossa própria mensagem fixada: "we will never DM you
 * first".
 *
 * Um membro acostumado a receber DM legítima do bot é um membro preparado pra
 * cair na DM do golpista que copia o nome e o avatar. A promessa só protege
 * enquanto for absoluta — uma exceção "só pra confirmar" já destrói ela.
 *
 * Então o aviso vai pela webhook da interação: some pra todo mundo menos ela, no
 * mesmo canal onde ela clicou. O token vale 15 minutos, e a janela inteira de
 * verificação são 5 — cabe, com folga, quando a varredura não está atrasada.
 */
export async function avisaDepois(aplicacao, tokenInteracao, texto) {
  const r = await fetch(`${API}/webhooks/${aplicacao}/${tokenInteracao}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: texto, flags: 64 }),
  })
  /*
   * Falhar aqui NÃO pode derrubar a varredura. O cargo já foi dado; o aviso é
   * cortesia. Um token vencido (varredura atrasada) é o caso comum de falha, e
   * ele não deve custar a verificação de quem vem depois na fila.
   */
  if (!r.ok) return { ok: false, status: r.status }
  return { ok: true }
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
