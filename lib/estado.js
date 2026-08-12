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

/**
 * Minutos que a pessoa tem pra mandar a transação depois de clicar.
 *
 * ERAM 5, e o número vinha do custo de procurar: a busca abria bloco por bloco,
 * então cada minuto de janela custava ~20 chamadas ao RPC. Cinco minutos era o
 * que dava pra pagar.
 *
 * Com o explorer a busca virou uma chamada por endereço, e o custo parou de
 * depender do tempo. Aí a janela passa a ser escolhida pelo que serve à pessoa,
 * e não pelo que o RPC aguenta.
 *
 * DEZ, E NÃO MAIS QUE ISSO, por causa de um limite do outro lado: o aviso de
 * confirmação viaja no token da interação, que morre em 15 minutos. Uma janela
 * de 15 deixaria quem paga no último minuto sem aviso nenhum. Dez deixa cinco
 * minutos de folga.
 *
 * O ganho concreto: a varredura pode ficar dez minutos fora do ar sem que
 * ninguém perca o gas — antes eram cinco, e hoje ela ficou fora mais que isso.
 */
export const JANELA_MIN = Number(process.env.JANELA_MIN || 10)

const CH = {
  pendentes: 'rl:pendentes', // hash endereço -> {membro, ate}
  vinculo: 'rl:vinculo', // hash membro -> carteira
  dono: 'rl:dono', // hash carteira -> membro
  bloco: 'rl:bloco',
  regras: 'rl:regras', // json das regras, quando o painel as escreve
  auditoria: 'rl:auditoria', // lista: quem mudou o quê e quando
  rascunho: 'rl:rascunho', // hash membro -> cadastro pela metade
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
export async function abrePendente(membro, endereco, aviso) {
  const ate = Date.now() + JANELA_MIN * 60_000
  /*
   * O ENDEREÇO DE VOLTA PRA PESSOA vai junto.
   *
   * `aviso` guarda a webhook da interação (aplicação + token). Quem termina a
   * verificação é a varredura, minutos depois, num processo que não tem nenhuma
   * ligação com o clique — sem guardar isto aqui, ela não teria como responder a
   * quem esperou, e o fluxo acabaria em silêncio.
   */
  await cmd('HSET', CH.pendentes, endereco.toLowerCase(), JSON.stringify({ membro, ate, aviso }))
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

// ---------------------------------------------------------------- regras

/**
 * AS REGRAS, QUANDO O PAINEL AS ESCREVE.
 *
 * Nulo significa "o painel nunca mexeu" — e aí vale o `regras.json`. É uma
 * escolha e não um acidente: um servidor que nunca abriu o painel continua
 * rodando exatamente o que está no arquivo revisado, e a existência do painel
 * não muda nada pra quem não o usa.
 */
export async function regrasGuardadas() {
  const v = await cmd('GET', CH.regras)
  if (!v) return null
  try {
    const r = JSON.parse(v)
    return Array.isArray(r) ? r : null
  } catch {
    /*
     * JSON corrompido vira "nunca mexeu", e NÃO vira lista vazia. Lista vazia
     * significaria "nenhuma regra", e nenhuma regra significa que a revarredura
     * tira o cargo de todo mundo. Cair de volta no arquivo é o erro seguro.
     */
    return null
  }
}

export async function guardaRegras(regras) {
  await cmd('SET', CH.regras, JSON.stringify(regras))
}

// -------------------------------------------------------------- histórico

/**
 * QUEM MUDOU O QUÊ, E QUANDO.
 *
 * Enquanto a regra morava só no arquivo, o histórico vinha de graça do git. O
 * painel tira isso — então ele tem que devolver. Sem este registro, "por que
 * perdi meu cargo?" não teria resposta, e a pergunta vai acontecer.
 *
 * Cinquenta entradas: o bastante pra reconstruir uma discussão recente, pouco o
 * bastante pra caber numa mensagem do Discord.
 */
export async function anota(quem, acao, detalhe) {
  await cmd('LPUSH', CH.auditoria, JSON.stringify({ quando: Date.now(), quem, acao, detalhe }))
  await cmd('LTRIM', CH.auditoria, 0, 49)
}

export async function historico(quantos = 10) {
  const cru = (await cmd('LRANGE', CH.auditoria, 0, quantos - 1)) || []
  return cru
    .map((l) => {
      try {
        return JSON.parse(l)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

// --------------------------------------------------------------- rascunho

/**
 * O MEIO DE UM CADASTRO.
 *
 * Criar regra são dois passos: a janelinha pede contrato e mínimo, e o cargo vem
 * de uma lista depois — porque o Discord não deixa pôr seletor de cargo dentro
 * de janelinha. Entre um e outro, o que já foi digitado fica aqui.
 *
 * Dez minutos e morre. Rascunho esquecido não pode virar regra amanhã.
 */
export async function guardaRascunho(membro, dados) {
  await cmd('HSET', CH.rascunho, membro, JSON.stringify({ ...dados, ate: Date.now() + 600_000 }))
}

export async function rascunhoDe(membro) {
  const v = await cmd('HGET', CH.rascunho, membro)
  if (!v) return null
  try {
    const d = JSON.parse(v)
    if (Date.now() > d.ate) {
      await cmd('HDEL', CH.rascunho, membro)
      return null
    }
    return d
  } catch {
    return null
  }
}

export async function apagaRascunho(membro) {
  await cmd('HDEL', CH.rascunho, membro)
}
