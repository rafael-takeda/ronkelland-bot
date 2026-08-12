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
    /*
     * O token da interação viaja junto pro estado. É por ele que a varredura
     * volta a falar com esta pessoa, minutos depois, sem precisar de DM.
     */
    await abrePendente(membro, endereco, {
      app: corpo.application_id,
      token: corpo.token,
    })

    /*
     * A CARTEIRA JÁ VINCULADA MUDA A MENSAGEM INTEIRA, e não só o rodapé dela.
     *
     * Ver `msg.comoVerificar`: colar "you are already verified" no fim de uma
     * instrução faz quem já verificou ler aquilo como conclusão e parar — mesmo
     * com a instrução completa logo acima. Quem decide o texto é a mensagem, que
     * é onde mora tudo que o membro lê.
     */
    const jaTem = await carteiraDe(membro)

    return {
      resposta: respondeSo(msg.comoVerificar(endereco, JANELA_MIN, jaTem)),
      log: { acao: jaTem ? 'reabriu verificação' : 'abriu verificação', membro, endereco },
    }
  }

  // Comando desconhecido: responde alguma coisa. Interação sem resposta fica
  // "pensando" pra sempre na tela da pessoa.
  return { resposta: respondeSo('Unknown command.') }
}
