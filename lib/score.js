/**
 * ============================================================================
 * RONKE SCORE — o cargo que não está à venda
 * ============================================================================
 *
 * As outras regras deste bot perguntam QUANTO a carteira tem. Um cargo por
 * quantidade é comprável: quem quiser o @Ronke Chad compra 1.000.000 de $RONKE
 * hoje e é Chad hoje.
 *
 * O Ronke Score não é isso. Ele soma há QUANTO TEMPO a pessoa segura, se já
 * vendeu, quantos tipos de corpo coleciona, se tem 1/1. Não dá pra comprar num
 * clique — só dá pra ter feito. É a única regra aqui que mede história.
 *
 * ---------------------------------------------------------------------------
 * ISTO NÃO É A CADEIA, E A DIFERENÇA IMPORTA
 * ---------------------------------------------------------------------------
 * O resto do bot lê a cadeia: a resposta é o estado deste segundo. O score é uma
 * FOTOGRAFIA, refeita uma vez por dia às 07:00 UTC. Quem comprar $RONKE agora só
 * vê o score mexer amanhã.
 *
 * Isso não é defeito, mas muda o que se pode prometer: o cargo por score aparece
 * no dia seguinte, e é isso que a mensagem tem que dizer. Prometer "na hora"
 * geraria um fluxo de gente reclamando que o bot está quebrado quando ele está
 * exatamente certo.
 *
 * ---------------------------------------------------------------------------
 * "NÃO TEM SCORE" É RESPOSTA. "NÃO CONSEGUI PERGUNTAR" NÃO É.
 * ---------------------------------------------------------------------------
 * A API guarda só quem pontua: carteira desconhecida volta 200 com found:false.
 * Isso é ZERO, e é uma resposta legítima.
 *
 * Qualquer outra coisa — rede caiu, 500, JSON estranho — devolve `ok:false`, e
 * quem chama NÃO pode ler isso como zero. Mesma disciplina do `saldoSeguro`:
 * tirar cargo porque um servidor piscou é o pior erro deste sistema, porque o
 * membro não fez nada e nem descobre por quê.
 */

const BASE = process.env.RONKE_SCORE_API || 'https://ronke-analytics.vercel.app/api/v1'

/** Identifica quem está chamando. A API é aberta e sem chave; o mínimo é dizer quem é. */
const AGENTE = 'ronkelland-bot (+https://github.com/rafael-takeda/ronkelland-bot)'

/** Teto do lote na API. Passar disso é 400, não é corte silencioso. */
const LOTE = 50

/**
 * MEMÓRIA CURTA.
 *
 * O dado muda uma vez por dia, então perguntar duas vezes na mesma passada é
 * desperdício puro. Quinze minutos é o mesmo tempo que a API guarda na borda —
 * não adianta ser mais esperto que ela.
 *
 * FALHA NUNCA ENTRA AQUI. Guardar um "não consegui" transformaria uma piscada de
 * rede de 1 segundo em 15 minutos de gente sem cargo.
 */
const memoria = new Map()
const VALIDADE_MS = 15 * 60 * 1000

function lembrado(carteira) {
  const m = memoria.get(carteira)
  if (!m) return null
  if (Date.now() - m.quando > VALIDADE_MS) {
    memoria.delete(carteira)
    return null
  }
  return m.valor
}

function guarda(carteira, valor) {
  memoria.set(carteira, { valor, quando: Date.now() })
}

/** Só pros testes: começa do zero. */
export function esqueceTudo() {
  memoria.clear()
}

async function pega(caminho) {
  const r = await fetch(BASE + caminho, {
    headers: { 'User-Agent': AGENTE, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return await r.json()
}

/**
 * Uma linha de resultado da API vira a nossa.
 *
 * `found` é o único caminho que produz zero. Faltar o campo `score` num objeto
 * que diz found:true é resposta corrompida, e resposta corrompida não é zero.
 */
function leLinha(d, as_of) {
  if (!d || typeof d !== 'object') return { ok: false, score: 0 }
  if (d.found === false) return { ok: true, score: 0, rank: null, percentil: null, as_of }
  if (typeof d.score !== 'number' || !Number.isFinite(d.score)) return { ok: false, score: 0 }
  return {
    ok: true,
    score: d.score,
    rank: typeof d.rank === 'number' ? d.rank : null,
    percentil: typeof d.percentile === 'number' ? d.percentile : null,
    as_of,
  }
}

/**
 * O Ronke Score de UMA carteira.
 *
 * `{ ok:false }` significa "não consegui perguntar" — ver o cabeçalho.
 */
export async function scoreDe(carteira) {
  const chave = String(carteira).toLowerCase()
  const antes = lembrado(chave)
  if (antes) return antes

  try {
    const j = await pega(`/score/${chave}`)
    const v = leLinha(j?.data, j?.meta?.as_of)
    if (v.ok) guarda(chave, v)
    return v
  } catch (e) {
    return { ok: false, score: 0, erro: e.message }
  }
}

/**
 * PRÉ-AQUECE várias carteiras de uma vez.
 *
 * A revarredura passa por todo mundo que já verificou. Uma chamada por membro
 * funcionaria, mas a API tem endpoint de lote justamente pra isso: 50 carteiras
 * numa ida em vez de 50 idas.
 *
 * Não devolve nada de propósito — só enche a memória, e o `scoreDe` de sempre
 * passa a responder na hora. Assim nenhum caminho de decisão precisa saber que
 * este atalho existe, e esquecer de chamar aqui deixa o bot mais lento, nunca
 * mais errado.
 */
export async function preaquece(carteiras) {
  const unicas = [...new Set(carteiras.map((c) => String(c).toLowerCase()))]
    .filter((c) => /^0x[0-9a-f]{40}$/.test(c) && !lembrado(c))
    .sort() // ordenado dá mais acerto no cache da borda; a API pede isso.

  for (let i = 0; i < unicas.length; i += LOTE) {
    const fatia = unicas.slice(i, i + LOTE)
    try {
      const j = await pega(`/scores?addresses=${fatia.join(',')}`)
      const as_of = j?.meta?.as_of
      /*
       * Casado por ENDEREÇO, não por posição. A API promete a mesma ordem, mas
       * confiar na ordem é o tipo de acoplamento que quebra calado no dia em que
       * ela mudar — e o estrago seria dar o score de um membro pra outro.
       */
      for (const linha of j?.data?.scores || []) {
        const end = String(linha?.address || '').toLowerCase()
        if (!end) continue
        const v = leLinha(linha, as_of)
        if (v.ok) guarda(end, v)
      }
    } catch {
      // Lote que falhou não é problema: `scoreDe` pergunta de novo, uma a uma, e
      // aí sim decide entre "zero" e "não consegui". Isto aqui é só velocidade.
    }
  }
}
