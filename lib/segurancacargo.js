import { msg } from './mensagens.js'
/**
 * ============================================================================
 * QUE CARGO ESTE BOT PODE GERIR — e qual ele tem que RECUSAR
 * ============================================================================
 *
 * O pior estrago possivel deste sistema nao e deixar de dar um cargo. E dar o
 * cargo ERRADO: se uma regra apontar pra um cargo com permissao de
 * Administrador, qualquer pessoa que comprar um NFT vira dono do servidor.
 *
 * Isso nao exige ma-fe nem ataque -- exige um clique errado num seletor com
 * varios cargos parecidos. Por isso a recusa mora aqui, e nao na atencao de
 * quem configura.
 *
 * O Discord manda as permissoes do cargo como um bitfield em string decimal
 * (elas nao cabem num Number: sao 41+ bits e crescem). Por isso a conta e toda
 * em BigInt -- com Number, permissoes altas seriam truncadas e a trava passaria
 * a aprovar justamente os cargos mais perigosos.
 */

/**
 * As permissoes que tornam um cargo perigoso demais pra ser distribuido
 * automaticamente. Numeros do Discord, em BigInt.
 */
export const PERIGOSAS = {
  ADMINISTRATOR:     1n << 3n,
  KICK_MEMBERS:      1n << 1n,
  BAN_MEMBERS:       1n << 2n,
  MANAGE_CHANNELS:   1n << 4n,
  MANAGE_GUILD:      1n << 5n,
  MANAGE_MESSAGES:   1n << 13n,
  MANAGE_ROLES:      1n << 28n,
  MANAGE_WEBHOOKS:   1n << 29n,
  MODERATE_MEMBERS:  1n << 40n,
}

/**
 * O cargo pode ser gerido por este bot?
 *
 * `cargo` e o objeto que a API do Discord devolve: { id, name, permissions,
 * position, managed }.
 *
 * `posicaoDoBot` e a posicao do cargo mais alto do proprio bot. O Discord recusa
 * atribuir cargo igual ou acima do seu -- e recusa CALADO, entao a checagem aqui
 * existe pra virar uma frase util em vez de um silencio.
 */
export function podeGerir(cargo, posicaoDoBot) {
  const motivos = []
  const perms = BigInt(cargo.permissions ?? '0')

  for (const [nome, bit] of Object.entries(PERIGOSAS)) {
    if ((perms & bit) === bit) motivos.push(`tem permissao ${nome}`)
  }

  // Cargo "managed" e de integracao (bot, boost, assinatura). O Discord nao
  // deixa ninguem atribuir esses a mao -- nem o bot.
  if (cargo.managed) motivos.push('e um cargo de integracao, o Discord nao permite atribuir')

  // @everyone tem posicao 0 e id igual ao do servidor. Nao e atribuivel.
  if (cargo.position === 0) motivos.push('e o @everyone')

  if (typeof posicaoDoBot === 'number' && cargo.position >= posicaoDoBot) {
    motivos.push(`esta acima do cargo do bot (${cargo.position} >= ${posicaoDoBot}) -- arraste o cargo do bot pra cima dele`)
  }

  return { pode: motivos.length === 0, motivos }
}

/**
 * A frase que o admin le no Discord.
 *
 * O TEXTO MORA EM `mensagens.js`, com todo o resto que o usuario le. Esta
 * funcao so existe pra quem chama nao precisar saber disso.
 */
export function explicaRecusa(cargo, motivos) {
  return msg.cargoRecusado(cargo.name, motivos)
}
