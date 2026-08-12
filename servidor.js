/**
 * ============================================================================
 * O SERVIDOR — recebe os cliques do Discord
 * ============================================================================
 *
 *   node --env-file=.env servidor.js
 *
 * Só transporte: lê o corpo cru, confere a assinatura, entrega pra `decide` e
 * devolve a resposta. A decisão mora em `lib/interacao.js`.
 *
 * ---------------------------------------------------------------------------
 * O CORPO É LIDO CRU, E ISSO NÃO É DETALHE
 * ---------------------------------------------------------------------------
 * A assinatura do Discord cobre os BYTES do corpo. Qualquer framework que faça
 * `JSON.parse` antes quebra a validação pra sempre — e o sintoma é "nunca
 * valida", sem pista de por quê.
 *
 * Por isso aqui não há framework: o corpo é acumulado como texto, validado, e
 * só DEPOIS parseado.
 */
import { createServer } from 'node:http'
import { valida } from './lib/assinatura.js'
import { decide } from './lib/interacao.js'

const PORTA = Number(process.env.PORTA || 8787)
const CHAVE = process.env.DISCORD_PUBLIC_KEY
const SEGREDO = process.env.SEGREDO

for (const [nome, v] of [
  ['DISCORD_PUBLIC_KEY', CHAVE],
  ['SEGREDO', SEGREDO],
  ['UPSTASH_REDIS_REST_URL', process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL],
]) {
  if (!v) {
    console.error(`Falta ${nome}. Sem ele o bot não sobe.`)
    process.exit(1)
  }
}

const servidor = createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405).end('só POST')
    return
  }

  let corpo = ''
  req.setEncoding('utf8')
  req.on('data', (p) => {
    corpo += p
    /*
     * TETO DE TAMANHO. Sem isto, uma requisição infinita consome a memória do
     * processo — e a URL é pública, então basta alguém querer.
     */
    if (corpo.length > 100_000) {
      res.writeHead(413).end('corpo grande demais')
      req.destroy()
    }
  })

  req.on('end', async () => {
    const ok = valida(
      corpo,
      req.headers['x-signature-ed25519'],
      req.headers['x-signature-timestamp'],
      CHAVE,
    )
    /*
     * 401 SEM EXPLICAÇÃO, de propósito. O Discord EXIGE que uma assinatura
     * inválida receba 401 — é assim que ele testa a URL no painel antes de
     * aceitá-la. E quem não é o Discord não merece uma dica do que faltou.
     */
    if (!ok) {
      res.writeHead(401).end('assinatura inválida')
      return
    }

    let dados
    try {
      dados = JSON.parse(corpo)
    } catch {
      res.writeHead(400).end('json inválido')
      return
    }

    try {
      const { resposta, log } = await decide(dados, { segredo: SEGREDO })
      if (log) console.log(`[${new Date().toISOString()}]`, log.acao, log.membro, log.endereco ?? '')
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(resposta))
    } catch (e) {
      /*
       * Erro interno vira resposta VÁLIDA, não 500. Interação sem resposta fica
       * "pensando" pra sempre na tela da pessoa — melhor uma frase honesta.
       */
      console.error('[erro]', e)
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          type: 4,
          data: { content: 'Something went wrong on my side. Try again in a minute.', flags: 64 },
        }),
      )
    }
  })
})

servidor.listen(PORTA, () => {
  console.log(`RonkeLand ouvindo na porta ${PORTA}`)
  console.log('A URL pública deste servidor vai no painel do Discord, em')
  console.log('"General Information" -> "Interactions Endpoint URL".')
})
