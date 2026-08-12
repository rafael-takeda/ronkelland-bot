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
// O Discord tambem sai pelo `fetch` dublado; o token so precisa existir pra
// `discord.js` nao recusar antes de chegar la.
process.env.DISCORD_TOKEN = 'token-de-mentira'

const { varreduraDePagamento } = await import('./lib/ciclo.js')
const { enderecoDe } = await import('./lib/prova.js')
const { JANELA_MIN } = await import('./lib/estado.js')

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
/*
 * O TETO SAI DA JANELA, entao o teste tambem: cravar o numero aqui foi o que fez
 * ele quebrar quando a janela dobrou — e um teste que quebra por acompanhar a
 * mudanca certa e um teste que ensina a ignora-lo.
 */
const TETO_ESPERADO = Math.ceil((JANELA_MIN * 60) / 2) + 1
conta = montaRede(AGORA - 5000)
const r = await varreduraDePagamento({ servidor: '1', regras: [], segredo: 'segredo-de-teste' })
conf(conta.blocos <= TETO_ESPERADO, `45 minutos parados NAO viram 5000 blocos abertos (teto ${TETO_ESPERADO})`, `${conta.blocos} blocos`)
conf(conta.blocos < 5000, 'e o corte e de ordem de grandeza, nao cosmetico')
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

/* ==========================================================================
 * DOIS PAGAMENTOS NA MESMA JANELA: FICA O MAIS NOVO
 * ==========================================================================
 * O caso e banal e acontecia: a pessoa manda da carteira errada, se da conta, e
 * manda da certa. As duas caem na mesma janela.
 *
 * A versao anterior processava TODOS, em sequencia, e quem valia era o ULTIMO da
 * lista — que, com o explorer devolvendo em ordem decrescente, era o MAIS VELHO.
 * Ela ganhava o cargo pela carteira certa e o perdia dois segundos depois pela
 * errada, com duas mensagens contraditorias no mesmo balao.
 */
console.log('\nDOIS PAGAMENTOS NA MESMA JANELA\n')

const CERTA = '0xaaaa000000000000000000000000000000000001'
const ERRADA = '0xbbbb000000000000000000000000000000000002'

function redeComDoisPagamentos() {
  const visto = { amarrou: [] }
  globalThis.fetch = async (url, opcoes) => {
    const u = String(url)
    const json = (r) => new Response(JSON.stringify(r), { status: 200, headers: { 'Content-Type': 'application/json' } })

    if (u.includes('explorer')) {
      // Ordem DECRESCENTE, como o explorer devolve de verdade: a mais nova
      // primeiro. E a armadilha: quem pega a ultima da lista pega a mais velha.
      return json({
        message: 'OK',
        result: [
          { to: ENDERECO, from: CERTA, hash: '0xnova', value: '1', blockNumber: '5000', timeStamp: String(Math.floor(Date.now() / 1000)), isError: '0' },
          { to: ENDERECO, from: ERRADA, hash: '0xvelha', value: '1', blockNumber: '4000', timeStamp: String(Math.floor(Date.now() / 1000) - 120), isError: '0' },
        ],
      })
    }

    // Discord: qualquer coisa em discord.com vira resposta vazia de sucesso.
    if (u.includes('discord.com')) return json({ roles: [] })

    const corpo = JSON.parse(opcoes.body)
    if (Array.isArray(corpo)) {
      const [cmd, chave] = corpo
      if (cmd === 'HGETALL') return json({ result: [ENDERECO, JSON.stringify({ membro: MEMBRO, ate: Date.now() + 300_000 })] })
      if (cmd === 'GET' && chave === 'rl:bloco') return json({ result: '4990' })
      if (cmd === 'EVAL') {
        visto.amarrou.push(corpo[corpo.length - 2]) // a carteira, penultimo ARGV
        return json({ result: '' })
      }
      return json({ result: null })
    }
    if (corpo.method === 'eth_blockNumber') return json({ result: '0x1388' })
    if (corpo.method === 'eth_getTransactionByHash') {
      const h = corpo.params[0]
      return json({ result: { to: ENDERECO, from: h === '0xnova' ? CERTA : ERRADA, hash: h, blockNumber: h === '0xnova' ? '0x1388' : '0xfa0' } })
    }
    return json({ result: '0x0' })
  }
  return visto
}

const visto = redeComDoisPagamentos()
const dois = await varreduraDePagamento({ servidor: '1', regras: [], segredo: 'segredo-de-teste' })
conf(dois.pagos === 1, 'dois pagamentos no mesmo endereco viram UM', `${dois.pagos}`)
conf(dois.descartados === 1, 'e o outro e contado como descartado', `${dois.descartados}`)
conf(visto.amarrou.length === 1, 'amarra e chamado uma vez so', `${visto.amarrou.length}x`)
conf(visto.amarrou[0] === CERTA, 'e amarra a carteira do bloco MAIOR, nao a ultima da lista', visto.amarrou[0])

globalThis.fetch = original

console.log(falhas ? `\n${falhas} FALHA(S)\n` : '\nTUDO OK\n')
process.exitCode = falhas ? 1 : 0
