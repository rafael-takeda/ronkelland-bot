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
import { decideCargos } from './regras.js'
import { enderecoDe, procuraPagamentos, saldoNoContrato } from './prova.js'
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

/** Saldos de uma carteira em todos os contratos citados nas regras. */
export async function saldosDe(carteira, regras) {
  const saldos = {}
  const incerto = []
  for (const r of regras) {
    const c = String(r.contrato).toLowerCase()
    if (c in saldos) continue
    const s = await saldoNoContrato(carteira, c, r.casas)
    if (s.ok) saldos[c] = s.saldo
    else incerto.push(c)
  }
  return { saldos, incerto }
}

/**
 * Aplica os cargos que a carteira merece.
 *
 * `incerto` NÃO É VAZIO significa que algum contrato não respondeu. Nesse caso o
 * ciclo não TIRA nada — só dá. Tirar cargo porque o RPC piscou é o pior erro
 * deste sistema: o membro não fez nada e perde o acesso, e ele nem sabe por quê.
 */
export async function aplicaCargos(servidor, membro, carteira, regras) {
  const { saldos, incerto } = await saldosDe(carteira, regras)
  const atuais = await cargosDoMembro(servidor, membro)
  const decisao = decideCargos(saldos, regras, atuais)

  if (incerto.length) {
    decisao.tirar = []
  }

  const erros = await aplica(servidor, membro, decisao, 'Ronkelland: verificação')
  return { saldos, decisao, incerto, erros }
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
      saldos: r.saldos,
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
