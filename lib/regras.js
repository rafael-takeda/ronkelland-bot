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
 *     tipo: 'ERC-721',               // o que medir — ver TIPOS abaixo
 *     contrato: '0x810b…',           // de qual contrato
 *     minimo: 1,                     // quanto basta
 *     nome: 'Ronkeverse Holder',     // só pra log e mensagem, não decide nada
 *   }
 *
 * O ID e NÃO O NOME porque nome muda: alguém renomeia o cargo pra "Holder 🐵" e
 * o bot pararia de achar. Id não muda nunca.
 *
 * ---------------------------------------------------------------------------
 * TIPOS — três perguntas diferentes, e elas não se reduzem uma à outra
 * ---------------------------------------------------------------------------
 *   'ERC-20' / 'ERC-721'  QUANTO a carteira tem. `balanceOf`, e `minimo` é a
 *                         quantidade. É o caso comum.
 *
 *   'ERC-721-ids'         QUAIS a carteira tem. "Ronke Lord = tem um 1/1" não é
 *                         uma quantidade — `balanceOf` responde 3 sem dizer se
 *                         algum dos 3 é especial. Pede `ids`, e a medida é 0 ou
 *                         1: tem algum, ou não tem.
 *
 *   'score'               O Ronke Score da carteira, da API de analytics. Não
 *                         tem contrato: não é posse, é histórico. `minimo` é a
 *                         pontuação de corte.
 *
 * Tipo ausente cai no caso comum (saldo por contrato) — é como as regras eram
 * antes de existir tipo, e quebrar uma configuração antiga por causa de um campo
 * novo seria trocar um cargo funcionando por um erro de validação.
 */

/** Tipos que medem posse de um contrato na cadeia. */
const POR_SALDO = new Set(['', 'ERC-20', 'ERC-721'])

/** O tipo de uma regra, normalizado. */
export function tipoDaRegra(r) {
  return String(r?.tipo || '')
}

/**
 * A CHAVE DA MEDIDA — o que precisa ser perguntado pra decidir esta regra.
 *
 * Duas regras com a mesma chave são respondidas por UMA consulta: `Ronke Holder`
 * (1 $RONKE) e `Ronke Chad` (1.000.000 $RONKE) olham o mesmo `balanceOf`, e
 * perguntar duas vezes seria só gastar chamada.
 *
 * Regra de posse-de-id leva o cargo na chave porque a medida depende da LISTA,
 * não só do contrato: duas listas diferentes no mesmo contrato são duas
 * perguntas diferentes.
 */
export function chaveDaMedida(r) {
  const tipo = tipoDaRegra(r)
  if (tipo === 'score') return 'score'
  const c = String(r?.contrato || '').toLowerCase()
  if (tipo === 'ERC-721-ids') return `ids:${c}:${r?.cargo}`
  return c
}

/**
 * O corte desta regra.
 *
 * Posse-de-id é sempre 1 porque a medida é sim/não. Deixar `minimo: 2` passar
 * seria aceitar uma regra que o bot não sabe cumprir — `temAlgumToken` para no
 * primeiro que acha, então ele nunca saberia dizer "tem dois". Melhor recusar na
 * validação do que obedecer pela metade.
 */
export function minimoDaRegra(r) {
  return tipoDaRegra(r) === 'ERC-721-ids' ? 1 : r?.minimo
}

export function validaRegras(regras) {
  const erros = []
  if (!Array.isArray(regras) || regras.length === 0) {
    return ['nenhuma regra configurada']
  }
  const vistos = new Set()
  for (const [i, r] of regras.entries()) {
    const tipo = tipoDaRegra(r)
    const ehIds = tipo === 'ERC-721-ids'
    const ehScore = tipo === 'score'

    if (!ehScore && !ehIds && !POR_SALDO.has(tipo)) {
      erros.push(`regra ${i + 1}: tipo "${tipo}" desconhecido`)
    }

    /*
     * O CONTRATO FAZ PARTE DA REGRA, e faltava.
     *
     * A primeira versao assumia uma colecao so, cravada em variavel de
     * ambiente. Mas a pergunta que quem configura faz e "QUAL token da QUAL
     * cargo" -- uma comunidade pode gatear pelo NFT numa sala e pelo token
     * noutra. Sem este campo, a regra nao consegue nem expressar a pergunta.
     *
     * Score é a exceção, e por um motivo de fundo: ele não sai de um contrato.
     * Exigir um endereço aqui obrigaria a inventar um, e endereço inventado é o
     * tipo de campo que alguém depois lê como verdade.
     */
    if (ehScore) {
      if (r.contrato) erros.push(`regra ${i + 1}: regra de score não tem "contrato"`)
    } else if (!/^0x[0-9a-fA-F]{40}$/.test(String(r.contrato || ''))) {
      erros.push(`regra ${i + 1}: "contrato" tem que ser um endereco 0x + 40 caracteres`)
    }

    if (!/^\d{17,20}$/.test(String(r.cargo || ''))) {
      erros.push(`regra ${i + 1}: "cargo" tem que ser o ID numérico do cargo (17-20 dígitos), não o nome`)
    }

    if (ehIds) {
      /*
       * A LISTA É A REGRA. Sem ela a regra não diz nada, e o jeito silencioso de
       * "não dizer nada" é justamente o que deixou o Ronke Lord meses sem nunca
       * ser concedido: ele estava no arquivo, e nada o avaliava.
       */
      const ids = r.ids
      if (!Array.isArray(ids) || ids.length === 0) {
        erros.push(`regra ${i + 1}: tipo ERC-721-ids precisa de "ids" com pelo menos um token`)
      } else if (!ids.every((n) => Number.isInteger(n) && n >= 0)) {
        erros.push(`regra ${i + 1}: "ids" tem que ser só números inteiros`)
      }
      if (r.minimo !== undefined && r.minimo !== 1) {
        erros.push(`regra ${i + 1}: posse de id é sim/não — "minimo" só pode ser 1 ou ficar de fora`)
      }
    } else if (!Number.isInteger(r.minimo) || r.minimo < 1) {
      erros.push(`regra ${i + 1}: "minimo" tem que ser inteiro >= 1`)
    }

    // A chave e o PAR medida+cargo: o mesmo cargo pode ser dado por dois
    // tokens diferentes ("tem o NFT OU tem 1000 do token"), e isso e legitimo.
    const chave = `${chaveDaMedida(r)}|${r.cargo}`
    if (vistos.has(chave)) erros.push(`regra ${i + 1}: regra repetida (mesma medida e mesmo cargo)`)
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
 * `medidas` e um mapa `{ chaveDaMedida: numero }` -- uma entrada por pergunta
 * feita. Mapa e nao numero porque uma comunidade pode gatear por mais de uma
 * coisa ao mesmo tempo: token, NFT, 1/1 e score convivem.
 *
 * MEDIDA AUSENTE VALE ZERO, e isso é deliberado: na dúvida não concede. Quem
 * cuida de não TIRAR cargo por medida ausente é `aplicaCargos`, com a lista de
 * incertos — são duas defesas para os dois lados do erro.
 *
 * ACUMULATIVO de propósito: quem tem 10 recebe o cargo de 1 E o de 10. Se um dia
 * a comunidade quiser exclusivo (só o mais alto), isso muda AQUI e em nenhum
 * outro lugar — é a razão de esta função existir separada.
 */
export function cargosPara(medidas, regras) {
  return regras
    .filter((r) => {
      const corte = minimoDaRegra(r)
      // Corte inválido nunca concede. `x >= undefined` já é falso, mas depender
      // disso é depender de um acidente da linguagem — melhor dizer.
      if (!Number.isFinite(corte)) return false
      return (medidas[chaveDaMedida(r)] ?? 0) >= corte
    })
    .map((r) => String(r.cargo))
}

/**
 * O que fazer com uma pessoa: o que dar, o que tirar.
 *
 * `medidas` e o mapa por medida; `atuais` sao os cargos que ela tem hoje. A subtração só considera
 * cargos GERIDOS — ver a regra de ouro no cabeçalho.
 */
export function decideCargos(medidas, regras, atuais) {
  const geridos = new Set(cargosGeridos(regras))
  const merece = new Set(cargosPara(medidas, regras))
  const tem = new Set(atuais.map(String))

  const dar = [...merece].filter((c) => !tem.has(c))
  const tirar = [...tem].filter((c) => geridos.has(c) && !merece.has(c))
  return { dar, tirar }
}
