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
  comoVerificar: (endereco, minutos, jaTem) => {
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
      '```',
      endereco,
      '```',
      'Send from the wallet that holds your NFT to the address above.',
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
      `You have **${minutos} minutes**. Beyond the amount you send, you only pay gas.`,
      '',
      '_We will never ask you to connect a wallet, sign a message, or click a link._',
    ].join('\n')
  },


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
