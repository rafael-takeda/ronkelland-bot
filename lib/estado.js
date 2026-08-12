/**
 * ============================================================================
 * ESTADO — quem está verificando agora, e de quem é cada carteira
 * ============================================================================
 *
 * Redis (Upstash) pela API REST, sem biblioteca. São quatro coisas guardadas, e
 * elas têm durações bem diferentes:
 *
 *   PENDENTES  — quem clicou em verificar e ainda não pagou. Vive 5 minutos.
 *   VÍNCULO    — carteira de cada membro. Vive até ele sair ou trocar.
 *   DONO       — membro de cada carteira. É o índice inverso do vínculo.
 *   BLOCO      — até onde a varredura já olhou.
 *
 * ---------------------------------------------------------------------------
 * POR QUE O PENDENTE É UM HASH E NÃO UMA CHAVE POR PESSOA
 * ---------------------------------------------------------------------------
 * A varredura precisa da lista INTEIRA de endereços pendentes a cada volta,
 * pra comparar contra o `to` de cada transação do bloco. Com uma chave por
 * pessoa, isso seria um SCAN a cada minuto; com um hash só, é uma leitura.
 *
 * O preço é que a expiração não vem de graça (Redis não expira campo de hash),
 * então cada campo carrega o próprio prazo e a poda é feita na leitura. Isso é
 * melhor do que parece: a poda vira parte do caminho quente e não depende de
 * ninguém lembrar de rodar limpeza.
 */

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN

export const temRedis = Boolean(url && token)

/** Minutos que a pessoa tem pra mandar a transação depois de clicar. */
export const JANELA_MIN = Number(process.env.JANELA_MIN || 5)

const CH = {
  pendentes: 'rl:pendentes', // hash endereço -> {membro, ate}
  vinculo: 'rl:vinculo', // hash membro -> carteira
  dono: 'rl:dono', // hash carteira -> membro
  bloco: 'rl:bloco',
}

async function cmd(...partes) {
  if (!temRedis) throw new Error('Redis não configurado')
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(partes.map(String)),
  })
  if (!r.ok) throw new Error(`Redis ${partes[0]}: HTTP ${r.status}`)
  return (await r.json()).result
}

// ------------------------------------------------------------- pendentes

/**
 * Abre a janela de verificação de um membro.
 *
 * Reabrir SOBRESCREVE em vez de acumular: quem clica duas vezes tem uma janela
 * só, renovada. Sem isso, cliques repetidos deixariam entradas velhas na lista
 * de varredura por 5 minutos cada, e a varredura ficaria olhando endereços que
 * ninguém mais espera.
 */
export async function abrePendente(membro, endereco) {
  const ate = Date.now() + JANELA_MIN * 60_000
  await cmd('HSET', CH.pendentes, endereco.toLowerCase(), JSON.stringify({ membro, ate }))
  return ate
}

/**
 * Os pendentes VÁLIDOS agora, já podando os vencidos.
 *
 * A poda acontece aqui, no caminho que roda a cada volta, e não numa rotina de
 * limpeza separada — rotina separada é a que ninguém lembra de agendar.
 */
export async function pendentes() {
  const cru = (await cmd('HGETALL', CH.pendentes)) || []
  const vivos = new Map()
  const mortos = []
  // O Upstash devolve [campo, valor, campo, valor, ...].
  for (let i = 0; i < cru.length; i += 2) {
    const endereco = cru[i]
    let dado
    try {
      dado = JSON.parse(cru[i + 1])
    } catch {
      mortos.push(endereco)
      continue
    }
    if (!dado?.ate || dado.ate < Date.now()) mortos.push(endereco)
    else vivos.set(endereco, dado)
  }
  if (mortos.length) await cmd('HDEL', CH.pendentes, ...mortos)
  return vivos
}

export async function fechaPendente(endereco) {
  await cmd('HDEL', CH.pendentes, endereco.toLowerCase())
}

// --------------------------------------------------------------- vínculo

/**
 * Amarra carteira e membro, nos dois sentidos.
 *
 * ---------------------------------------------------------------------------
 * UMA CARTEIRA, UM MEMBRO — e é aqui que isso é imposto
 * ---------------------------------------------------------------------------
 * Sem esta regra, três pessoas usariam a MESMA carteira e as três ganhariam
 * cargo com um NFT só. É o furo mais óbvio de qualquer verificação por posse, e
 * o Collab.Land resolve do mesmo jeito: a carteira passa a pertencer a quem
 * verificou por último, e o dono anterior perde o vínculo.
 *
 * Desamarrar o anterior é deliberado. A alternativa — recusar a carteira já
 * usada — deixaria alguém preso pra sempre se trocasse de conta no Discord, e
 * ainda daria a um atacante o poder de "queimar" a carteira de outro
 * verificando com ela primeiro.
 */
export async function amarra(membro, carteira) {
  const c = carteira.toLowerCase()
  const anterior = await cmd('HGET', CH.dono, c)
  if (anterior && anterior !== membro) await cmd('HDEL', CH.vinculo, anterior)
  await cmd('HSET', CH.vinculo, membro, c)
  await cmd('HSET', CH.dono, c, membro)
  return anterior && anterior !== membro ? anterior : null
}

/** Todos os vínculos: membro -> carteira. É o que a varredura periódica percorre. */
export async function vinculos() {
  const cru = (await cmd('HGETALL', CH.vinculo)) || []
  const m = new Map()
  for (let i = 0; i < cru.length; i += 2) m.set(cru[i], cru[i + 1])
  return m
}

export async function carteiraDe(membro) {
  return (await cmd('HGET', CH.vinculo, membro)) || null
}

export async function desamarra(membro) {
  const c = await cmd('HGET', CH.vinculo, membro)
  if (c) await cmd('HDEL', CH.dono, c)
  await cmd('HDEL', CH.vinculo, membro)
}

// ----------------------------------------------------------------- bloco

export async function ultimoBloco() {
  const v = await cmd('GET', CH.bloco)
  return v == null ? null : Number(v)
}

export async function gravaBloco(n) {
  await cmd('SET', CH.bloco, n)
}
