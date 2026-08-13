/**
 * ============================================================================
 * O QUE O MEMBRO LÊ — tudo em inglês
 * ============================================================================
 *
 * Num arquivo só, de propósito. Texto voltado ao usuário espalhado pelo código é
 * texto que envelhece em lugares diferentes — aqui dá pra ler de uma vez tudo
 * que a comunidade vê e perceber quando uma frase ficou ruim.
 *
 * A instrução de verificação carrega uma promessa explícita: nunca pedimos
 * conexão de carteira, assinatura nem clique em link. Ela está escrita porque é
 * o que separa a nossa mensagem da mensagem do golpista — e porque, sendo
 * promessa escrita, ela também é um teste: `teste_comandos.js` recusa a build
 * se alguma mensagem passar a mandar o membro clicar em link.
 */

export const msg = {
  /**
   * A instrução. `jaTem` é a carteira já amarrada, quando existe.
   *
   * ---------------------------------------------------------------------------
   * QUEM JÁ VERIFICOU LÊ OUTRA COISA, e não a mesma com um aviso no fim
   * ---------------------------------------------------------------------------
   * A primeira versão colava "You are currently verified with 0x…" no rodapé da
   * instrução normal. A instrução estava certa e completa — e mesmo assim quem
   * leu entendeu "já era, não tem o que fazer aqui", e parou.
   *
   * O problema era o tempo verbal: a frase descrevia um ESTADO no lugar onde a
   * pessoa procurava uma AÇÃO. Estado no rodapé de uma instrução parece
   * conclusão.
   *
   * Agora o título muda junto ("Re-check your roles") e o texto diz o que cada
   * escolha faz: mesma carteira reconfere agora, outra carteira troca o vínculo.
   * É a mesma transação nos dois casos.
   *
   * ---------------------------------------------------------------------------
   * O VALOR APARECE UMA VEZ SÓ, E COM O AVISO COLADO
   * ---------------------------------------------------------------------------
   * O "0 RON" ficava no meio da primeira frase, longe de qualquer explicação do
   * porquê. Agora ele mora numa linha própria, junto do motivo — porque a
   * pergunta que vem depois de "0 RON" é sempre "posso mandar mais?", e a
   * resposta honesta a essa pergunta é um aviso, não uma permissão.
   */
  /*
   * `separado` = a segunda mensagem VAI sair (o host segura a invocação).
   *
   * Quando ela sai, o endereço aparece só lá — repetir o mesmo bloco duas vezes
   * seguidas confunde, e ainda faz a pessoa copiar o de cima, que é o difícil.
   *
   * Quando ela NÃO sai, o endereço fica aqui, no topo. Não é redundância: é uma
   * escolha entre dois lugares, decidida pelo que o host consegue entregar.
   */
  comoVerificar: (endereco, minutos, jaTem, separado, ate) => {
    const cabeca = jaTem
      ? [
          '**Re-check your roles**',
          '',
          `You are verified with \`${jaTem.slice(0, 6)}…${jaTem.slice(-4)}\`.`,
          'The **same wallet** re-checks your roles right now. A **different wallet** replaces the link.',
        ]
      : ['**Verify you hold Ronkeverse**']

    return [
      ...cabeca,
      '',
      /*
       * O ENDEREÇO VEM PRIMEIRO, E SOZINHO NAS SUAS LINHAS.
       *
       * Antes ele estava no meio do texto, e no celular isso não se copia: o
       * toque longo pega o parágrafo inteiro, e a pessoa acaba digitando 42
       * caracteres à mão.
       *
       * A ideia melhor seria uma mensagem só pra ele, com o botão de copiar do
       * Discord. Não dá: mensagem de acompanhamento exige que a interação já
       * tenha sido respondida, e a Vercel corta a rede da função assim que a
       * resposta sai — medido, ECONNRESET contra discord.com. É circular.
       *
       * Então ele vem no TOPO, logo abaixo do título e antes de qualquer
       * explicação. É a primeira coisa que o polegar alcança, e o bloco de
       * código sozinho nas suas linhas é o que o Discord móvel oferece copiar.
       */
      ...(separado
        ? ['Send from the wallet that holds your NFT to the address **below**.']
        : ['```', endereco, '```', 'Send from the wallet that holds your NFT to the address above.']),
      '',
      /*
       * "QUALQUER VALOR" VEM ANTES DO EXEMPLO. Numero primeiro vira regra na
       * cabeca de quem le, e a pessoa trava se a carteira arredondar diferente.
       *
       * E ZERO NAO DA: a carteira da Ronin recusa transacao de valor zero -- o
       * botao de enviar nem habilita. A instrucao antiga mandava fazer isso, e
       * quem tentava concluia que o bot estava quebrado. Os pagamentos reais que
       * chegaram foram todos de 0,00001 RON: as pessoas contornaram sozinhas.
       */
      '**Any amount works** — send as little as your wallet lets you, like `0.00001 RON`. Only zero does not: the Ronin wallet refuses it.',
      '',
      /*
       * O AVISO DE QUEIMA. O endereco e `sha256(id + segredo)` truncado -- um
       * hash, e nao uma chave publica derivada de chave privada. NAO EXISTE
       * chave que gaste dali: nem a pessoa, nem os Ronkes, nem quem opera o bot.
       *
       * Sem esta frase, "qualquer valor" convida alguem a mandar 50 RON achando
       * que esta contribuindo -- e esse alguem nao recupera.
       */
      'That address has **no owner**. Nobody can ever spend from it, not us and not you, so whatever you send is destroyed. That is why you send the minimum — it is not a donation.',
      '',
      /*
       * O PRAZO É UM CARIMBO DO DISCORD, E NÃO UM NÚMERO ESCRITO.
       *
       * "You have 10 minutes" é verdade no instante em que a mensagem sai e
       * mentira quando a pessoa volta pra tela — e ela VAI voltar, porque no meio
       * disso ela foi na carteira.
       *
       * `<t:unix:R>` o cliente do Discord renderiza como relativo e atualiza
       * sozinho: "in 10 minutes", depois "in 4 minutes", depois "10 minutes ago".
       * O bot não edita nada; quem conta é o aparelho de quem lê.
       *
       * Sem `ate` (chamada antiga, testes) cai no texto de antes — um prazo
       * aproximado é melhor que prazo nenhum.
       */
      ate
        ? `Your window closes <t:${Math.floor(ate / 1000)}:R>. Beyond the amount you send, you only pay gas.`
        : `You have **${minutos} minutes**. Beyond the amount you send, you only pay gas.`,
      '',
      '_We will never ask you to connect a wallet, sign a message, or click a link._',
    ].join('\n')
  },

  /**
   * O ENDEREÇO SOZINHO, E SEM FORMATAÇÃO NENHUMA.
   *
   * Era um bloco de código — o retângulo bonito, com botão de copiar no celular.
   * Só que quem seleciona à mão, em vez de usar o botão, leva as crases junto: a
   * pessoa cola `0xabc…` com acento grave nas pontas, a carteira recusa o
   * endereço, e ela não faz ideia do porquê. Foi relatado por um membro.
   *
   * Texto puro se copia limpo por qualquer caminho — botão, toque longo, seleção
   * de parágrafo, três cliques no computador. Some a caixa e some o problema.
   *
   * Nada de negrito, crase ou pontuação em volta: TUDO que estiver nesta
   * mensagem pode acabar dentro do que a pessoa cola.
   */
  soOEndereco: (endereco) => endereco,

  /*
   * AS RESPOSTAS DO BOTÃO "I sent it".
   *
   * Todas dizem o que aconteceu E o que fazer em seguida. A pessoa acabou de
   * mandar uma transação e está olhando a tela: qualquer frase que só descreva
   * um estado ("not found") deixa ela sem saber se espera, se repete, ou se
   * errou alguma coisa.
   */

  /** O caso comum de "apertou rápido demais". Nunca soa como erro. */
  naoAchei: () =>
    [
      "**I do not see your transaction yet.**",
      '',
      'It usually shows up within a few seconds. Give it a moment and press **I sent it** again.',
      '',
      '_Nothing is lost — your window is still open._',
    ].join('\n'),

  /* Dois cliques seguidos. Ver `reserva`: um trabalho por endereço. */
  aindaTrabalhando: () => 'Still checking your last one — give me a few seconds.',

  /* O teto diário. Diz que existe uma saída, senão a pessoa acha que travou. */
  calma: () =>
    'You have checked a lot of times today. The automatic check still runs on its own — your roles will arrive without pressing anything.',

  /*
   * O explorer fora do ar. A primeira frase é sobre o dinheiro, porque é a
   * pergunta que a pessoa faz primeiro depois de mandar uma transação.
   */
  explorerOcupado: () =>
    [
      '**I cannot reach the block explorer right now.**',
      '',
      'Your gas is safe and nothing was lost. Press again in a minute, or just wait — the automatic check will pick it up.',
    ].join('\n'),

  /* A cadeia não respondeu. O importante é dizer que NADA foi mexido. */
  naoConsegui: () =>
    [
      '**I could not read the chain just now.**',
      '',
      'I did not change any of your roles. Press again in a minute.',
    ].join('\n'),


  /**
   * O fim do fluxo, e a única mensagem que a pessoa recebe sem ter clicado.
   *
   * DIZ A CARTEIRA. Quem tem várias precisa saber qual ficou amarrada — é dela
   * que os cargos vão depender daqui pra frente, e descobrir isso só quando um
   * cargo some é tarde demais.
   *
   * MENCIONA OS CARGOS com `<@&id>`, e não pelo nome escrito: o Discord desenha
   * a pílula colorida do cargo, e ela é a prova visual de que aquilo é o cargo
   * de verdade. Nome digitado qualquer um escreve.
   *
   * `cargos` é a lista completa que a carteira alcança, não só a novidade. Quem
   * clica de novo tem que ler o que TEM, e não "nada de novo" — que soaria como
   * falha.
   */
  verificado: (carteira, cargos) => {
    const curta = `${carteira.slice(0, 6)}…${carteira.slice(-4)}`
    if (!cargos.length) {
      return [
        `**Verified.** Wallet \`${curta}\` is now linked to your account.`,
        '',
        'It does not hold enough for any role yet. Nothing else to do — buy or hold, and the next check picks it up.',
      ].join('\n')
    }
    return [
      `**Verified.** Wallet \`${curta}\` is now linked to your account.`,
      '',
      `You now have: ${cargos.map((c) => `<@&${c}>`).join(' ')}`,
      '',
      '_Keep holding to keep the roles. If you sell, they come off on the next check._',
    ].join('\n')
  },

  semNft: 'That wallet does not hold any Ronkeverse. Nothing was granted.',

  expirou: 'Your verification window expired. Run `/verify` again to get a new address.',

  aguardando: 'Waiting for your transaction. This can take up to 5 minutes after it confirms.',

  regraCriada: (colecao, minimo, cargo) =>
    [
      '**Rule created**',
      `Collection: **${colecao}**`,
      `Anyone holding **${minimo} or more** gets ${cargo}`,
    ].join('\n'),

  regraRemovida: (cargo) => `Rule removed. Members will lose ${cargo} on the next check.`,

  semRegras: 'No rules set up yet. Use `/ronkelland rule add` to create one.',

  contratoInvalido: (erro) => `That contract does not work: ${erro}`,

  /** Ver `segurancacargo.js`: cargo perigoso é recusado até pra quem manda. */
  cargoRecusado: (nome, motivos) =>
    [
      `I cannot manage the role **${nome}**:`,
      ...motivos.map((m) => `• ${m}`),
      '',
      'A role with moderation permissions must never be granted automatically — anyone who bought an NFT would get that power.',
      'Create a role with no permissions for holders, and use the **channel** permissions to grant access.',
    ].join('\n'),

  /** Vai pro canal de log. Num servidor de terceiros, quem mexeu importa. */
  auditoria: (quando, quem, oQue) => `\`${quando}\` **${quem}** ${oQue}`,
}
