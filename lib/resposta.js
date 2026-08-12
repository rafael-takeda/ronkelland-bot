/**
 * ============================================================================
 * AS RESPOSTAS DO BOT — e como uma mensagem aparece só pra uma pessoa
 * ============================================================================
 *
 * Quando alguém clica no botão ou roda um comando, o Discord manda uma
 * "interação" pro bot. O que o bot devolve nessa resposta decide quem enxerga.
 *
 * O truque é uma marca só: `flags: 64`. Com ela, o Discord mostra a mensagem
 * EXCLUSIVAMENTE pra quem disparou — aparece com "Only you can see this", some
 * quando a pessoa atualiza e não fica no histórico do canal. Não existe canal
 * por usuário; existe resposta por usuário.
 *
 * ---------------------------------------------------------------------------
 * AQUI ISSO NÃO É CONFORTO, É SEGURANÇA
 * ---------------------------------------------------------------------------
 * O endereço de verificação do João TEM que ser só dele.
 *
 * Se aparecesse no canal, eu mandaria uma transação da MINHA carteira pro
 * endereço DELE, e o bot registraria a minha carteira como sendo a dele. Com a
 * minha carteira vazia, ele fica sem conseguir verificar; se eu vender depois,
 * ele perde um cargo que merecia.
 *
 * Ou seja: o efêmero é o que mantém o endereço secreto, e o segredo é o que faz
 * o desenho inteiro funcionar. Por isso `respondeSo` existe e `responde` (a
 * versão pública) é usada só onde não há segredo nenhum.
 */

/** A marca que faz a mensagem ser individual. `1 << 6` na documentação. */
export const EFEMERA = 64

/** Tipos de resposta a interação, do protocolo do Discord. */
const TIPO_RESPOSTA = { MENSAGEM: 4, PENSANDO: 5 }

/**
 * Resposta que SÓ quem disparou enxerga. É o padrão deste bot.
 *
 * Tudo que envolve endereço, carteira ou saldo de alguém passa por aqui — nunca
 * pela versão pública.
 */
export function respondeSo(texto, componentes) {
  return {
    type: TIPO_RESPOSTA.MENSAGEM,
    data: { content: texto, flags: EFEMERA, ...(componentes ? { components: componentes } : {}) },
  }
}

/**
 * O BOTÃO QUE A PESSOA APERTA DEPOIS DE MANDAR.
 *
 * Ele fica DENTRO da mensagem efêmera, e não na fixada do canal, por uma razão
 * de custo: cada aperto consulta o explorer, a cadeia e o Discord. Na mensagem
 * pública qualquer um do servidor aperta à vontade, sem nunca ter mandado nada.
 * Aqui, só quem acabou de pedir um endereço o enxerga.
 *
 * O clique gera uma interação NOVA, com token novo de 15 minutos — que é o que
 * permite responder com calma, sem o teto de 3 segundos da primeira.
 */
export const BOTAO_MANDEI = [
  {
    type: 1,
    components: [
      { type: 2, style: 1, label: 'I sent it — check now', custom_id: 'checar:pagamento' },
    ],
  },
]

/**
 * "Pensando…", também individual.
 *
 * O Discord exige resposta em 3 SEGUNDOS, e a nossa verificação varre blocos —
 * pode passar disso. Este tipo segura a interação e deixa o bot editar a
 * mensagem depois, com calma.
 */
export function pensandoSo() {
  return { type: TIPO_RESPOSTA.PENSANDO, data: { flags: EFEMERA } }
}

/** Resposta pública. Existe pra quando NÃO há segredo — hoje, ninguém a usa. */
export function responde(texto) {
  return { type: TIPO_RESPOSTA.MENSAGEM, data: { content: texto } }
}

/**
 * A mensagem fixa do canal de verificação: pública, com um botão.
 *
 * É a única coisa que fica visível pra todos. O botão não carrega informação
 * nenhuma — ele só avisa o bot que fulano clicou; o endereço nasce depois, na
 * resposta individual.
 *
 * BOTÃO E NÃO COMANDO porque quem acaba de entrar no servidor não sabe que
 * existe `/verify`. Um botão à vista dispensa saber.
 */
export function mensagemDoCanal() {
  return {
    embeds: [
      {
        title: 'Verify you hold Ronkeverse',
        description: [
          // Nao pode ser zero: a carteira da Ronin recusa transacao de valor
          // zero. Ver `msg.comoVerificar` -- a instrucao antiga mandava fazer
          // uma coisa impossivel, e quem tentava achava que o bot quebrou.
          // "Any amount" antes do numero: numero primeiro vira regra na cabeca de
          // quem le, e a pessoa trava se a carteira nao aceitar exatamente aquilo.
          // Zero e a unica coisa que nao passa -- a carteira da Ronin recusa.
          'Click below and follow the instructions. It takes one transaction from the wallet that holds your NFT — **any amount works**, even `0.00001 RON`. Only zero does not.',
          '',
          /*
           * O AVISO DE QUEIMA TAMBÉM AQUI, e não só na instrução privada.
           *
           * A instrução que aparece depois do clique é efêmera: some quando a
           * pessoa recarrega o Discord, e ninguém pode reler ou mostrar pra
           * outro. Esta mensagem é a única que fica.
           *
           * Então ela é a única que alguém consegue apontar depois — pra quem
           * chegou hoje, pra quem perguntou no chat, pra quem quer conferir
           * antes de mexer na carteira. Um aviso sobre dinheiro que só existe
           * num lugar que evapora é um aviso pela metade.
           */
          'The address you receive has **no owner** — nobody can spend from it, so anything sent there is destroyed. Send the minimum. It is not a donation.',
          '',
          'We will never ask you to connect a wallet, sign a message, or click a link. We will never DM you first.',
        ].join('\n'),
        color: 0x7fd48a,
      },
    ],
    components: [
      {
        type: 1, // linha de componentes
        components: [
          {
            type: 2, // botão
            style: 1, // primário
            label: "Let's go!",
            custom_id: 'verificar',
          },
        ],
      },
    ],
  }
}
