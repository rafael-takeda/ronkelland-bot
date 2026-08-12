/**
 * ============================================================================
 * O ENDPOINT NA VERCEL — a URL que vai no painel do Discord
 * ============================================================================
 *
 * `General Information` -> `Interactions Endpoint URL`.
 *
 * ---------------------------------------------------------------------------
 * `bodyParser: false` NAO E OPCIONAL AQUI
 * ---------------------------------------------------------------------------
 * A assinatura do Discord cobre os BYTES do corpo. A Vercel, por padrao, faz
 * `JSON.parse` antes de entregar -- e o objeto parseado nao remonta nos mesmos
 * bytes (ordem de chave, espacamento, escape). Com o parser ligado, a validacao
 * falharia SEMPRE, e o sintoma seria o painel do Discord recusando a URL sem
 * dizer o motivo.
 *
 * Por isso o corpo e lido do fluxo, a mao, e so depois parseado.
 */
import { valida } from '../lib/assinatura.js'
import { decide } from '../lib/interacao.js'
import { agenda } from '../lib/depois.js'

export const config = { api: { bodyParser: false } }

function corpoCru(req) {
  return new Promise((resolve, reject) => {
    let dados = ''
    req.setEncoding('utf8')
    req.on('data', (p) => {
      dados += p
      // Teto: a URL e publica, entao um corpo infinito e so questao de alguem
      // querer.
      if (dados.length > 100_000) reject(new Error('corpo grande demais'))
    })
    req.on('end', () => resolve(dados))
    req.on('error', reject)
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('só POST')

  let corpo
  try {
    corpo = await corpoCru(req)
  } catch {
    return res.status(413).send('corpo grande demais')
  }

  const ok = valida(
    corpo,
    req.headers['x-signature-ed25519'],
    req.headers['x-signature-timestamp'],
    process.env.DISCORD_PUBLIC_KEY,
  )
  // 401 e EXIGIDO pelo Discord: e assim que ele testa a URL antes de aceitar.
  if (!ok) return res.status(401).send('assinatura inválida')

  let dados
  try {
    dados = JSON.parse(corpo)
  } catch {
    return res.status(400).send('json inválido')
  }

  /*
   * ---------------------------------------------------------------------------
   * TRABALHO DEPOIS DA RESPOSTA SÓ EXISTE COM `waitUntil`
   * ---------------------------------------------------------------------------
   * O Discord só aceita mensagem de acompanhamento em interação já respondida,
   * então ela tem que sair DEPOIS do `json()`. Mas a Vercel suspende a invocação
   * junto com a resposta — medido: ECONNRESET contra discord.com antes do TLS
   * fechar, e numa das tentativas nem o log de erro saiu.
   *
   * `agenda` (lib/depois.js) segura a invocação quando o host oferece isso. Nada
   * importante passa por ali: se falhar, o que se perde é conveniência.
   */
  let depois = null
  try {
    const decisao = await decide(dados, { segredo: process.env.SEGREDO })
    if (decisao.log) {
      console.log(
        decisao.log.acao,
        decisao.log.membro,
        decisao.log.endereco ?? '',
        decisao.log.waitUntil === undefined ? '' : `waitUntil=${decisao.log.waitUntil}`,
      )
    }
    depois = decisao.depois
    res.status(200).json(decisao.resposta)
  } catch (e) {
    // Erro vira resposta VALIDA: interacao sem resposta fica "pensando" pra
    // sempre na tela da pessoa.
    console.error('[erro]', e)
    /*
     * `headersSent` porque a resposta pode JA TER SAIDO. Sem esta guarda, uma
     * falha depois do `json()` tentaria responder duas vezes e derrubaria a
     * invocacao com ERR_HTTP_HEADERS_SENT -- trocando um erro pequeno por um
     * erro grande.
     */
    if (!res.headersSent) {
      res.status(200).json({
        type: 4,
        data: { content: 'Something went wrong on my side. Try again in a minute.', flags: 64 },
      })
    }
    return
  }

  if (depois) {
    await agenda(async () => {
      const r = await depois()
      /*
       * Nem todo trabalho devolve algo: `conclui` responde por conta propria e
       * nao retorna nada. Tratar "sem retorno" como falha produzia um log que
       * gritava erro num caminho que tinha funcionado -- e log que mente custa
       * mais caro que log que falta.
       */
      if (r && typeof r.ok === 'boolean') {
        console.log('[depois]', r.ok ? 'entregue' : `falhou ${r.status ?? '?'}`)
      } else {
        console.log('[depois] concluido')
      }
    })
  }
}
