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

/**
 * COMO LER O QUE `depois()` DEVOLVEU.
 *
 * Nem todo trabalho agendado devolve um `Response`. `conclui()` só devolve algo
 * nos ATALHOS (`return await responde(...)`: teto diário, reserva ocupada,
 * explorer fora do ar); no caminho que DÁ CERTO ele responde, fecha o pendente
 * e acaba sem `return`.
 *
 * O log lia `r?.ok` direto, então `undefined?.ok` dava falso e TODA verificação
 * bem-sucedida saía como `falhou ?`. Custou uma investigação inteira: com o
 * Redis já consertado e a pessoa lendo "Verified" na tela, o log insistia que
 * tinha falhado.
 *
 * Isso é pior do que parece. Log é a única coisa que sobra quando o bot roda
 * longe de quem escreveu — e log que grita erro no caminho feliz ensina a
 * ignorar log, que é justamente como a falha de verdade passa batido.
 *
 * A regra mora aqui, e não solta dentro do handler, porque é ela que o teste
 * confere: regra copiada pro teste sai do lugar sozinha na primeira mudança.
 */
export function contaDoDepois(r) {
  if (r && typeof r.ok === 'boolean') return r.ok ? 'entregue' : 'falhou ' + (r.status ?? '?')
  /* sem resposta HTTP = o caminho que não devolve nada, e esse termina bem */
  return 'concluido'
}
