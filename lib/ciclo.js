/**
 * ============================================================================
 * O CICLO — uma passada da verificação
 * ============================================================================
 *
 * Duas coisas acontecem aqui, e elas têm ritmos diferentes de propósito:
 *
 *   VARREDURA DE PAGAMENTO — só roda se alguém está esperando. Olha os blocos
 *   novos procurando os endereços pendentes. É o caminho de quem está
 *   verificando AGORA, e por isso precisa ser rápido.
 *
 *   REVARREDURA — passa por todos os vínculos já feitos e tira o cargo de quem
 *   vendeu. Não tem urgência nenhuma, e roda de vez em quando.
 *
 * ---------------------------------------------------------------------------
 * SEM NINGUÉM ESPERANDO, A VARREDURA NEM COMEÇA
 * ---------------------------------------------------------------------------
 * Transferência nativa não emite log, então achar uma exige abrir bloco por
 * bloco: 426 ms cada, medido no RPC público. Isso seria caro se rodasse sempre.
 *
 * Mas verificação é evento raro — uma vez por pessoa. Enquanto a lista de
 * pendentes está vazia, o ciclo custa uma chamada e sai. Quando alguém clica,
 * ele varre por 5 minutos e volta a dormir. O custo é proporcional ao uso, não
 * ao tempo.
 */
import { aplica, avisaDepois, cargosDoMembro } from './discord.js'
import { cargosGeridos, cargosPara, chaveDaMedida, decideCargos, tipoDaRegra } from './regras.js'
import { msg } from './mensagens.js'
import {
  donoDoToken,
  enderecoDe,
  mapaDeDonos,
  pagamentosPara,
  procuraPagamentos,
  saldoNoContrato,
  temAlgumToken,
} from './prova.js'
import { preaquece, scoreDe } from './score.js'
import {
  amarra,
  desamarrados,
  fechaPendente,
  gravaBloco,
  guardaLords,
  JANELA_MIN,
  leLords,
  pendentes,
  tiraDesamarrado,
  ultimoBloco,
  vinculos,
} from './estado.js'
import { blocoAtual } from './prova.js'

/**
 * Quantos blocos pra trás olhar quando não há marca de onde parou.
 *
 * 100 blocos são ~5 minutos, que é exatamente a janela. Olhar mais que isso
 * seria pescar transação de janela que já venceu.
 */
const RECUO_INICIAL = 100

/**
 * O TETO DO ATRASO — quantos blocos a varredura aceita ter pra recuperar.
 *
 * O ponteiro só avança quando uma passada termina inteira. Se ela morrer no
 * meio, ele fica onde estava, e a passada seguinte tenta varrer TUDO que passou
 * desde então — bloco por bloco, ~400 ms cada.
 *
 * Isso cria uma espiral: uma hora parada vira 1.200 blocos pra abrir, que
 * demoram 8 minutos, que torram a cota do RPC, que derruba a passada de novo. E
 * cada rodada da espiral deixa o buraco maior.
 *
 * O teto corta isso, e sem perder nada: a janela de verificação são 5 minutos.
 * Pagamento mais velho que isso pertence a um pendente que já venceu — varrer
 * atrás dele é gastar chamada pra achar o que não vale mais.
 */
const SEGUNDOS_POR_BLOCO = 2

/*
 * O TETO SAI DA JANELA, e nao de um numero cravado.
 *
 * Ele era 200, com um comentario dizendo que isso eram "5 minutos". Medido: o
 * bloco da Ronin leva 2,00 s, entao 200 blocos sao 6,7 minutos — e a janela ja
 * tinha subido pra 10. O numero mentia nos dois sentidos ao mesmo tempo: dizia
 * cobrir menos do que cobria, e cobria menos do que a janela precisava.
 *
 * Derivando da janela, mexer numa nao pode mais deixar a outra pra tras.
 */
const TETO_ATRASO = Math.ceil((JANELA_MIN * 60) / SEGUNDOS_POR_BLOCO)

/**
 * Quanto tempo a foto dos donos de 1/1 continua servindo.
 *
 * Ela só serve pra NEGAR (ver `medeUma`), então envelhecer não dá cargo a
 * ninguém — atrasa quem acabou de comprar um 1/1. Três horas é o bastante pra
 * varredura refazer a foto várias vezes por dia sem que a espera incomode.
 */
const VALIDADE_LORDS = 3 * 60 * 60 * 1000

/**
 * UMA medida de uma carteira — o que esta regra precisa saber.
 *
 * `{ ok:false }` é "não consegui perguntar", nunca "não tem". Todo caminho aqui
 * preserva essa distinção, porque é ela que impede o sistema de tirar cargo de
 * quem não fez nada.
 *
 * `jaMedido` é o que já foi respondido nesta passada, e serve pro atalho dos 1/1
 * logo abaixo.
 */
async function medeUma(carteira, r, jaMedido, opcoes) {
  const tipo = tipoDaRegra(r)
  const contrato = String(r.contrato || '').toLowerCase()

  if (tipo === 'score') {
    const s = await scoreDe(carteira)
    return s.ok ? { ok: true, valor: s.score } : { ok: false }
  }

  if (tipo === 'ERC-721-ids') {
    /*
     * ---------------------------------------------------------------------
     * O MAPA SÓ SERVE PRA NEGAR. NUNCA PRA CONCEDER.
     * ---------------------------------------------------------------------
     * Esta é a trava, e ela é o desenho inteiro.
     *
     * O mapa é uma FOTO, tirada há minutos ou horas. Usá-lo como prova positiva
     * — "está no mapa, logo tem" — daria o cargo mais raro do servidor a quem
     * JÁ VENDEU o 1/1: bastaria vender e apertar o botão antes da próxima foto.
     * Sob demanda, quantas vezes quisesse.
     *
     * Como prova NEGATIVA ele é seguro, e pela assimetria: quem não aparece na
     * foto ou não tinha, ou comprou depois dela — e nesse caso perde o cargo até
     * a foto seguinte, que é errar pro lado de não dar. Quem aparece na foto
     * ainda precisa que a CADEIA confirme, agora, com um `ownerOf` ao vivo.
     *
     * 107 chamadas viram 1. E a resposta continua vindo da cadeia.
     */
    const mapa = opcoes?.lords
    if (mapa && mapa.contrato === contrato && mapa.completo) {
      const idade = Date.now() - mapa.quando
      if (idade <= VALIDADE_LORDS) {
        const meus = mapa.donos?.[carteira.toLowerCase()]
        // Fora da foto: zero, sem tocar na cadeia.
        if (!meus || !meus.length) return { ok: true, valor: 0 }
        // Na foto: a cadeia decide, com UMA chamada.
        const dono = await donoDoToken(contrato, meus[0])
        return { ok: true, valor: dono === carteira.toLowerCase() ? 1 : 0 }
      }
    }
    /*
     * Sem mapa, mapa velho ou mapa incompleto: quem PODE varrer varre (é a
     * varredura, que tem tempo). Quem não pode devolve incerto — que não concede
     * e, principalmente, não REMOVE. Um caminho rápido nunca deve tirar o cargo
     * mais raro do servidor por não ter tido tempo de conferir.
     */
    if (!opcoes?.podeVarrer) return { ok: false }

    /*
     * O ATALHO QUE FAZ ESTA REGRA SER VIÁVEL.
     *
     * Não existe chamada que pergunte "tem algum destes 107?" — só dá pra
     * perguntar de um em um, com `ownerOf`. Pra quem NÃO é Lord isso são 107
     * chamadas pra descobrir um "não", e quase todo mundo não é Lord: seria o
     * caso comum pagando o preço do caso raro.
     *
     * Mas quem tem zero NFT da coleção não pode ter um 1/1 dela. Uma chamada de
     * `balanceOf` decide isso, e ela quase sempre JÁ FOI FEITA por outra regra
     * do mesmo contrato. O atalho é exato, não é heurística.
     */
    const quantos = jaMedido?.[contrato]
    if (quantos === 0) return { ok: true, valor: 0 }
    if (quantos === undefined) {
      const s = await saldoNoContrato(carteira, contrato, 0)
      if (!s.ok) return { ok: false }
      if (s.saldo === 0) return { ok: true, valor: 0 }
    }
    const t = await temAlgumToken(carteira, contrato, r.ids || [])
    return t.ok ? { ok: true, valor: t.tem ? 1 : 0 } : { ok: false }
  }

  const s = await saldoNoContrato(carteira, contrato, r.casas)
  return s.ok ? { ok: true, valor: s.saldo } : { ok: false }
}

/**
 * Todas as medidas de uma carteira — uma por pergunta distinta das regras.
 *
 * Regras que fazem a MESMA pergunta são respondidas uma vez só: `Ronke Holder` e
 * `Ronke Chad` compartilham o `balanceOf` do $RONKE.
 */
export async function medidasDe(carteira, regras, opcoes = {}) {
  const medidas = {}
  const incerto = []
  for (const r of regras) {
    const chave = chaveDaMedida(r)
    if (chave in medidas || incerto.includes(chave)) continue
    const m = await medeUma(carteira, r, medidas, opcoes)
    if (m.ok) medidas[chave] = m.valor
    else incerto.push(chave)
  }
  return { medidas, incerto }
}

/**
 * Aplica os cargos que a carteira merece.
 *
 * `incerto` NÃO É VAZIO significa que algum contrato não respondeu. Nesse caso o
 * ciclo não TIRA nada — só dá. Tirar cargo porque o RPC piscou é o pior erro
 * deste sistema: o membro não fez nada e perde o acesso, e ele nem sabe por quê.
 */
export async function aplicaCargos(servidor, membro, carteira, regras, opcoes = {}) {
  const { medidas, incerto } = await medidasDe(carteira, regras, opcoes)
  const atuais = await cargosDoMembro(servidor, membro)
  const decisao = decideCargos(medidas, regras, atuais)

  if (incerto.length) {
    decisao.tirar = []
  }

  const erros = await aplica(servidor, membro, decisao, 'Ronkelland: verificação')

  /*
   * `merece` é a lista COMPLETA que a carteira alcança, e não só o que acabou de
   * ser dado. É ela que a pessoa lê no aviso: quem verifica de novo precisa ver
   * o que TEM, não "nenhum cargo novo" — que soaria como se tivesse falhado.
   *
   * MENOS O QUE O DISCORD RECUSOU. `aplica()` não estoura quando um PUT falha:
   * ele guarda a falha e segue. Sem descontar isso aqui, a mensagem afirmava que
   * a pessoa ganhou um cargo que ela nao tem — e ela ia procurar na lista, nao
   * achar, e concluir que o bot mente. Cargo que falhou some da lista e vira
   * aviso separado.
   */
  const falhouAoDar = new Set(
    erros
      .map((e) => String(e).match(/\b(\d{17,20})\b/)?.[1])
      .filter(Boolean),
  )

  /*
   * COM INCERTEZA, `merece` É NULO — NUNCA UMA LISTA.
   *
   * Se alguma medida não pôde ser lida, a lista que sobra não é "os cargos que a
   * pessoa tem": é "os cargos que eu consegui confirmar". A diferença some
   * quando ela vira texto, e o texto afirma.
   *
   * Aconteceu: uma carteira com 76.533 $RONKE e 3 Ronkeverse recebeu "It does
   * not hold enough for any role yet". Todas as medidas tinham falhado, `merece`
   * veio vazio, e o vazio foi lido como resposta em vez de como ignorância.
   *
   * Nulo obriga quem escreve a mensagem a decidir o que dizer. Lista vazia deixa
   * ele afirmar sem perceber.
   */
  const merece = incerto.length
    ? null
    : cargosPara(medidas, regras).filter((c) => !falhouAoDar.has(String(c)))

  return { medidas, decisao, incerto, erros, merece }
}

/**
 * UMA PASSADA da varredura de pagamento.
 *
 * Devolve o que aconteceu — quem verificou, o que ganhou. Quem chama decide o
 * que fazer com isso (avisar no Discord, escrever no log).
 */
export async function varreduraDePagamento({ servidor, regras, segredo }) {
  const abertos = await pendentes()
  if (abertos.size === 0) {
    // Nada a fazer. Nem avança o ponteiro: sem ninguém esperando, não interessa
    // saber onde a cadeia está — e avançar aqui faria a próxima janela começar
    // depois de uma transação que chegou no meio.
    return { pendentes: 0, verificados: [] }
  }

  /*
   * O EXPLORER PRIMEIRO, A VARREDURA DE BLOCOS COMO RESERVA.
   *
   * Uma chamada por endereço pendente, ~300 ms, e ela enxerga o histórico
   * inteiro daquele endereço — inclusive o pagamento que caiu enquanto a
   * varredura estava fora do ar. É o que faz uma parada deixar de custar o gas
   * de alguém.
   *
   * Cada transação que ele aponta é conferida no RPC antes de valer (ver
   * `pagamentosPara`): o índice diz onde olhar, a cadeia diz o que é verdade.
   *
   * Se o explorer não responder, cai na varredura de blocos, que é lenta e
   * míope mas não depende de terceiro. Duas fontes independentes pro mesmo fato.
   */
  const desde = Date.now() - JANELA_MIN * 60_000
  const porExplorer = []
  let consultados = 0
  let falharam = 0
  for (const endereco of abertos.keys()) {
    consultados++
    const r = await pagamentosPara(endereco, desde)
    if (!r.ok) {
      /*
       * `continue`, E NAO `break`.
       *
       * A versao anterior saia do laco na primeira falha — e jogava fora os
       * pagamentos JA ACHADOS dos enderecos anteriores. Uma piscada no ultimo
       * endereco da fila cancelava a verificacao de todo mundo que veio antes,
       * e a passada inteira caia pra varredura de blocos sem necessidade.
       */
      falharam++
      continue
    }
    porExplorer.push(...r.achados)
  }
  /*
   * Uma falha isolada nao invalida a fonte. So se a maioria falhar e que vale a
   * pena pagar o preco da varredura de blocos, que e lenta e ja matou o processo
   * uma vez com 429.
   */
  const explorerServiu = consultados > 0 && falharam <= consultados / 2

  const agora = await blocoAtual()
  const salvo = await ultimoBloco()
  const querido = salvo ? salvo + 1 : agora - RECUO_INICIAL
  // Ver TETO_ATRASO: recuperar um atraso grande custa mais do que o que ele
  // acharia, e o que ele acharia já venceu.
  const de = Math.max(querido, agora - TETO_ATRASO)
  const pulou = de - querido
  if (de > agora) return { pendentes: abertos.size, verificados: [] }

  const crus = explorerServiu ? porExplorer : await procuraPagamentos([...abertos.keys()], de, agora)
  const fonte = explorerServiu ? 'explorer' : 'blocos'

  /*
   * UM PENDENTE, UM PAGAMENTO — E O MAIS NOVO.
   *
   * A versao anterior processava TODOS os pagamentos achados, em sequencia, e
   * quem acabava valendo era o ULTIMO da lista. Como o explorer devolve em ordem
   * decrescente, o ultimo era o MAIS VELHO.
   *
   * O estrago acontecia num caso banal: a pessoa manda da carteira errada, se da
   * conta, e manda da certa. As duas caem na mesma janela. A primeira iteracao
   * amarra a certa e concede o cargo; a segunda amarra a errada e TIRA o cargo
   * que acabou de dar — e ela recebe duas mensagens contraditorias.
   *
   * Ordem de lista de terceiro nunca pode decidir qual carteira fica amarrada.
   * Aqui a regra e explicita: por destino, fica o de bloco maior.
   */
  const porDestino = new Map()
  for (const p of crus) {
    const atual = porDestino.get(p.destino)
    if (!atual || p.bloco > atual.bloco) porDestino.set(p.destino, p)
  }
  const pagos = [...porDestino.values()]
  const descartados = crus.length - pagos.length

  const verificados = []

  for (const p of pagos) {
    const dado = abertos.get(p.destino)
    if (!dado) continue

    /*
     * O REMETENTE É A PROVA. Só quem controla a carteira consegue mandar dela —
     * e é essa carteira que vai ser conferida, não uma que alguém digitou.
     */
    const carteira = p.remetente

    /*
     * CONFERÊNCIA DE PARANOIA: o endereço bate com o membro que pediu?
     *
     * `enderecoDe` é determinístico, então dá pra recalcular e comparar. Se não
     * bater, o estado foi adulterado ou o segredo mudou — e nos dois casos dar
     * cargo seria pior que não dar.
     */
    if (enderecoDe(dado.membro, segredo).toLowerCase() !== p.destino) continue

    const desamarrado = await amarra(dado.membro, carteira)
    // A varredura PODE varrer os 107 ids: ela tem tempo, e ninguém está olhando
    // uma tela esperando por ela.
    const r = await aplicaCargos(servidor, dado.membro, carteira, regras, { podeVarrer: true })
    await fechaPendente(p.destino)

    /*
     * E AGORA AVISA A PESSOA.
     *
     * Sem isto o fluxo terminava em silêncio: a pessoa mandava a transação e não
     * recebia nada — tinha que ir conferir a própria lista de cargos pra
     * descobrir se deu certo. Silêncio depois de mandar dinheiro pra um endereço
     * é indistinguível de erro, e é o momento em que ela vem perguntar no chat.
     *
     * O aviso é a última coisa e é opcional: o cargo já está dado. Se o token da
     * interação venceu (varredura atrasada), a falha é registrada e a fila
     * continua — o aviso de um não pode custar a verificação do próximo.
     */
    let avisou = null
    if (dado.aviso?.app && dado.aviso?.token) {
      const env = await avisaDepois(
        dado.aviso.app,
        dado.aviso.token,
        // Ver `aplicaCargos`: com medida incerta, `merece` e nulo e a lista nao
        // pode ser exibida como se fosse o resultado.
        r.merece === null ? msg.naoConsegui() : msg.verificado(carteira, r.merece),
      ).catch((e) => ({ ok: false, status: e.message }))
      avisou = env.ok ? 'ok' : `falhou(${env.status})`
    }

    verificados.push({
      membro: dado.membro,
      carteira,
      tx: p.tx,
      medidas: r.medidas,
      ganhou: r.decisao.dar,
      perdeu: r.decisao.tirar,
      merece: r.merece,
      desamarrado,
      avisou,
      erros: r.erros,
    })
  }

  await gravaBloco(agora)
  // `pulou` > 0 significa que a varredura esteve parada mais tempo que a janela.
  // Não é fatal, mas é a assinatura de um problema anterior — e some do log se
  // ninguém contar.
  return { pendentes: abertos.size, de, ate: agora, pulou, fonte, pagos: pagos.length, descartados, verificados }
}

/**
 * REVARREDURA — tira o cargo de quem vendeu.
 *
 * Sem isto, o cargo perde sentido em alguns meses: quem vendeu continua com
 * acesso. É a metade menos glamourosa da verificação e a que faz ela valer algo.
 */
/**
 * TIRA O CARGO DE QUEM PERDEU A CARTEIRA PRA OUTRO MEMBRO.
 *
 * `amarra` desamarra o dono anterior quando alguem verifica com uma carteira que
 * ja era de outro. Isso sempre foi deliberado — sem essa regra, tres pessoas
 * usariam a mesma carteira e as tres teriam cargo com um NFT so.
 *
 * O que faltava era a outra metade. Sair de `vinculo` e sair do alcance da
 * revarredura, que e justamente quem tiraria o cargo dele. O anterior ficava com
 * tudo, invisivel, sem dono e sem auditoria — e uma carteira com um NFT dava
 * cargo permanente a quantas contas quisessem, a preco de gas.
 *
 * Esta funcao e a metade que faltava. Ela roda a cada volta da varredura porque
 * a fila quase sempre esta vazia (um HGETALL e sai), e porque o intervalo entre
 * perder a carteira e perder o cargo e exatamente a janela do abuso.
 */
/**
 * REFAZ A FOTO DOS DONOS DE 1/1, se ela estiver velha.
 *
 * São 107 `ownerOf` a 700 ms cada — mais de um minuto. Isso NUNCA pode acontecer
 * com alguém esperando na fila, e por isso quem chama só chama em volta ociosa.
 *
 * Devolve o que fez, pra aparecer no log: uma foto que para de ser tirada é uma
 * foto que envelhece até parar de valer, e aí a regra do Ronke Lord vira
 * "incerto" pra sempre — sem conceder e sem remover, calada.
 */
export async function atualizaLords(regras) {
  const regra = regras.find((r) => tipoDaRegra(r) === 'ERC-721-ids')
  if (!regra) return { pulou: 'sem regra de 1/1' }

  const contrato = String(regra.contrato).toLowerCase()
  const atual = await leLords()
  if (atual && atual.contrato === contrato && atual.completo && Date.now() - atual.quando < VALIDADE_LORDS) {
    return { pulou: 'foto ainda vale' }
  }

  const mapa = await mapaDeDonos(contrato, regra.ids || [])
  /*
   * FOTO INCOMPLETA É GUARDADA MESMO ASSIM, marcada como incompleta — quem lê
   * recusa usá-la (ver `medeUma`). Guardar serve pro log e pro painel: "a foto
   * está incompleta há 6 horas" é um problema visível; "não há foto" some.
   */
  await guardaLords({ ...mapa, contrato })
  return {
    donos: Object.keys(mapa.donos).length,
    completo: mapa.completo,
    tokens: mapa.total,
  }
}

export async function limpaDesamarrados({ servidor, regras }) {
  const fila = await desamarrados()
  if (fila.size === 0) return { limpos: 0, mudancas: [] }

  const geridos = new Set(cargosGeridos(regras))
  const mudancas = []

  for (const [membro, quando] of fila) {
    try {
      const atuais = await cargosDoMembro(servidor, membro)
      const tirar = atuais.map(String).filter((c) => geridos.has(c))
      if (tirar.length) {
        await aplica(servidor, membro, { dar: [], tirar }, 'Ronkelland: carteira reivindicada por outro membro')
      }
      await tiraDesamarrado(membro)
      mudancas.push({ membro, tirou: tirar.length, quando })
    } catch (e) {
      /*
       * MEMBRO QUE SAIU DO SERVIDOR devolve 404 aqui, e nao e erro do sistema —
       * e alguem que foi embora. Sai da fila do mesmo jeito, senao ela nunca
       * esvazia e a tentativa se repete a cada volta, pra sempre.
       */
      if (/404/.test(String(e.message))) {
        await tiraDesamarrado(membro)
        mudancas.push({ membro, tirou: 0, saiu: true })
      } else {
        mudancas.push({ membro, erro: e.message })
      }
    }
  }
  return { limpos: mudancas.length, mudancas }
}

export async function revarredura({ servidor, regras }) {
  const todos = await vinculos()

  /*
   * O SCORE DE TODO MUNDO NUMA IDA SÓ.
   *
   * A API aceita 50 carteiras por chamada. Sem isto seria uma chamada por
   * membro, e a revarredura é justamente onde há muitos membros — o único lugar
   * do sistema onde o custo cresce com o tamanho da comunidade.
   *
   * É só velocidade: se falhar, cada `scoreDe` pergunta de novo por conta.
   */
  if (regras.some((r) => tipoDaRegra(r) === 'score')) {
    await preaquece([...todos.values()])
  }

  const mudancas = []
  for (const [membro, carteira] of todos) {
    try {
      // A revarredura tambem pode varrer: ela roda uma vez por dia, sozinha.
      const r = await aplicaCargos(servidor, membro, carteira, regras, { podeVarrer: true })
      if (r.decisao.dar.length || r.decisao.tirar.length) {
        mudancas.push({ membro, carteira, ...r.decisao, incerto: r.incerto })
      }
    } catch (e) {
      // Membro que saiu do servidor devolve 404 aqui. Não é erro do sistema —
      // é só alguém que foi embora, e derrubar a passada por isso deixaria todo
      // mundo depois dele sem revisão.
      mudancas.push({ membro, carteira, erro: e.message })
    }
  }
  return { conferidos: todos.size, mudancas }
}
