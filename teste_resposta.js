/**
 * PROVA DO EFÊMERO — a mensagem tem que aparecer só pra quem pediu.
 *
 *   node teste_resposta.js
 *
 * Aqui não há Discord: é a FORMA da resposta que está sendo conferida. Vale a
 * pena testar porque o modo de falha é silencioso — sem a marca, o Discord
 * publica a mensagem no canal e ninguém percebe até o endereço de alguém estar
 * à vista de todo mundo.
 *
 * E, neste bot, endereço à vista não é vazamento de privacidade: é o buraco que
 * deixa outra pessoa registrar a carteira dela no lugar da sua. Ver o cabeçalho
 * de `resposta.js`.
 */
import { EFEMERA, mensagemDoCanal, pensandoSo, responde, respondeSo } from './lib/resposta.js'
import { msg } from './lib/mensagens.js'

let falhas = 0
const conf = (c, m, e = '') => {
  if (!c) {
    falhas++
    console.error('  FALHOU  ' + m + '  ' + e)
  } else console.log('  ok      ' + m + (e ? '  ' + e : ''))
}

console.log('\nRESPOSTA INDIVIDUAL (EFÊMERA)\n')

conf(EFEMERA === 64, 'a marca é 64 (1 << 6)', String(EFEMERA))

const r = respondeSo('teste')
conf(r.type === 4, 'responde com mensagem')
conf(r.data.flags === EFEMERA, 'e ela é individual', String(r.data.flags))

const p = pensandoSo()
conf(p.type === 5 && p.data.flags === EFEMERA, 'o "pensando…" também é individual')

const pub = responde('teste')
conf(!pub.data.flags, 'a versão pública NÃO tem a marca — é o que a distingue')

/*
 * O TESTE QUE IMPORTA: a instrução com o endereço nunca pode sair pública.
 *
 * É o cenário concreto — se `comoVerificar` fosse entregue por `responde`, o
 * endereço do João apareceria no canal e qualquer um poderia mandar a própria
 * transação pra lá.
 */
const instrucao = respondeSo(msg.comoVerificar('0xabc123', 5))
conf(instrucao.data.flags === EFEMERA, 'a instrução com o endereço vai individual')
conf(instrucao.data.content.includes('0xabc123'), 'e carrega o endereço', 'sim')

// ------------------------------------------------- a mensagem fixa do canal
const canal = mensagemDoCanal()
conf(!canal.flags, 'a mensagem fixa do canal é pública — ela é pra todos')
conf(canal.components?.[0]?.components?.[0]?.type === 2, 'tem um botão')
conf(canal.components[0].components[0].custom_id === 'verificar', 'o botão avisa qual ação foi pedida')

/*
 * O BOTÃO NÃO PODE CARREGAR SEGREDO. Ele é público e o `custom_id` viaja no
 * clique de qualquer um — se o endereço estivesse ali, estaria à vista. Ele só
 * diz "fulano clicou"; o endereço nasce depois, na resposta individual.
 */
const cru = JSON.stringify(canal)
conf(!/0x[0-9a-f]{40}/i.test(cru), 'a mensagem pública não contém endereço nenhum')

// Tudo que o membro lê continua em inglês.
conf(!/[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/.test(cru), 'a mensagem do canal está em inglês')
conf(/never ask you to connect a wallet/i.test(cru), 'e repete a promessa: nunca pedimos conexão')

console.log('\n  --- o que fica fixado no canal, visível a todos ---\n')
console.log('  ' + canal.embeds[0].title)
console.log(canal.embeds[0].description.split('\n').map((l) => '  ' + l).join('\n'))
console.log('  [ ' + canal.components[0].components[0].label + ' ]')

console.log(falhas ? `\n${falhas} FALHA(S)\n` : '\nTUDO OK\n')
process.exitCode = falhas ? 1 : 0
