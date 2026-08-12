/**
 * ACHA OS 1/1 — quais tokens têm um trait que não se repete.
 *
 *   node acha1de1.js
 *
 * Roda UMA VEZ e grava `1de1.json`. Não é parte do bot: o bot lê o arquivo.
 *
 * ---------------------------------------------------------------------------
 * POR QUE DERIVAR EM VEZ DE COPIAR DA PÁGINA
 * ---------------------------------------------------------------------------
 * A aba de raridade do site já mostra 107 traits com contagem 1. Só que ela dá
 * NOMES, e o bot precisa de IDs — e ler nome de tela é o tipo de coisa que
 * envelhece calada.
 *
 * Baixando os metadados eu tenho as duas pontas: o trait e o token. E o total
 * derivado tem que bater com os 107 da página — se não bater, uma das duas
 * fontes está errada e é melhor descobrir agora.
 *
 * ---------------------------------------------------------------------------
 * O QUE É "1/1" AQUI
 * ---------------------------------------------------------------------------
 * Um token com pelo menos um VALOR de trait que aparece uma única vez na
 * coleção inteira. É a definição que o dono deu ("os NFTs especiais com traits
 * únicas") e é a que a página de raridade usa.
 */
import { writeFileSync } from 'node:fs'

const BASE = 'https://ronkeverse.s3.us-east-2.amazonaws.com/metadata/ronkeverse_metadata'
const TOTAL = 6969
const PARALELO = 25 // educado com o S3; 6969 em ~1 min

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
    if (!m) {
      falhas++
      continue
    }
    porToken.set(id, m.attributes || [])
  }
  if (i % 1000 < PARALELO) {
    const s = ((Date.now() - inicio) / 1000).toFixed(0)
    process.stdout.write(`  ${porToken.size}/${TOTAL}  (${s}s)\n`)
  }
}

console.log(`\nbaixados: ${porToken.size}   falhas: ${falhas}\n`)

/*
 * FALHA NÃO PODE VIRAR 1/1 POR ENGANO.
 *
 * Se um metadado não baixar, o trait dele some da contagem — e um trait que
 * aparece 2 vezes passaria a contar 1, criando um "1/1" que não existe. Por
 * isso qualquer falha aborta em vez de gravar uma lista errada.
 */
if (falhas > 0) {
  console.error(`ABORTADO: ${falhas} metadado(s) não baixaram.`)
  console.error('Com buraco na coleção, a contagem de raridade mente. Rode de novo.')
  process.exitCode = 1
} else {
  const contagem = new Map()
  for (const attrs of porToken.values()) {
    for (const a of attrs) {
      const chave = `${a.trait_type}|${a.value}`
      contagem.set(chave, (contagem.get(chave) || 0) + 1)
    }
  }

  const unicos = new Set([...contagem].filter(([, n]) => n === 1).map(([k]) => k))
  console.log(`traits que aparecem UMA vez: ${unicos.size}`)

  const oneOfOne = []
  for (const [id, attrs] of porToken) {
    const traits = attrs.filter((a) => unicos.has(`${a.trait_type}|${a.value}`))
    if (traits.length) {
      oneOfOne.push({ id, traits: traits.map((t) => `${t.trait_type}: ${t.value}`) })
    }
  }
  oneOfOne.sort((a, b) => a.id - b.id)

  console.log(`tokens 1/1: ${oneOfOne.length}\n`)
  for (const o of oneOfOne.slice(0, 12)) console.log(`  #${String(o.id).padEnd(5)} ${o.traits[0]}`)
  if (oneOfOne.length > 12) console.log(`  … e mais ${oneOfOne.length - 12}`)

  writeFileSync(
    '1de1.json',
    JSON.stringify(
      {
        _leia: 'Derivado dos metadados em 12/08/2026. Um token é 1/1 se tem algum valor de trait que aparece uma única vez na coleção.',
        total: oneOfOne.length,
        ids: oneOfOne.map((o) => o.id),
        detalhe: oneOfOne,
      },
      null,
      2,
    ) + '\n',
  )
  console.log('\ngravado em 1de1.json')
}
