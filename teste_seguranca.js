/**
 * PROVA DA TRAVA — o cargo perigoso tem que ser RECUSADO.
 *
 *   node teste_seguranca.js
 */
import { PERIGOSAS, podeGerir } from './lib/segurancacargo.js'

let falhas = 0
const conf = (c, m, e = '') => { if (!c) { falhas++; console.error('  FALHOU  ' + m + '  ' + e) } else console.log('  ok      ' + m + (e ? '  ' + e : '')) }

const cargo = (o) => ({ id: '1', name: 'X', permissions: '0', position: 5, managed: false, ...o })
const POSICAO_BOT = 10

console.log('\nTRAVA DE CARGO PERIGOSO\n')

const bom = podeGerir(cargo({ name: 'Ronkeverse Holder', permissions: '0' }), POSICAO_BOT)
conf(bom.pode, 'cargo sem permissao nenhuma: pode gerir')

// O caso que motiva a trava inteira.
const admin = podeGerir(cargo({ name: 'Admin', permissions: String(PERIGOSAS.ADMINISTRATOR) }), POSICAO_BOT)
conf(!admin.pode, 'ADMINISTRADOR: recusado', admin.motivos.join(' | '))

for (const [nome, bit] of Object.entries(PERIGOSAS)) {
  const r = podeGerir(cargo({ name: nome, permissions: String(bit) }), POSICAO_BOT)
  conf(!r.pode, `${nome}: recusado`)
}

// Permissao inofensiva nao pode bloquear -- senao a trava vira estorvo e alguem
// desliga ela. SEND_MESSAGES = 1 << 11.
const inofensivo = podeGerir(cargo({ permissions: String(1n << 11n) }), POSICAO_BOT)
conf(inofensivo.pode, 'permissao inofensiva (enviar mensagem) nao bloqueia')

/*
 * BIGINT NAO E PRECIOSISMO. MODERATE_MEMBERS e o bit 40; em Number, operacoes
 * bit a bit truncam em 32 bits e o teste passaria a APROVAR o cargo. Ou seja: a
 * trava falharia justamente nas permissoes mais altas.
 */
const alto = podeGerir(cargo({ permissions: String(PERIGOSAS.MODERATE_MEMBERS) }), POSICAO_BOT)
conf(!alto.pode, 'permissao de bit alto (40) ainda e detectada', alto.motivos.join(' | '))

const combo = podeGerir(cargo({ permissions: String(PERIGOSAS.BAN_MEMBERS | (1n << 11n)) }), POSICAO_BOT)
conf(!combo.pode, 'perigosa misturada com inofensiva: recusa')

const acima = podeGerir(cargo({ position: 20 }), POSICAO_BOT)
conf(!acima.pode, 'cargo acima do bot: recusado com instrucao', acima.motivos.join(' | '))

const integracao = podeGerir(cargo({ managed: true }), POSICAO_BOT)
conf(!integracao.pode, 'cargo de integracao: recusado')

const everyone = podeGerir(cargo({ position: 0 }), POSICAO_BOT)
conf(!everyone.pode, '@everyone: recusado')

console.log(falhas ? `\n${falhas} FALHA(S)\n` : '\nTUDO OK\n')
process.exitCode = falhas ? 1 : 0
