/**
 * PROVA DO BOTÃO "I sent it — check now".
 *
 *   node teste_conclui.js
 *
 * A pessoa acabou de mandar uma transação e está olhando a tela. A regra que
 * este arquivo protege é uma só: ELA SEMPRE RECEBE UMA RESPOSTA. Não existe
 * caminho que a deixe com "pensando…" pra sempre — nem quando o explorer cai,
 * nem quando a cadeia não responde, nem quando o código estoura.
 */
process.env.UPSTASH_REDIS_REST_URL = 'https://redis.de-mentira'
process.env.UPSTASH_REDIS_REST_TOKEN = 'x'
process.env.SEGREDO = 'segredo-de-teste'
process.env.DISCORD_TOKEN = 'token-de-mentira'

const { conclui } = await import('./lib/conclui.js')
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
const CARTEIRA = '0xaaaa000000000000000000000000000000000001'
const NFT = '0x810b6d1374ac7ba0e83612e7d49f49a13f1de019'
const CARGO = '222222222222222222'
const REGRAS = [{ nome: 'Ronkeverse', cargo: CARGO, tipo: 'ERC-721', contrato: NFT, casas: 0, minimo: 1 }]

const original = globalThis.fetch
const json = (r, status = 200) =>
  new Response(JSON.stringify(r), { status, headers: { 'Content-Type': 'application/json' } })

/**
 * `mundo` monta as três pontes: Redis, explorer/RPC e Discord.
 * Devolve o que foi RESPONDIDO pra pessoa — que é o objeto do teste.
 */
function rede(mundo = {}) {
  const visto = { respostas: [], apertos: 0, reservou: null, amarrou: null, fechou: null }
  globalThis.fetch = async (url, opcoes) => {
    const u = String(url)

    // ---- Discord: a resposta editada é o que a pessoa lê
    if (u.includes('/messages/@original')) {
      visto.respostas.push(JSON.parse(opcoes.body).content)
      return json({})
    }
    if (u.includes('discord.com')) return json({ roles: [] })

    // ---- explorer
    if (u.includes('explorer')) {
      if (mundo.explorerCaiu) return json({}, 503)
      return json({ message: 'OK', result: mundo.pagamentos ?? [] })
    }

    const corpo = JSON.parse(opcoes.body)

    // ---- Redis
    if (Array.isArray(corpo)) {
      const [cmd, chave] = corpo
      if (cmd === 'INCR') {
        visto.apertos++
        return json({ result: mundo.apertosHoje ?? visto.apertos })
      }
      if (cmd === 'SET' && String(chave).startsWith('rl:trab:')) {
        visto.reservou = mundo.reservaTomada ? false : true
        return json({ result: mundo.reservaTomada ? null : 'OK' })
      }
      if (cmd === 'EVAL') {
        visto.amarrou = corpo[corpo.length - 2]
        return json({ result: '' })
      }
      if (cmd === 'HDEL') {
        visto.fechou = chave
        return json({ result: 1 })
      }
      if (cmd === 'HGET' && chave === 'rl:vinculo') return json({ result: mundo.jaTem ?? null })
      if (cmd === 'GET' && chave === 'rl:lords') return json({ result: null })
      return json({ result: null })
    }

    // ---- RPC
    if (mundo.cadeiaCaiu) return json({}, 500)
    if (corpo.method === 'eth_getTransactionByHash') {
      return json({ result: { to: ENDERECO, from: CARTEIRA, hash: corpo.params[0], blockNumber: '0x64' } })
    }
    /*
     * `medidasCairam` derruba SO o `eth_call` -- o pagamento e confirmado
     * normalmente, e o que falha e a leitura do saldo. E o caso que produziu o
     * bug em producao: o bot achou a transacao, nao conseguiu medir nada, e
     * disse "voce nao tem cargo nenhum".
     */
    if (corpo.method === 'eth_call') {
      if (mundo.medidasCairam) return json({}, 500)
      return json({ result: '0x' + (3).toString(16).padStart(64, '0') })
    }
    return json({ result: '0x0' })
  }
  return visto
}

const tx = (extra = {}) => ({
  to: ENDERECO,
  from: CARTEIRA,
  hash: '0xabc',
  value: '10000000000000',
  blockNumber: '100',
  timeStamp: String(Math.floor(Date.now() / 1000)),
  isError: '0',
  ...extra,
})

const roda = (mundo) => {
  const visto = rede(mundo)
  return conclui({
    membro: MEMBRO,
    app: 'app',
    token: 'tok',
    servidor: '1',
    regras: REGRAS,
    segredo: 'segredo-de-teste',
  }).then(() => visto)
}

console.log('\nO BOTAO "I sent it"\n')

// ------------------------------------------------------------ caminho feliz
let v = await roda({ pagamentos: [tx()] })
conf(v.respostas.length === 1, 'responde uma vez', `${v.respostas.length}`)
conf(/Verified/i.test(v.respostas[0]), 'e diz que verificou', v.respostas[0]?.split('\n')[0])
conf(v.amarrou === CARTEIRA, 'amarra a carteira que pagou', v.amarrou)
conf(v.fechou !== null, 'e fecha o pendente')

/*
 * A ORDEM: fechar o pendente e a ULTIMA coisa. Enquanto ele existe, a varredura
 * ainda termina o servico se algo aqui tiver falhado -- nenhum passo do botao e
 * a unica chance de nada.
 */

// ------------------------------------------------- ainda nao apareceu
v = await roda({ pagamentos: [] })
conf(/do not see your transaction yet/i.test(v.respostas[0]), 'sem pagamento: diz que ainda não viu')
conf(/press/i.test(v.respostas[0]), 'e manda apertar de novo — a espera fica com a pessoa')
conf(!/error|fail/i.test(v.respostas[0]), 'sem soar como erro: é o caso comum de apertar rápido')
conf(v.amarrou === null, 'e não amarra nada')

/* ==========================================================================
 * NINGUEM PODE FICAR SEM RESPOSTA
 * ==========================================================================
 * "pensando..." pra sempre e o pior resultado possivel: a pessoa acabou de
 * mandar uma transacao e nao sabe se deu certo, se errou, ou se o bot morreu.
 */
console.log('\nTODO CAMINHO RESPONDE\n')

v = await roda({ explorerCaiu: true })
conf(v.respostas.length === 1, 'explorer fora do ar: responde mesmo assim')
conf(/gas is safe/i.test(v.respostas[0]), 'e a primeira coisa que diz é sobre o dinheiro')

v = await roda({ pagamentos: [tx()], cadeiaCaiu: true })
conf(v.respostas.length === 1, 'cadeia fora do ar: responde mesmo assim')

v = await roda({ reservaTomada: true })
conf(/Still checking/i.test(v.respostas[0]), 'dois cliques seguidos: o segundo não refaz o trabalho')
conf(v.amarrou === null, 'e não amarra nada em paralelo')

v = await roda({ apertosHoje: 999 })
conf(v.respostas.length === 1, 'acima do teto diário: responde')
conf(/automatic check/i.test(v.respostas[0]), 'e diz que existe saída — a varredura continua rodando')
conf(v.reservou === null, 'e nem chega a reservar: o teto vem ANTES do trabalho')

/*
 * TUDO EM INGLES, como o resto do que o membro le.
 */
const todas = []
for (const mundo of [{ pagamentos: [tx()] }, { pagamentos: [] }, { explorerCaiu: true }, { apertosHoje: 999 }]) {
  const r = await roda(mundo)
  todas.push(...r.respostas)
}
conf(
  !/[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/.test(todas.join(' ')),
  'nenhuma resposta do botão tem acento português',
)
conf(!/https?:\/\//.test(todas.join(' ')), 'e nenhuma manda o membro clicar em link')

/* ==========================================================================
 * NAO SABER NAO E "NAO TEM"
 * ==========================================================================
 * Aconteceu em producao: uma carteira com 76.533 $RONKE e 3 Ronkeverse recebeu
 * "It does not hold enough for any role yet". As medidas tinham falhado, `merece`
 * veio vazio, e o vazio foi lido como resposta em vez de como ignorancia.
 *
 * Lista vazia deixa quem escreve a mensagem afirmar sem perceber. Nulo obriga a
 * decidir.
 */
console.log('\nNAO SABER NAO E "NAO TEM"\n')

v = await roda({ pagamentos: [tx()], medidasCairam: true })
conf(
  !/does not hold enough/i.test(v.respostas[0]),
  'pagamento achado mas saldo ilegivel NAO diz "voce nao tem nada"',
  v.respostas[0]?.split('\n')[0],
)
conf(/could not read the chain/i.test(v.respostas[0]), 'diz que nao conseguiu LER')
conf(/did not change any of your roles/i.test(v.respostas[0]), 'e que nao mexeu em nada')

globalThis.fetch = original

console.log(falhas ? `\n${falhas} FALHA(S)\n` : '\nTUDO OK\n')
process.exitCode = falhas ? 1 : 0
