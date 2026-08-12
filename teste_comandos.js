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

/*
 * `/ronkelland` NAO TEM SUBCOMANDO, e isso e a decisao.
 *
 * A primeira versao era `/ronkelland rule add <contrato> <minimo> <cargo>`:
 * obrigava o admin a saber a forma do comando de cor e a digitar tudo numa
 * linha, sem enxergar o que ja existia. Agora o comando so ABRE o painel, e a
 * lista de cargos, a janelinha e o seletor de canal moram la.
 *
 * O teste afirma a ausencia de proposito: se alguem reintroduzir uma opcao aqui,
 * e porque esta voltando pro caminho digitado sem querer.
 */
conf((rl.options || []).length === 0, '/ronkelland nao tem opcao nenhuma — ele so abre o painel')

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
  msg.verificado('0xc24566e78709ce989db5211bb088ead4dce81b74', ['1350620589613776976']),
  msg.verificado('0xc24566e78709ce989db5211bb088ead4dce81b74', []),
  msg.semNft,
]
for (const t of amostra) console.log(t.split('\n').map((l) => '  ' + l).join('\n') + '\n')

/*
 * Argumentos genericos que servem pra TODAS as mensagens: a primeira posicao tem
 * que aceitar `.slice` (endereco) e a segunda tem que ser LISTA, porque
 * `cargoRecusado` mapeia os motivos e `verificado` mapeia os cargos.
 *
 * Esta varredura existe pra pegar acento portugues e link em texto que o membro
 * le. Ela roda sobre o objeto inteiro de proposito: mensagem nova entra na
 * conferencia sem ninguem precisar lembrar de adiciona-la.
 */
const tudo = Object.values(msg)
  .map((v) => (typeof v === 'function' ? v('0xabcdef0123456789abcdef0123456789abcdef01', ['y'], 'z') : v))
  .join(' ')
conf(!/[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/.test(tudo), 'nenhuma mensagem do usuario tem acento portugues')
conf(!/\bhttps?:\/\//.test(tudo), 'nenhuma mensagem manda o membro clicar em link')
conf(/never ask you to connect a wallet/i.test(tudo), 'a instrucao diz explicitamente que nunca pedimos conexao')

console.log(falhas ? `\n${falhas} FALHA(S)\n` : '\nTUDO OK\n')
process.exitCode = falhas ? 1 : 0
