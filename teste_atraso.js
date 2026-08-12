/**
 * PROVA DO TETO DE ATRASO.
 *
 *   node teste_atraso.js
 *
 * O ponteiro da varredura só avança quando uma passada termina inteira. Se ela
 * morrer no meio — e morreu, com um 429 do RPC —, ele fica parado e a passada
 * seguinte tenta varrer TUDO que passou desde então, bloco por bloco.
 *
 * Isso vira espiral: 45 minutos parados são ~900 blocos pra abrir, que demoram
 * minutos, que torram a cota do RPC, que derruba a passada de novo — e cada
 * volta deixa o buraco maior.
 *
 * Aqui a rede inteira é de mentira (Redis e RPC saem os dois pelo `fetch`), e o
 * que se mede é UMA coisa: quantos blocos ela abre.
 */
process.env.UPSTASH_REDIS_REST_URL = 'https://redis.de-mentira'
process.env.UPSTASH_REDIS_REST_TOKEN = 'x'
process.env.SEGREDO = 'segredo-de-teste'

const { varreduraDePagamento } = await import('./lib/ciclo.js')
const { enderecoDe } = await import('./lib/prova.js')

let falhas = 0
const conf = (c, m, e = '') => {
  if (!c) {
    falhas++
    console.error('  FALHOU  ' + m + '  ' + e)
  } else console.log('  ok      ' + m + (e ? '  ' + e : ''))
}

const MEMBRO = '111111111111111111'
const ENDERECO = enderecoDe(MEMBRO, 'segredo-de-teste').toLowerCase()
const AGORA = 60_000_000

/**
 * Rede de mentira pras duas pontas. `parouEm` é onde o ponteiro ficou.
 * Devolve o contador de blocos abertos.
 */
function montaRede(parouEm) {
  const conta = { blocos: 0, gravou: null }
  globalThis.fetch = async (url, opcoes) => {
    const corpo = JSON.parse(opcoes.body)
    const json = (r) => new Response(JSON.stringify(r), { status: 200, headers: { 'Content-Type': 'application/json' } })

    // ---- Redis: o corpo é um array ["COMANDO", ...]
    if (Array.isArray(corpo)) {
      const [cmd, chave] = corpo
      if (cmd === 'HGETALL') {
        return json({ result: [ENDERECO, JSON.stringify({ membro: MEMBRO, ate: Date.now() + 300_000 })] })
      }
      if (cmd === 'GET' && chave === 'rl:bloco') return json({ result: String(parouEm) })
      if (cmd === 'SET') {
        conta.gravou = Number(corpo[2])
        return json({ result: 'OK' })
      }
      return json({ result: null })
    }

    // ---- RPC
    if (corpo.method === 'eth_blockNumber') return json({ result: '0x' + AGORA.toString(16) })
    if (corpo.method === 'eth_getBlockByNumber') {
      conta.blocos++
      return json({ result: { transactions: [] } })
    }
    return json({ result: '0x0' })
  }
  return conta
}

const original = globalThis.fetch
console.log('\nO TETO DE ATRASO\n')

// ---------------------------------------------- atraso normal: varre tudo
let conta = montaRede(AGORA - 20)
await varreduraDePagamento({ servidor: '1', regras: [], segredo: 'segredo-de-teste' })
conf(conta.blocos === 20, 'atraso pequeno é varrido inteiro', `${conta.blocos} blocos`)

/*
 * ATRASO GRANDE É CORTADO, e não se perde nada com isso: a janela de verificação
 * são 5 minutos (~100 blocos). Pagamento mais velho pertence a um pendente que
 * já venceu — varrer atrás dele é gastar chamada pra achar o que não vale mais.
 */
conta = montaRede(AGORA - 5000)
const r = await varreduraDePagamento({ servidor: '1', regras: [], segredo: 'segredo-de-teste' })
conf(conta.blocos <= 201, '45 minutos parados NÃO viram 900 blocos abertos', `${conta.blocos} blocos`)
conf(r.pulou > 4000, 'e o log conta quantos foram pulados', `pulou ${r.pulou}`)

/*
 * E O PONTEIRO ALCANÇA O AGORA. Se ele avançasse só até onde varreu, o atraso
 * nunca seria recuperado e toda passada seguinte pularia de novo — a espiral
 * continuaria, só que em silêncio.
 */
conf(conta.gravou === AGORA, 'o ponteiro pula pro bloco atual, encerrando o atraso', String(conta.gravou))

// ------------------------------------------- sem ninguém esperando, nada
globalThis.fetch = async (url, opcoes) => {
  const corpo = JSON.parse(opcoes.body)
  if (Array.isArray(corpo)) return new Response(JSON.stringify({ result: [] }), { status: 200 })
  throw new Error('não devia ter tocado no RPC')
}
const vazio = await varreduraDePagamento({ servidor: '1', regras: [], segredo: 'segredo-de-teste' })
conf(vazio.pendentes === 0, 'fila vazia sai sem abrir bloco nenhum')

globalThis.fetch = original

console.log(falhas ? `\n${falhas} FALHA(S)\n` : '\nTUDO OK\n')
process.exitCode = falhas ? 1 : 0
