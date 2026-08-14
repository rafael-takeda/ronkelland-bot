/**
 * ACHA OS 1/1 — quais tokens a coleção MARCA como 1/1.
 *
 *   node acha1de1.js
 *
 * Roda uma vez e grava `1de1.json`. Não é parte do bot: o bot lê o resultado.
 *
 * ---------------------------------------------------------------------------
 * A DEFINIÇÃO MUDOU, E VALE CONTAR POR QUÊ
 * ---------------------------------------------------------------------------
 * A primeira versão deste script DERIVAVA a raridade: um token era 1/1 se
 * tivesse algum valor de trait que aparecesse uma única vez na coleção. O total
 * bateu com os 107 da aba de raridade do site, e por isso pareceu certo.
 *
 * Não era. A coleção tem um trait EXPLÍCITO chamado `Special`, com três valores:
 *
 *     143  Halloween 2025     <- não é 1/1, fica de fora
 *     107  Community 1/1
 *      52  1/1
 *
 * A heurística caía exatamente em cima dos 107 "Community 1/1" — cada um deles
 * tem um segundo trait com valor único, e era esse que ela pegava. Os 52 "1/1"
 * puros não têm trait único nenhum, então ficavam invisíveis pra ela. O bot
 * nunca deu o cargo pra eles.
 *
 * A lição: contar raridade é inferir o que o dono da coleção quis dizer. O
 * trait é o que ele escreveu. Quando existir o escrito, usa o escrito.
 *
 * A heurística continua rodando aqui — não pra decidir, mas pra AVISAR se um
 * dia os dois discordarem de um jeito novo.
 */
import { writeFileSync } from 'node:fs'

const BASE = 'https://ronkeverse.s3.us-east-2.amazonaws.com/metadata/ronkeverse_metadata'
const TOTAL = 6969
const PARALELO = 25 // educado com o S3; 6969 em ~1 min

/** Os valores de `Special` que dão o cargo. `Halloween 2025` não é 1/1. */
const VALEM = ['1/1', 'Community 1/1']

async function baixa(id) {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    try {
      const r = await fetch(`${BASE}/${id}`, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/126' } })
      if (r.ok) return await r.json()
    } catch {
      /* tenta de novo */
    }
    await new Promise((f) => setTimeout(f, 200 * (tentativa + 1)))
  }
  return null
}

console.log(`baixando ${TOTAL} metadados, ${PARALELO} de cada vez…\n`)

const porToken = new Map()
let falhas = 0
const inicio = Date.now()

for (let i = 1; i <= TOTAL; i += PARALELO) {
  const lote = []
  for (let j = i; j < i + PARALELO && j <= TOTAL; j++) lote.push(j)
  const res = await Promise.all(lote.map((id) => baixa(id).then((m) => [id, m])))
  for (const [id, m] of res) {
    if (!m) { falhas++; continue }
    porToken.set(id, m.attributes || [])
  }
  if (i % 1500 < PARALELO) {
    console.log(`  ${porToken.size}/${TOTAL}  (${((Date.now() - inicio) / 1000).toFixed(0)}s)`)
  }
}

console.log(`\nbaixados: ${porToken.size}   falhas: ${falhas}\n`)

/*
 * FALHA NÃO PODE VIRAR LISTA CURTA.
 *
 * Se um metadado não baixar, o token some da lista e o dono dele perde o cargo
 * sem nunca ter vendido nada. Buraco na coleção invalida a rodada inteira.
 */
if (falhas > 0) {
  console.error(`ABORTADO: ${falhas} metadado(s) não baixaram.`)
  console.error('Com buraco na coleção, a lista sai curta e alguém perde o cargo à toa. Rode de novo.')
  process.exit(1)
}

/*
 * TODOS os `Special`, não o primeiro.
 *
 * Existe pelo menos um token com DOIS traits `Special` — um deles Halloween e o
 * outro 1/1. Ler só o primeiro faz o resultado depender da ordem em que o S3
 * gravou o JSON, e nessa loteria o token some da lista se Halloween vier antes.
 */
const especiaisDe = (attrs) => attrs.filter((a) => a.trait_type === 'Special').map((a) => a.value)

// ------------------------------------------------------ o que a coleção diz
const porValor = new Map()
for (const [id, attrs] of porToken) {
  for (const v of especiaisDe(attrs)) {
    if (!porValor.has(v)) porValor.set(v, [])
    porValor.get(v).push(id)
  }
}

const comDoisEspeciais = [...porToken].filter(([, a]) => especiaisDe(a).length > 1)
if (comDoisEspeciais.length) {
  console.log('tokens com MAIS DE UM trait Special:')
  for (const [id, a] of comDoisEspeciais) console.log(`  #${id}: ${especiaisDe(a).join(' + ')}`)
  console.log('')
}

console.log('o trait `Special` na coleção:')
for (const [valor, ids] of [...porValor].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(ids.length).padStart(5)}  ${valor}${VALEM.includes(valor) ? '   <- vale' : ''}`)
}

// Set: um token marcado com os dois valores entraria duas vezes na lista.
const escolhidos = [...new Set(VALEM.flatMap((v) => porValor.get(v) || []))].sort((a, b) => a - b)
console.log(`\ntokens que valem o cargo: ${escolhidos.length}\n`)

// ------------------------------------------------- a heurística velha, só como alarme
const contagem = new Map()
for (const attrs of porToken.values()) {
  for (const a of attrs) {
    const chave = `${a.trait_type}|${a.value}`
    contagem.set(chave, (contagem.get(chave) || 0) + 1)
  }
}
const unicos = new Set([...contagem].filter(([, n]) => n === 1).map(([k]) => k))
const porHeuristica = new Set(
  [...porToken].filter(([, attrs]) => attrs.some((a) => unicos.has(`${a.trait_type}|${a.value}`))).map(([id]) => id),
)
const escolhidosSet = new Set(escolhidos)
const soNaHeuristica = [...porHeuristica].filter((id) => !escolhidosSet.has(id)).sort((a, b) => a - b)

if (soNaHeuristica.length) {
  console.log('AVISO: tokens com trait único que NÃO estão marcados como 1/1:')
  console.log('  ' + soNaHeuristica.slice(0, 30).join(', ') + (soNaHeuristica.length > 30 ? ` … (${soNaHeuristica.length})` : ''))
  console.log('  Se isso for novo, a coleção pode ter ganhado 1/1 sem o trait — confira antes de publicar.\n')
} else {
  console.log('confere: todo token com trait único também está marcado como 1/1.\n')
}

const detalhe = escolhidos.map((id) => ({ id, especial: especiaisDe(porToken.get(id)).join(" + ") }))
for (const d of detalhe.slice(0, 8)) console.log(`  #${String(d.id).padEnd(5)} ${d.especial}`)
if (detalhe.length > 8) console.log(`  … e mais ${detalhe.length - 8}`)

writeFileSync(
  '1de1.json',
  JSON.stringify(
    {
      _leia:
        `Dos metadados, pelo trait Special. Vale ${VALEM.map((v) => `"${v}"`).join(' e ')}; ` +
        '"Halloween 2025" NAO e 1/1 e fica de fora. Nao inferir por contagem de trait raro: ' +
        'a versao anterior fazia isso e perdia os 52 do valor "1/1", que nao tem trait unico.',
      total: escolhidos.length,
      porValor: Object.fromEntries(VALEM.map((v) => [v, (porValor.get(v) || []).length])),
      ids: escolhidos,
      detalhe,
    },
    null,
    2,
  ) + '\n',
)
console.log('\ngravado em 1de1.json')
