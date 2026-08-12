/**
 * ============================================================================
 * A INTERAÇÃO — o que responder quando alguém clica
 * ============================================================================
 *
 * Fica separado do servidor HTTP de propósito: aqui está a DECISÃO (o que
 * responder a cada tipo de interação), e no servidor está só o transporte.
 * Assim isto dá pra testar sem abrir porta nenhuma.
 *
 * ---------------------------------------------------------------------------
 * TRÊS SEGUNDOS, E ELES SÃO POUCOS
 * ---------------------------------------------------------------------------
 * O Discord derruba a interação se o bot não responder em 3 s. Ler a cadeia
 * demora mais que isso, então o padrão é: responder JÁ com o que é instantâneo,
 * e deixar o trabalho pesado pra varredura, que avisa depois.
 *
 * É por isso que `/verify` não espera pela transação — ele entrega o endereço e
 * sai. Quem fecha o ciclo é o ciclo, não a resposta ao clique.
 */
import { enderecoDe } from './prova.js'
import { abrePendente, carteiraDe, JANELA_MIN } from './estado.js'
import { msg } from './mensagens.js'
import { respondeSo } from './resposta.js'
import { ehDoPainel, respondePainel } from './painelrota.js'

/** Tipos de interação do protocolo. */
export const TIPO = { PING: 1, COMANDO: 2, COMPONENTE: 3, JANELINHA: 5 }

/**
 * O id do membro que disparou.
 *
 * Vem de `member.user.id` no servidor e de `user.id` na DM. Este bot só
 * funciona em servidor, mas ler os dois evita um `undefined` virar chave de
 * armazenamento — e chave `undefined` é o tipo de bug que só aparece com um
 * usuário estranho, meses depois.
 */
export function quemClicou(corpo) {
  return corpo?.member?.user?.id || corpo?.user?.id || null
}

/**
 * Decide a resposta. NÃO faz I/O de blockchain — só estado e texto.
 *
 * Devolve `{ resposta }` pro Discord, e opcionalmente `{ log }` com o que
 * registrar. Nada aqui pode demorar mais que os 3 segundos.
 */
export async function decide(corpo, { segredo }) {
  // PING é o handshake que o Discord faz ao salvar a URL no painel. Sem essa
  // resposta ele recusa a URL e o bot nunca chega a existir.
  if (corpo.type === TIPO.PING) return { resposta: { type: 1 } }

  const membro = quemClicou(corpo)
  if (!membro) {
    return { resposta: respondeSo('Could not identify you. Try again from the server.') }
  }

  /*
   * O PAINEL DO ADMIN sai por outra porta.
   *
   * Ele mora em `painelrota.js` porque tem outra natureza: fala com a cadeia e
   * com o Discord, e demora. O que fica aqui é o caminho do MEMBRO, que não pode
   * depender de nada disso — é ele que precisa responder rápido, e é ele que
   * roda mil vezes mais.
   */
  const doPainel =
    (corpo.type === TIPO.COMANDO && corpo.data?.name === 'ronkelland') ||
    ((corpo.type === TIPO.COMPONENTE || corpo.type === TIPO.JANELINHA) &&
      ehDoPainel(corpo.data?.custom_id))

  if (doPainel) return await respondePainel(corpo, membro)

  const ehVerify =
    (corpo.type === TIPO.COMPONENTE && corpo.data?.custom_id === 'verificar') ||
    (corpo.type === TIPO.COMANDO && corpo.data?.name === 'verify')

  if (ehVerify) {
    const endereco = enderecoDe(membro, segredo)
    await abrePendente(membro, endereco)

    /*
     * MOSTRA A CARTEIRA JÁ VINCULADA, quando existe.
     *
     * Sem isso, quem já verificou clica de novo, recebe o mesmo endereço e não
     * entende se precisa pagar outra vez. Dizer o que ele já tem transforma um
     * clique confuso numa confirmação.
     */
    const jaTem = await carteiraDe(membro)
    const extra = jaTem
      ? `\n\nYou are currently verified with \`${jaTem.slice(0, 6)}…${jaTem.slice(-4)}\`. Sending from a different wallet will replace it.`
      : ''

    return {
      resposta: respondeSo(msg.comoVerificar(endereco, JANELA_MIN) + extra),
      log: { acao: 'abriu verificação', membro, endereco },
    }
  }

  // Comando desconhecido: responde alguma coisa. Interação sem resposta fica
  // "pensando" pra sempre na tela da pessoa.
  return { resposta: respondeSo('Unknown command.') }
}
