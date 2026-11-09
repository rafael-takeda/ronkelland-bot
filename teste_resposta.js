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
const ENDERECO = '0xa976ecb0272a977a34322c08fa0c49f5b1c1f735'
const instrucao = respondeSo(msg.comoVerificar(ENDERECO, 10))
conf(instrucao.data.flags === EFEMERA, 'a instrução vai individual')

/*
 * O ENDEREÇO SAI DA INSTRUÇÃO E VIRA MENSAGEM PRÓPRIA.
 *
 * Num bloco de código no meio de um texto longo, o celular não consegue copiar:
 * o toque longo pega o parágrafo inteiro. Sozinho numa mensagem, o Discord móvel
 * mostra o botão de copiar.
 *
 * As duas continuam efêmeras — o endereço da pessoa não pode aparecer no canal,
 * senão um terceiro manda a transação dele pro endereço dela e sequestra a
 * verificação.
 */
conf(instrucao.data.content.includes(ENDERECO), 'ela carrega o endereço')

/*
 * O ENDEREÇO NO TOPO, E SOZINHO NAS SUAS LINHAS.
 *
 * No meio do texto ele não se copia no celular: o toque longo pega o parágrafo
 * inteiro. A ideia melhor — uma mensagem só pra ele, com o botão de copiar —
 * não funciona neste host: acompanhamento exige interação já respondida, e a
 * Vercel corta a rede da função junto com a resposta.
 *
 * Então o teste trava a posição: bloco de código próprio, e o mais alto
 * possível, que é onde o polegar chega.
 */
const linhas = instrucao.data.content.split('\n')
const iEndereco = linhas.findIndex((l) => l.trim() === ENDERECO)
conf(iEndereco > 0, 'o endereço está sozinho na própria linha', `linha ${iEndereco}`)
conf(linhas[iEndereco - 1].trim() === '```', 'dentro de um bloco de código')
conf(linhas[iEndereco + 1].trim() === '```', 'que fecha logo depois dele, sem mais nada junto')
conf(iEndereco <= 4, 'e no TOPO da mensagem, não enterrado no meio do texto', `linha ${iEndereco} de ${linhas.length}`)

/*
 * O ENDEREÇO APARECE UMA VEZ SÓ — aqui OU na segunda mensagem, nunca nas duas.
 *
 * Quando o host segura a invocação, a segunda mensagem sai e o endereço mora lá,
 * sozinho, com o botão de copiar. Repetir o mesmo bloco nas duas confunde e,
 * pior, faz a pessoa copiar o de cima — que é justamente o difícil no celular.
 */
const comSegunda = msg.comoVerificar(ENDERECO, 10, null, true)
conf(!comSegunda.includes(ENDERECO), 'com a segunda mensagem garantida, o endereço NÃO se repete na primeira')
conf(/address \*\*below\*\*/i.test(comSegunda), 'e ela aponta pra baixo')
/*
 * A SEGUNDA MENSAGEM E O ENDERECO PELADO, sem uma crase sequer.
 *
 * Ela era um bloco de codigo. Quem seleciona a mao leva as crases junto, cola
 * `0xabc…` com acento grave nas pontas, e a carteira recusa sem dizer por que.
 * Foi relatado por um membro.
 *
 * O teste compara com IGUALDADE, e nao com `includes`: qualquer coisa a mais na
 * mensagem pode acabar dentro do que a pessoa cola.
 */
const soEnd = msg.soOEndereco(ENDERECO)
conf(soEnd === ENDERECO, 'a segunda mensagem e SO o endereco, sem formatacao', JSON.stringify(soEnd))
conf(!/[`*_~|]/.test(soEnd), 'sem crase, negrito ou qualquer marcacao que possa vir colada junto')

const semSegunda = msg.comoVerificar(ENDERECO, 10, null, false)
conf(semSegunda.includes(ENDERECO), 'sem a segunda, o endereço fica na primeira — ninguém pode ficar sem ele')

/*
 * O PRAZO É CONTADO PELO DISCORD, e não escrito no texto.
 *
 * "You have 10 minutes" é verdade quando a mensagem sai e mentira quando a
 * pessoa volta pra tela — e ela volta, porque no meio disso foi na carteira.
 * `<t:unix:R>` o cliente atualiza sozinho, sem o bot editar nada.
 */
const ATE = Date.now() + 10 * 60_000
const comPrazo = msg.comoVerificar(ENDERECO, 10, null, true, ATE)
conf(comPrazo.includes(`<t:${Math.floor(ATE / 1000)}:R>`), 'o prazo vira carimbo relativo do Discord')
conf(!/You have \*\*10 minutes\*\*/.test(comPrazo), 'e o número fixo some — ele envelhecia na tela')
conf(
  msg.comoVerificar(ENDERECO, 10, null, true).includes('10 minutes'),
  'sem o instante, cai no texto antigo: prazo aproximado é melhor que nenhum',
)

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

/*
 * O AVISO DE QUEIMA TEM QUE ESTAR NA MENSAGEM PÚBLICA, e não só na instrução.
 *
 * A instrução é efêmera: some quando a pessoa recarrega o Discord, e ninguém
 * consegue reler nem mostrar pra outro. Esta aqui é a única que fica — a única
 * que alguém aponta pra quem chegou hoje, ou pra quem quer conferir antes de
 * mexer na carteira.
 *
 * O endereço é `sha256(id + segredo)` truncado: um hash, não uma chave pública
 * derivada de chave privada. Não existe chave que gaste dali. Um aviso sobre
 * dinheiro que só mora num lugar que evapora é um aviso pela metade.
 */
conf(/no owner/i.test(cru), 'avisa que o endereço não tem dono')
conf(/destroyed/i.test(cru), 'e que o que for mandado é destruído')
conf(/not a donation/i.test(cru), 'e que não é doação')
// Zero nao pode voltar: a carteira da Ronin recusa transacao de valor zero.
conf(/any amount works/i.test(cru), 'diz QUALQUER VALOR antes de dar numero')
conf(/0\.00001 RON/.test(cru), 'e da um exemplo de valor pequeno')
conf(!/of \*\*0 RON\*\*/.test(cru), 'e nao manda mandar zero, que a carteira recusa')

/*
 * "COMO GANHAR CADA CARGO" (pedido do Conn, 09/11/2026). Sai das regras do painel
 * e entra na mensagem pública. As quatro regras abaixo são o formato real das que
 * estão em produção.
 */
console.log('\n  COMO GANHAR CADA CARGO\n')

const REGRAS = [
  { nome: 'Ronkeverse chad', cargo: '1350643017999974481', contrato: '0x810b6d1374ac7ba0e83612e7d49f49a13f1de019', tipo: 'ERC-721', casas: 0, minimo: 10, rotulo: 'Ronkeverse NFTs' },
  { nome: 'Ronke Lord', cargo: '1536910104568533012', contrato: '0x810b6d1374ac7ba0e83612e7d49f49a13f1de019', tipo: 'ERC-721-ids', ids: Array.from({ length: 159 }, (_, i) => i + 1) },
  { nome: 'Ronke', cargo: '1537651450602070087', tipo: 'score', minimo: 69 },
  { nome: 'Ronke Club', cargo: '1350620680286240769', tipo: 'rank', minimo: 69 },
]
const comCargos = mensagemDoCanal(REGRAS)
const texto = comCargos.embeds[0].description

conf(/How to get each role/.test(texto), 'a mensagem tem a seção de cargos')
for (const r of REGRAS) conf(texto.includes(`<@&${r.cargo}>`), `e menciona o cargo ${r.nome} (o Discord mostra o nome de agora)`)
// O cargo é a menção e mais nada antes do traço: nome escrito à mão envelhece, a menção não.
const cabecas = texto.split('\n').filter((l) => l.startsWith('• ')).map((l) => l.split(' — ')[0])
conf(
  cabecas.length === REGRAS.length && cabecas.every((c, i) => c === `• <@&${REGRAS[i].cargo}>`),
  'cada linha começa com a menção do cargo, sem o nome escrito à mão',
  JSON.stringify(cabecas),
)
conf(/hold at least 10 Ronkeverse NFTs/.test(texto), 'posse por quantidade diz quantas, com o rótulo do admin')
conf(/hold any one of the 159 1\/1 NFTs/.test(texto), 'posse de id diz quantas da lista, e "1/1" quando não há rótulo')
conf(/reach a Ronke Score of 69 or more/.test(texto), 'score diz o corte')
conf(/rank in the top 69 of the Ronke Score leaderboard/.test(texto), 'rank diz "top N", e não "N ou mais": menor é melhor')
conf(/updates once a day/.test(texto), 'e avisa que o score atualiza uma vez por dia (compra de hoje só vale amanhã)')

// Ordem: o aviso que custa dinheiro vem antes do prêmio, e a promessa é a última linha.
const iBurn = texto.indexOf('no owner')
const iCargos = texto.indexOf('How to get each role')
const iPromessa = texto.indexOf('We will never ask')
conf(iBurn < iCargos && iCargos < iPromessa, 'ordem: aviso de queima, depois os cargos, e a promessa de segurança por último')
conf(texto.trim().endsWith('We will never DM you first.'), 'a mensagem continua terminando na promessa')

conf(texto.length < 4000, 'cabe no embed do Discord', `${texto.length} caracteres`)
conf(!/https?:\/\//.test(JSON.stringify(comCargos)), 'continua sem link nenhum (a promessa é "nunca pedimos pra clicar em link")')
conf(!/[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/.test(JSON.stringify(comCargos)), 'e em inglês')
conf(!/0x[0-9a-f]{40}/i.test(JSON.stringify(comCargos)), 'e sem endereço nenhum: o contrato da regra não vaza pro texto')
conf(comCargos.components[0].components[0].custom_id === 'verificar', 'o botão segue o mesmo')

// Só posse de NFT, sem score: a nota do score não aparece.
const semScore = mensagemDoCanal(REGRAS.slice(0, 2)).embeds[0].description
conf(!/updates once a day/.test(semScore) && !/Ronke Score/.test(semScore), 'sem regra de score/rank, a nota do score não aparece')

// Sem regras: a mensagem é exatamente a de antes.
conf(JSON.stringify(mensagemDoCanal([])) === JSON.stringify(mensagemDoCanal()), 'sem regras nenhuma, a mensagem fica como era')
conf(!/How to get each role/.test(mensagemDoCanal(undefined).embeds[0].description), 'regras ausentes não quebram nada')
conf(!/How to get each role/.test(mensagemDoCanal([{ nome: 'x', cargo: 'nao-e-id', tipo: 'score', minimo: 1 }]).embeds[0].description), 'regra sem id de cargo válido não vira linha (nada de menção quebrada)')

// Regras demais: corta e diz quantas ficaram de fora, em vez de estourar o embed.
const muitas = Array.from({ length: 20 }, (_, i) => ({ nome: `r${i}`, cargo: String(1000000000000000000 + i), tipo: 'ERC-721', contrato: '0x810b6d1374ac7ba0e83612e7d49f49a13f1de019', minimo: i + 1, rotulo: 'Ronkeverse NFTs' }))
const cortada = mensagemDoCanal(muitas).embeds[0].description
conf((cortada.match(/<@&/g) || []).length === 15 && /…and 5 more/.test(cortada), '20 regras: mostra 15 e diz "…and 5 more"')
conf(cortada.length < 4096, 'e segue cabendo no embed', `${cortada.length} caracteres`)

// O texto de gente, por tipo.
const { comoGanhar } = await import('./lib/mensagens.js')
conf(comoGanhar({ tipo: 'ERC-20', minimo: 1000 }) === 'hold at least 1,000 tokens', 'token sem rótulo: "tokens", com separador de milhar')
conf(comoGanhar({ tipo: 'ERC-721', minimo: 1 }) === 'hold at least 1 NFTs', 'NFT sem rótulo: "NFTs"')
conf(comoGanhar({ tipo: 'ERC-721-ids', ids: [1, 2, 3], rotulo: 'Community 1/1s' }) === 'hold any one of the 3 Community 1/1s', 'o rótulo do admin manda também na posse de id')

console.log('\n  --- o que fica fixado no canal, visível a todos ---\n')
console.log('  ' + canal.embeds[0].title)
console.log(canal.embeds[0].description.split('\n').map((l) => '  ' + l).join('\n'))
console.log('  [ ' + canal.components[0].components[0].label + ' ]')

console.log(falhas ? `\n${falhas} FALHA(S)\n` : '\nTUDO OK\n')
process.exitCode = falhas ? 1 : 0
