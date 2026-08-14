/**
 * PUBLICA A LISTA NOVA DE 1/1 — no arquivo e no Redis.
 *
 *   node --env-file=.env atualiza1de1.js          (só mostra o que faria)
 *   node --env-file=.env atualiza1de1.js --grava  (grava de verdade)
 *
 * São DOIS lugares porque produção lê o Redis; o `regras.json` só vale enquanto
 * o painel nunca escreveu, e ele já escreveu. Atualizar só o arquivo não muda
 * nada pra ninguém.
 *
 * Antes de gravar, o valor atual do Redis vai pra um arquivo com carimbo de
 * hora. Regra é a coisa que decide quem tem cargo: sobrescrever sem cópia é o
 * tipo de coisa que só dói depois.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const GRAVA = process.argv.includes('--grava')
const URL_ = process.env.UPSTASH_REDIS_REST_URL
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN
if (!URL_ || !TOKEN) { console.error('faltam as variáveis do Upstash no .env'); process.exit(1) }

async function redis(...comando) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(comando),
  })
  const j = await r.json()
  if (j.error) throw new Error(j.error)
  return j.result
}

const novos = JSON.parse(readFileSync('1de1.json', 'utf8'))
console.log(`1de1.json tem ${novos.total} ids  (${JSON.stringify(novos.porValor)})\n`)

const diferenca = (antes, depois) => {
  const a = new Set(antes)
  const d = new Set(depois)
  return {
    entram: depois.filter((x) => !a.has(x)),
    saem: antes.filter((x) => !d.has(x)),
  }
}

// ------------------------------------------------------------- o arquivo
const arquivo = JSON.parse(readFileSync('regras.json', 'utf8'))
const noArquivo = arquivo.regras.find((r) => r.tipo === 'ERC-721-ids')
if (!noArquivo) {
  console.error('regras.json não tem regra ERC-721-ids — nada a fazer nele.')
} else {
  const d = diferenca(noArquivo.ids, novos.ids)
  console.log(`regras.json — "${noArquivo.nome}": ${noArquivo.ids.length} -> ${novos.ids.length}`)
  console.log(`  entram ${d.entram.length}, saem ${d.saem.length}`)
  if (GRAVA) {
    noArquivo.ids = novos.ids
    noArquivo._leia =
      `Regra de POSSE DE ID: ter QUALQUER um destes ${novos.ids.length}. Do trait Special ` +
      `("1/1" e "Community 1/1"), pelo acha1de1.js. Halloween 2025 nao entra.`
    writeFileSync('regras.json', JSON.stringify(arquivo, null, 2) + '\n')
    console.log('  gravado.')
  }
}

// --------------------------------------------------------------- o Redis
const cru = await redis('GET', 'rl:regras')
if (!cru) {
  console.log('\nrl:regras está vazio — produção usa o arquivo, e ele já foi tratado acima.')
  process.exit(0)
}

const doRedis = JSON.parse(cru)
const lord = doRedis.find((r) => r.tipo === 'ERC-721-ids')
if (!lord) {
  console.log('\nrl:regras não tem regra ERC-721-ids — o cargo de 1/1 não está ativo em produção.')
  process.exit(0)
}

const d = diferenca(lord.ids, novos.ids)
console.log(`\nRedis (PRODUÇÃO) — "${lord.nome}": ${lord.ids.length} -> ${novos.ids.length}`)
console.log(`  entram ${d.entram.length}: ${d.entram.slice(0, 20).join(', ')}${d.entram.length > 20 ? ' …' : ''}`)
console.log(`  saem   ${d.saem.length}${d.saem.length ? ': ' + d.saem.join(', ') : ''}`)

/*
 * SAIR é o caso perigoso: alguém que tem o cargo hoje perderia. Só acontece se
 * a coleção mudou ou se a definição apertou — nos dois casos é decisão humana,
 * não coisa pra script fazer sozinho.
 */
if (d.saem.length) {
  console.log('\n  ATENÇÃO: alguém perderia o cargo. Confira essa lista antes de gravar.')
}

if (!GRAVA) {
  console.log('\n(nada foi gravado — rode com --grava)')
  process.exit(0)
}

const carimbo = new Date().toISOString().replace(/[:.]/g, '-')
const copia = `.backup-regras-${carimbo}.json`
writeFileSync(copia, cru + '\n')
console.log(`\n  cópia do valor atual em ${copia}`)

lord.ids = novos.ids
await redis('SET', 'rl:regras', JSON.stringify(doRedis))

// Lê de volta: confirmar que gravou é diferente de assumir que gravou.
const conferindo = JSON.parse(await redis('GET', 'rl:regras'))
const agora = conferindo.find((r) => r.tipo === 'ERC-721-ids')
console.log(`  gravado. Lendo de volta: ${agora.ids.length} ids.`)
console.log(agora.ids.length === novos.ids.length ? '  confere.' : '  NÃO CONFERE — olhe o Redis.')
