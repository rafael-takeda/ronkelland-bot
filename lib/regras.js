/**
 * ============================================================================
 * REGRAS — quanto é preciso ter pra ganhar qual cargo
 * ============================================================================
 *
 * DUAS CAMADAS, e misturá-las é o erro comum:
 *
 *   ESTE BOT decide apenas CARTEIRA -> CARGO. Ele não sabe que canais existem.
 *   O DISCORD decide CARGO -> ACESSO, nas permissões de cada canal.
 *
 * Quem quiser um canal só pra holder marca, nas permissões do canal, "@everyone
 * não vê" e "@Ronkeverse Holder vê". O bot não participa dessa parte — e é bom
 * que não participe: assim um erro aqui nunca abre um canal que devia estar
 * fechado, no máximo deixa de dar um cargo.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ARQUIVO E NÃO COMANDO DE ADMIN
 * ---------------------------------------------------------------------------
 * Dava pra fazer `/regra adicionar ...` no Discord. Não faço, por três motivos:
 * a regra passa a ter histórico (quem mudou o quê e quando), a revisão acontece
 * antes de valer, e não existe painel de administração pra proteger — painel de
 * admin é superfície de ataque, e este projeto tem uma comunidade inteira
 * confiando nele.
 *
 * ---------------------------------------------------------------------------
 * A REGRA DE OURO: O BOT SÓ MEXE NO QUE ELE MESMO DÁ
 * ---------------------------------------------------------------------------
 * `cargosGeridos()` é a lista fechada dos cargos que este bot pode conceder E
 * remover. Qualquer outro cargo do servidor — moderador, contribuidor, o que
 * for — está fora do alcance dele por construção.
 *
 * Sem isso, um bug de lógica poderia varrer cargos que ninguém pediu pra ele
 * tocar, e num servidor de terceiros esse é o estrago que não tem desculpa.
 */

/**
 * Formato de uma regra:
 *
 *   {
 *     cargo: '123456789012345678',   // id do cargo no Discord (não o nome)
 *     minimo: 1,                     // quantos itens da coleção
 *     nome: 'Ronkeverse Holder',     // só pra log e mensagem, não é usado pra decidir
 *   }
 *
 * O ID e NÃO O NOME porque nome muda: alguém renomeia o cargo pra "Holder 🐵" e
 * o bot pararia de achar. Id não muda nunca.
 */
export function validaRegras(regras) {
  const erros = []
  if (!Array.isArray(regras) || regras.length === 0) {
    return ['nenhuma regra configurada']
  }
  const vistos = new Set()
  for (const [i, r] of regras.entries()) {
    /*
     * O CONTRATO FAZ PARTE DA REGRA, e faltava.
     *
     * A primeira versao assumia uma colecao so, cravada em variavel de
     * ambiente. Mas a pergunta que quem configura faz e "QUAL token da QUAL
     * cargo" -- uma comunidade pode gatear pelo NFT numa sala e pelo token
     * noutra. Sem este campo, a regra nao consegue nem expressar a pergunta.
     */
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(r.contrato || ''))) {
      erros.push(`regra ${i + 1}: "contrato" tem que ser um endereco 0x + 40 caracteres`)
    }
    if (!/^\d{17,20}$/.test(String(r.cargo || ''))) {
      erros.push(`regra ${i + 1}: "cargo" tem que ser o ID numérico do cargo (17-20 dígitos), não o nome`)
    }
    if (!Number.isInteger(r.minimo) || r.minimo < 1) {
      erros.push(`regra ${i + 1}: "minimo" tem que ser inteiro >= 1`)
    }
    // A chave e o PAR contrato+cargo: o mesmo cargo pode ser dado por dois
    // tokens diferentes ("tem o NFT OU tem 1000 do token"), e isso e legitimo.
    const chave = `${String(r.contrato).toLowerCase()}|${r.cargo}`
    if (vistos.has(chave)) erros.push(`regra ${i + 1}: contrato e cargo repetidos`)
    vistos.add(chave)
  }
  return erros
}

/** Todos os cargos que este bot pode conceder e remover. Nada fora daqui. */
export function cargosGeridos(regras) {
  return regras.map((r) => String(r.cargo))
}

/**
 * Quais cargos esta carteira merece.
 *
 * `saldos` e um mapa `{ '0xcontrato': quantidade }` -- uma entrada por contrato
 * citado nas regras. Mapa e nao numero porque uma comunidade pode gatear por
 * mais de um token ao mesmo tempo.
 *
 * ACUMULATIVO de propósito: quem tem 10 recebe o cargo de 1 E o de 10. Se um dia
 * a comunidade quiser exclusivo (só o mais alto), isso muda AQUI e em nenhum
 * outro lugar — é a razão de esta função existir separada.
 */
export function cargosPara(saldos, regras) {
  return regras
    .filter((r) => (saldos[String(r.contrato).toLowerCase()] ?? 0) >= r.minimo)
    .map((r) => String(r.cargo))
}

/**
 * O que fazer com uma pessoa: o que dar, o que tirar.
 *
 * `saldos` e o mapa por contrato; `atuais` sao os cargos que ela tem hoje. A subtração só considera
 * cargos GERIDOS — ver a regra de ouro no cabeçalho.
 */
export function decideCargos(saldos, regras, atuais) {
  const geridos = new Set(cargosGeridos(regras))
  const merece = new Set(cargosPara(saldos, regras))
  const tem = new Set(atuais.map(String))

  const dar = [...merece].filter((c) => !tem.has(c))
  const tirar = [...tem].filter((c) => geridos.has(c) && !merece.has(c))
  return { dar, tirar }
}
