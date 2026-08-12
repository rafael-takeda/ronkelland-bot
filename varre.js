/**
 * A VARREDURA — vê a transação chegar e dá o cargo.
 *
 *   node --env-file=.env varre.js            uma passada
 *   MINUTOS=50 node --env-file=.env varre.js fica vivo 50 min
 *   node --env-file=.env varre.js --revarre  revarredura (tira de quem vendeu)
 *
 * ---------------------------------------------------------------------------
 * DUAS ROTINAS, DOIS RITMOS
 * ---------------------------------------------------------------------------
 * A varredura de PAGAMENTO é o caminho de quem está esperando agora: precisa
 * ser de minuto em minuto, senão a pessoa manda a transação e fica olhando pro
 * nada. Mas ela só custa alguma coisa quando existe alguém na fila — com a
 * lista de pendentes vazia é uma chamada e pronto.
 *
 * A REVARREDURA tira o cargo de quem vendeu. Não tem urgência nenhuma: roda uma
 * vez por dia e ninguém sente diferença.
 *
 * ---------------------------------------------------------------------------
 * O MESMO TRUQUE DO BOT DE VENDAS
 * ---------------------------------------------------------------------------
 * Agendamento no GitHub Actions é melhor-esforço, e frequência alta é a
 * primeira coisa que eles descartam — medido lá: pedindo de 5 em 5 minutos,
 * entregava uma por hora. Então cada execução FICA VIVA e faz o laço por dentro.
 */
import { revarredura, varreduraDePagamento } from './lib/ciclo.js'
import { validaRegras } from './lib/regras.js'
import { regrasEmUso } from './lib/painelrota.js'

/*
 * AS REGRAS VÊM DO PAINEL, quando ele foi usado, e do arquivo quando não.
 *
 * Ler direto do arquivo aqui faria a varredura ignorar tudo que o admin criou no
 * Discord — e o sintoma seria "criei a regra e não aconteceu nada", sem nenhuma
 * pista de que existem duas fontes.
 */
const regras = await regrasEmUso()
const servidor = process.env.DISCORD_GUILD_ID
const segredo = process.env.SEGREDO

/*
 * A CONFERÊNCIA DAS REGRAS, NA PARTIDA E ANTES DE TUDO.
 *
 * `validaRegras` existia e nunca era chamada — e o preço disso foi concreto: a
 * regra do `Ronke Lord` ficou no arquivo, mal formada, sendo ignorada em
 * silêncio. Ninguém percebeu porque o sintoma de uma regra morta é NADA
 * ACONTECER, que é indistinguível de "ninguém se qualificou ainda".
 *
 * Regra quebrada agora derruba a execução. Um bot que não sobe é um problema de
 * dez minutos; um bot que sobe e concede errado é um problema que só aparece
 * quando alguém reclama.
 */
/*
 * LISTA VAZIA NÃO É ERRO, é uma escolha.
 *
 * O admin pode ter tirado a última regra pelo painel. Nesse caso não há nada a
 * fazer — e nada a desfazer: sem regra, `cargosGeridos` é vazio, então a
 * revarredura não tira cargo de ninguém. Os cargos simplesmente congelam.
 *
 * Derrubar a execução aqui transformaria essa escolha num bot fora do ar.
 */
if (regras.length === 0) {
  console.log('nenhuma regra configurada — nada a fazer')
  process.exit(0)
}

const problemas = validaRegras(regras)
if (problemas.length) {
  console.error('regras.json tem problema — nada roda até arrumar:')
  for (const p of problemas) console.error('  ' + p)
  process.exit(1)
}

if (!servidor || !segredo) {
  console.error('Falta DISCORD_GUILD_ID ou SEGREDO.')
  process.exitCode = 1
} else if (process.argv.includes('--revarre')) {
  const r = await revarredura({ servidor, regras })
  console.log(`revarredura: ${r.conferidos} vínculo(s) conferido(s)`)
  for (const m of r.mudancas) {
    if (m.erro) console.log(`  ${m.membro}: ${m.erro.slice(0, 80)}`)
    else console.log(`  ${m.membro}: +${m.dar.length} -${m.tirar.length}`)
  }
  if (!r.mudancas.length) console.log('  nada mudou')
} else {
  const minutos = Number(process.env.MINUTOS || 0)
  const intervalo = Number(process.env.INTERVALO_S || 60) * 1000
  const ate = Date.now() + minutos * 60_000

  do {
    const r = await varreduraDePagamento({ servidor, regras, segredo })
    const marca = new Date().toISOString().slice(11, 19)
    /*
     * Uma linha por volta, e só quando há o que dizer. Cinquenta linhas de
     * "nada aconteceu" escondem justamente a volta em que alguém verificou.
     */
    if (r.pendentes > 0 || r.verificados.length) {
      console.log(`${marca}  esperando ${r.pendentes}  achados ${r.pagos ?? 0}`)
      for (const v of r.verificados) {
        console.log(
          `  VERIFICADO ${v.membro}  carteira ${v.carteira.slice(0, 10)}…` +
            `  +${v.ganhou.length} cargo(s)` +
            (v.desamarrado ? `  (carteira era de ${v.desamarrado})` : '') +
            // O aviso é a parte que a PESSOA vê. Se ele falha, o cargo saiu e
            // ninguém contou — some do log e vira "o bot não fez nada".
            (v.avisou && v.avisou !== 'ok' ? `  AVISO ${v.avisou}` : '') +
            (v.erros.length ? `  ERROS: ${v.erros.join('; ')}` : ''),
        )
      }
    }
    if (Date.now() >= ate) break
    await new Promise((f) => setTimeout(f, intervalo))
  } while (Date.now() < ate)
}
