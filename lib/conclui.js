/**
 * ============================================================================
 * "I SENT IT" — a verificação inteira dentro do clique
 * ============================================================================
 *
 * Antes, o fim do fluxo era assíncrono: a pessoa mandava a transação e esperava
 * a varredura achar. Quando ela estava saudável isso era ~1 minuto; quando não,
 * era um pagamento perdido e nenhuma explicação.
 *
 * Aqui a pessoa dispara a própria conclusão. Ela mandou, ela aperta, e a
 * resposta vem com os cargos — em ~2 segundos.
 *
 * ---------------------------------------------------------------------------
 * SEM LAÇO DE ESPERA, E ISSO É DELIBERADO
 * ---------------------------------------------------------------------------
 * A tentação é ficar consultando por 30 segundos até o pagamento aparecer. Não
 * dá: o plano gratuito da Vercel não COBRA quando estoura a cota de execução,
 * ele BLOQUEIA a função por 30 dias. Um laço de 30 s com um cooldown menor que
 * ele deixa um único membro segurando duas invocações vivas o tempo todo — a
 * conta dava 3,7 dias até o apagão.
 *
 * Então é UMA consulta por aperto. Se ainda não apareceu, a resposta é "aperte
 * de novo" — a espera fica com a pessoa, que tem paciência infinita e não tem
 * cota. Custa um toque a mais e não custa o bot.
 *
 * ---------------------------------------------------------------------------
 * A ORDEM IMPORTA MAIS QUE A VELOCIDADE
 * ---------------------------------------------------------------------------
 * Reservar antes de olhar a cadeia; amarrar antes de aplicar; aplicar antes de
 * responder; fechar o pendente por último. Assim uma queda no meio deixa o
 * pendente ABERTO — e a varredura, que continua rodando, termina o serviço.
 * Nenhum passo aqui é a única chance de nada.
 */
import { aplicaCargos } from './ciclo.js'
import { editaResposta } from './discord.js'
import { msg } from './mensagens.js'
import { enderecoDe, pagamentosPara } from './prova.js'
import {
  amarra,
  carteiraDe,
  fechaPendente,
  gastou,
  JANELA_MIN,
  leLords,
  liberaReserva,
  reserva,
} from './estado.js'

/** Apertos por dia, por membro. Ver `gastou`. */
const TETO_DIARIO = 30

/** Segundos que uma conferência segura o endereço pra si. */
const RESERVA_S = 25

export async function conclui({ membro, app, token, servidor, regras, segredo }) {
  const endereco = enderecoDe(membro, segredo)
  const responde = (texto) => editaResposta(app, token, { content: texto })

  let peguei = false
  try {
    /*
     * O TETO VEM ANTES DE QUALQUER TRABALHO. Contar depois de gastar não
     * protege de nada — o gasto é justamente o que se quer limitar.
     */
    if (await gastou(membro, TETO_DIARIO)) return await responde(msg.calma())

    peguei = await reserva(endereco, membro, RESERVA_S)
    if (!peguei) return await responde(msg.aindaTrabalhando())

    // UMA consulta. Ver o cabeçalho.
    const achado = await pagamentosPara(endereco, Date.now() - JANELA_MIN * 60_000)

    if (!achado.ok) return await responde(msg.explorerOcupado())

    if (!achado.achados.length) {
      /*
       * Sem pagamento novo. Se a pessoa JÁ tem carteira amarrada, ela
       * provavelmente clicou pra reconferir cargos — e aí vale medir de novo,
       * que é o que ela quer. Sem carteira, é só "ainda não vi".
       */
      const jaTem = await carteiraDe(membro)
      if (!jaTem) return await responde(msg.naoAchei())
      const r = await aplicaCargos(servidor, membro, jaTem, regras, { lords: await leLords() })
      return await responde(
        r.merece === null ? msg.naoConsegui() : msg.verificado(jaTem, r.merece),
      )
    }

    /*
     * O MAIS NOVO, e um só. `pagamentosPara` devolve em ordem decrescente de
     * bloco; deixar a ordem de uma lista decidir qual carteira fica amarrada foi
     * um bug de verdade — quem mandava da carteira errada e corrigia acabava
     * amarrado na errada.
     */
    const p = achado.achados[0]

    /*
     * CONFERÊNCIA DE PARANOIA, a mesma da varredura: o destino bate com o membro
     * que apertou? `enderecoDe` é determinístico, então dá pra recalcular. Se
     * não bater, o estado foi adulterado — e aí não dar cargo é o certo.
     */
    if (enderecoDe(membro, segredo).toLowerCase() !== p.destino) {
      return await responde(msg.naoAchei())
    }

    await amarra(membro, p.remetente)

    const r = await aplicaCargos(servidor, membro, p.remetente, regras, { lords: await leLords() })

    /*
     * `merece === null` não existe hoje, mas `incerto` existe: quando alguma
     * medida não pôde ser lida, nada é removido e a lista fica incompleta.
     * Dizer "não consegui" é melhor que listar cargos pela metade como se fosse
     * o resultado final.
     */
    // `merece === null` significa que alguma medida nao pode ser lida. Listar o
    // que sobrou seria afirmar uma coisa que nao se sabe -- ver `aplicaCargos`.
    await responde(
      r.merece === null ? msg.naoConsegui() : msg.verificado(p.remetente, r.merece),
    )

    // POR ÚLTIMO: enquanto o pendente existe, a varredura ainda pode terminar
    // o serviço se algo acima tiver falhado.
    await fechaPendente(p.destino)
  } catch (e) {
    console.error('[conclui]', e?.message || e)
    await responde('Something went wrong on my side. Press the button again in a moment.').catch(
      () => {},
    )
  } finally {
    if (peguei) await liberaReserva(endereco).catch(() => {})
  }
}
