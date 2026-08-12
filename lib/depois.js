/**
 * ============================================================================
 * TRABALHO DEPOIS DA RESPOSTA — se o host deixar
 * ============================================================================
 *
 * O Discord exige resposta em 3 segundos e só aceita mensagem de acompanhamento
 * numa interação JÁ respondida. As duas coisas juntas obrigam a trabalhar depois
 * de responder.
 *
 * Só que numa função serverless a resposta é o fim: a Vercel suspende a
 * invocação assim que ela sai, e o sintoma medido em produção foi
 *
 *     TypeError: fetch failed
 *       Client network socket disconnected before secure TLS connection
 *       code: ECONNRESET, host: discord.com
 *
 * — a rede morre no meio do handshake. Numa das tentativas nem o `console.error`
 * chegou a sair.
 *
 * ---------------------------------------------------------------------------
 * A SAÍDA OFICIAL, SEM DEPENDÊNCIA
 * ---------------------------------------------------------------------------
 * A Vercel expõe `waitUntil` pra exatamente isto: manter a invocação viva até a
 * promessa terminar. O jeito documentado é o pacote `@vercel/functions`, e o que
 * ele faz por dentro é ler um contexto que a plataforma injeta num símbolo
 * global.
 *
 * Este arquivo lê o mesmo símbolo. O motivo de não instalar o pacote é que o
 * repositório inteiro não tem dependência nenhuma — nada de `node_modules`, nada
 * de lockfile, nada que precise de atualização de segurança. Trocar isso por uma
 * função de três linhas seria caro.
 *
 * O preço é que este símbolo é detalhe interno da plataforma. Por isso:
 *
 *   NADA IMPORTANTE PODE DEPENDER DAQUI. Se o `waitUntil` sumir, `agenda` cai
 *   pro `await` normal — que funciona no `servidor.js` e falha calado na Vercel.
 *   Então o que passa por aqui é sempre CONVENIÊNCIA: a verificação, o cargo e a
 *   resposta principal acontecem antes, no caminho que não depende de nada.
 */

const SIMBOLO = Symbol.for('@vercel/request-context')

/** O `waitUntil` do host, quando existe. */
function doHost() {
  try {
    const ctx = globalThis[SIMBOLO]?.get?.()
    return typeof ctx?.waitUntil === 'function' ? ctx.waitUntil.bind(ctx) : null
  } catch {
    return null
  }
}

/** Só pro diagnóstico: dá pra saber, em produção, se o host oferece isso. */
export function temWaitUntil() {
  return doHost() !== null
}

/**
 * Roda `fn` depois da resposta, segurando a invocação se der.
 *
 * Devolve uma promessa que quem chama PODE aguardar (no servidor local isso é o
 * que faz funcionar) e pode ignorar (na Vercel o `waitUntil` já segurou).
 */
export function agenda(fn) {
  const espera = doHost()
  const p = Promise.resolve()
    .then(fn)
    .catch((e) => {
      console.error('[depois]', e?.message || e)
    })
  if (espera) espera(p)
  return p
}
