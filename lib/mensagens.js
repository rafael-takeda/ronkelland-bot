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
   * É a mesma transação de 0 RON nos dois casos.
   */
  comoVerificar: (endereco, minutos, jaTem) => {
    const cabeca = jaTem
      ? [
          '**Re-check your roles**',
          '',
          `You are verified with \`${jaTem.slice(0, 6)}…${jaTem.slice(-4)}\`. Send another **0 RON** transaction to:`,
        ]
      : [
          '**Verify you hold Ronkeverse**',
          '',
          'Send a **0 RON** transaction from the wallet that holds your NFT to:',
        ]

    const explica = jaTem
      ? 'The **same wallet** re-checks your roles right now. A **different wallet** replaces the link.'
      : null

    return [
      ...cabeca,
      '```',
      endereco,
      '```',
      ...(explica ? [explica, ''] : []),
      `You have **${minutos} minutes**. Only gas is spent — nothing is sent.`,
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
