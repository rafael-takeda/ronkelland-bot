/**
 * PROVA DA FORMA DOS COMANDOS — antes de registrar, nao depois.
 *
 *   node teste_comandos.js
 *
 * O Discord recusa comando mal formado com "Invalid Form Body" e um caminho tipo
 * `options.0.options.2.name`. Isso e ilegivel e so aparece na hora de registrar,
 * quando o bot ja esta indo pro ar. Aqui a forma e conferida antes.
 */
import { COMANDOS, validaComandos } from './lib/comandos.js'
import { msg } from './lib/mensagens.js'

let falhas = 0
const conf = (c, m, e = '') => { if (!c) { falhas++; console.error('  FALHOU  ' + m + '  ' + e) } else console.log('  ok      ' + m + (e ? '  ' + e : '')) }

console.log('\nCOMANDOS DO RONKELLAND\n')

conf(validaComandos(COMANDOS).length === 0, 'a forma passa nas regras do Discord', validaComandos(COMANDOS).join(' | '))

const verify = COMANDOS.find((c) => c.name === 'verify')
const rl = COMANDOS.find((c) => c.name === 'ronkelland')
conf(!!verify && !!rl, 'os dois comandos existem')
conf(!verify.default_member_permissions, '/verify e livre pra qualquer membro')
conf(rl.default_member_permissions === '32', '/ronkelland exige MANAGE_GUILD', rl.default_member_permissions)

const sub = rl.options[0].options.map((s) => s.name)
conf(sub.join() === 'add,list,remove', 'subcomandos: add, list, remove', sub.join(', '))

const add = rl.options[0].options[0]
const tipos = add.options.map((o) => `${o.name}:${o.type}`)
conf(add.options.find((o) => o.name === 'role').type === 8, 'o campo "role" e SELETOR de cargo (tipo 8)', tipos.join(' '))
conf(add.options.every((o) => o.required), 'os tres campos de add sao obrigatorios')
conf(add.options.find((o) => o.name === 'minimum').min_value === 1, 'minimo nao aceita zero')

// Forma quebrada tem que ser PEGA. Se o validador aprova qualquer coisa, ele nao serve.
const ruins = [
  [{ name: 'Ronkelland', description: 'x' }, 'nome com maiuscula'],
  [{ name: 'ok', description: '' }, 'descricao vazia'],
  [{ name: 'ok', description: 'x'.repeat(101) }, 'descricao longa demais'],
]
for (const [c, oQue] of ruins) conf(validaComandos([c]).length > 0, `recusa ${oQue}`)

// ---------------------------------------------------- tudo que o membro le
console.log('\n  --- o que aparece pro membro (ingles) ---\n')
const amostra = [
  msg.comoVerificar('0xa976ecb0272a977a34322c08fa0c49f5b1c1f735', 30),
  msg.verificado(126, '@Ronkeverse Holder'),
  msg.semNft,
]
for (const t of amostra) console.log(t.split('\n').map((l) => '  ' + l).join('\n') + '\n')

// Argumentos genericos que servem pra todas: a segunda posicao e uma LISTA
// porque `cargoRecusado` mapeia os motivos. Sem isso o varredor quebra -- e foi
// o que aconteceu na primeira tentativa.
const tudo = Object.values(msg)
  .map((v) => (typeof v === 'function' ? v('x', ['y'], 'z') : v))
  .join(' ')
conf(!/[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/.test(tudo), 'nenhuma mensagem do usuario tem acento portugues')
conf(!/\bhttps?:\/\//.test(tudo), 'nenhuma mensagem manda o membro clicar em link')
conf(/never ask you to connect a wallet/i.test(tudo), 'a instrucao diz explicitamente que nunca pedimos conexao')

console.log(falhas ? `\n${falhas} FALHA(S)\n` : '\nTUDO OK\n')
process.exitCode = falhas ? 1 : 0
