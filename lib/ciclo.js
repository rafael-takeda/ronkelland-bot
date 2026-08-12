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
import { aplica, cargosDoMembro } from './discord.js'
import { chaveDaMedida, decideCargos, tipoDaRegra } from './regras.js'
import { enderecoDe, procuraPagamentos, saldoNoContrato, temAlgumToken } from './prova.js'
import { preaquece, scoreDe } from './score.js'
import {
  amarra,
  fechaPendente,
  gravaBloco,
  pendentes,
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
 * UMA medida de uma carteira — o que esta regra precisa saber.
 *
 * `{ ok:false }` é "não consegui perguntar", nunca "não tem". Todo caminho aqui
 * preserva essa distinção, porque é ela que impede o sistema de tirar cargo de
 * quem não fez nada.
 *
 * `jaMedido` é o que já foi respondido nesta passada, e serve pro atalho dos 1/1
 * logo abaixo.
 */
async function medeUma(carteira, r, jaMedido) {
  const tipo = tipoDaRegra(r)
  const contrato = String(r.contrato || '').toLowerCase()

  if (tipo === 'score') {
    const s = await scoreDe(carteira)
    return s.ok ? { ok: true, valor: s.score } : { ok: false }
  }

  if (tipo === 'ERC-721-ids') {
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
export async function medidasDe(carteira, regras) {
  const medidas = {}
  const incerto = []
  for (const r of regras) {
    const chave = chaveDaMedida(r)
    if (chave in medidas || incerto.includes(chave)) continue
    const m = await medeUma(carteira, r, medidas)
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
export async function aplicaCargos(servidor, membro, carteira, regras) {
  const { medidas, incerto } = await medidasDe(carteira, regras)
  const atuais = await cargosDoMembro(servidor, membro)
  const decisao = decideCargos(medidas, regras, atuais)

  if (incerto.length) {
    decisao.tirar = []
  }

  const erros = await aplica(servidor, membro, decisao, 'Ronkelland: verificação')
  return { medidas, decisao, incerto, erros }
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

  const agora = await blocoAtual()
  const salvo = await ultimoBloco()
  const de = salvo ? salvo + 1 : agora - RECUO_INICIAL
  if (de > agora) return { pendentes: abertos.size, verificados: [] }

  const pagos = await procuraPagamentos([...abertos.keys()], de, agora)
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
    const r = await aplicaCargos(servidor, dado.membro, carteira, regras)
    await fechaPendente(p.destino)

    verificados.push({
      membro: dado.membro,
      carteira,
      tx: p.tx,
      medidas: r.medidas,
      ganhou: r.decisao.dar,
      perdeu: r.decisao.tirar,
      desamarrado,
      erros: r.erros,
    })
  }

  await gravaBloco(agora)
  return { pendentes: abertos.size, de, ate: agora, pagos: pagos.length, verificados }
}

/**
 * REVARREDURA — tira o cargo de quem vendeu.
 *
 * Sem isto, o cargo perde sentido em alguns meses: quem vendeu continua com
 * acesso. É a metade menos glamourosa da verificação e a que faz ela valer algo.
 */
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
      const r = await aplicaCargos(servidor, membro, carteira, regras)
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
