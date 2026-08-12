/**
 * PROVA DO PAINEL — a tela do admin.
 *
 *   node teste_painel.js
 *
 * O painel é a porta pela qual alguém pode, com um clique errado, mandar o bot
 * distribuir moderação do servidor. Metade destes testes é sobre RECUSAR.
 */
import {
  descreveRegra,
  escolheCanal,
  escolheCargo,
  escolheParaRemover,
  janelinhaDeRegra,
  jaExiste,
  podeUsarCargo,
  tela,
  telaDoHistorico,
  COMP,
  RESP,
} from './lib/painel.js'
import { ehDoPainel } from './lib/painel.js'

let falhas = 0
const conf = (c, m, e = '') => {
  if (!c) {
    falhas++
    console.error('  FALHOU  ' + m + '  ' + e)
  } else console.log('  ok      ' + m + (e ? '  ' + e : ''))
}

const NFT = '0x810b6d1374ac7ba0e83612e7d49f49a13f1de019'
const TOK = '0xf988f63bf26c3ed3fbf39922149e3e7b1e5c27cb'
const REGRAS = [
  { nome: 'Ronke Holder', cargo: '111111111111111111', tipo: 'ERC-20', contrato: TOK, casas: 18, minimo: 1, rotulo: '$RONKE' },
  { nome: 'Ronkeverse', cargo: '222222222222222222', tipo: 'ERC-721', contrato: NFT, casas: 0, minimo: 10 },
  { nome: 'Ronke Lord', cargo: '333333333333333333', tipo: 'ERC-721-ids', contrato: NFT, ids: [14, 24, 777] },
  { nome: 'Ronke Sage', cargo: '444444444444444444', tipo: 'score', minimo: 1200 },
]

console.log('\nO PAINEL: COMO A TELA FICA\n')

const t = tela(REGRAS)
const texto = t.embeds[0].description
conf(t.flags === 64, 'o painel é efêmero — só o admin que abriu enxerga')
conf(REGRAS.every((r) => texto.includes(r.nome)), 'todas as regras aparecem na tela')
conf(texto.includes('1,000') === false && texto.includes('10+'), 'quantidade legível', descreveRegra(REGRAS[1]))
conf(descreveRegra(REGRAS[0]) === '1+ $RONKE', 'usa o símbolo do token quando a cadeia deu um', descreveRegra(REGRAS[0]))
conf(descreveRegra(REGRAS[2]) === 'any of 3 specific tokens', 'posse-de-id diz QUANTOS tokens, não "mínimo 3"', descreveRegra(REGRAS[2]))
conf(descreveRegra(REGRAS[3]) === 'Ronke Score 1,200+', 'score aparece como score', descreveRegra(REGRAS[3]))

const vazio = tela([])
const btRemover = vazio.components[0].components.find((b) => b.custom_id.endsWith('rm'))
conf(btRemover.disabled === true, 'sem regra nenhuma, o botão de remover vem desligado')
conf(tela(REGRAS).components[0].components.find((b) => b.custom_id.endsWith('rm')).disabled === false, 'com regra, ele liga')

const comAviso = tela(REGRAS, { aviso: 'Added **Ronke Sage**.' })
conf(comAviso.embeds[0].description.startsWith('Added'), 'o aviso do passo anterior vem no topo')

/* ------------------------------------------------- as telas de cada passo */
console.log('\nOS PASSOS\n')

const j = janelinhaDeRegra()
conf(j.type === RESP.JANELINHA, 'o botão "Add rule" abre uma janelinha de verdade')
const campos = j.data.components.flatMap((l) => l.components).map((c) => c.custom_id)
conf(campos.join() === 'contrato,minimo', 'a janelinha pede contrato e mínimo', campos.join())
conf(
  j.data.components.every((l) => l.components.every((c) => c.type === COMP.TEXTO)),
  'só campos de texto — o Discord não aceita lista de cargo dentro de janelinha',
)

const ec = escolheCargo('teste')
conf(ec.components[0].components[0].type === COMP.LISTA_CARGO, 'o cargo vem de uma LISTA, ninguém cola ID')
conf(ec.flags === 64, 'e a escolha do cargo também é só do admin')

const ecanal = escolheCanal()
conf(ecanal.components[0].components[0].type === COMP.LISTA_CANAL, 'o canal também vem de lista')
conf(
  ecanal.components[0].components[0].channel_types.join() === '0',
  'e só oferece canal de TEXTO — publicar num canal de voz não existe',
)

const er = escolheParaRemover(REGRAS)
conf(er.components[0].components[0].options.length === 4, 'a remoção lista as 4 regras')
conf(
  er.components[0].components[0].options.every((o) => o.label && o.description),
  'cada uma com nome e o que ela exige',
)

/*
 * O TETO DE 25 DO DISCORD. Uma lista com 26 opções é recusada pela API, e o
 * sintoma seria o botão "Remove rule" simplesmente não abrir nada.
 */
const muitas = Array.from({ length: 40 }, (_, i) => ({ nome: `R${i}`, cargo: '1', tipo: 'score', minimo: i + 1 }))
conf(escolheParaRemover(muitas).components[0].components[0].options.length === 25, '40 regras viram 25 opções, o teto do Discord')

conf(telaDoHistorico([]).embeds[0].description.includes('Nothing changed'), 'histórico vazio diz que está vazio')
const h = telaDoHistorico([{ quando: 1786500000000, quem: '999', acao: 'added', detalhe: 'Ronke Sage' }])
conf(h.embeds[0].description.includes('<@999>'), 'o histórico diz QUEM mudou')

conf(ehDoPainel('painel:add') && !ehDoPainel('verificar'), 'o painel só responde pelo que é dele')

/* ==========================================================================
 * A PARTE QUE IMPORTA: O QUE O PAINEL RECUSA
 * ========================================================================== */
console.log('\nO QUE O PAINEL RECUSA\n')

const POS_BOT = 15
const cargo = (extra) => ({ id: '5', name: 'Cargo', position: 5, permissions: '0', managed: false, ...extra })

conf(podeUsarCargo(cargo(), POS_BOT).ok, 'cargo comum abaixo do bot: liberado')
conf(!podeUsarCargo(null, POS_BOT).ok, 'cargo que o bot não enxerga: recusado')
conf(!podeUsarCargo(cargo({ position: 15 }), POS_BOT).ok, 'cargo na MESMA posição do bot: recusado')
conf(!podeUsarCargo(cargo({ position: 20 }), POS_BOT).ok, 'cargo acima do bot: recusado')
conf(!podeUsarCargo(cargo({ managed: true }), POS_BOT).ok, 'cargo de outro bot: recusado')
conf(!podeUsarCargo(cargo({ position: 0 }), POS_BOT).ok, '@everyone: recusado')

/*
 * AS PERMISSÕES PERIGOSAS, UMA A UMA.
 *
 * É o clique errado mais provável do painel: "Moderator" está três linhas abaixo
 * de "Ronke Holder" na mesma lista. Se qualquer uma destas passar, comprar um
 * token vira virar moderador — e num caso, dono do servidor.
 *
 * MODERATE_MEMBERS é bit 40: em Number ele seria truncado e a trava aprovaria
 * justamente o cargo perigoso. Por isso a conta é toda em BigInt.
 */
for (const [nome, bit] of [
  ['ADMINISTRATOR', 1n << 3n],
  ['KICK_MEMBERS', 1n << 1n],
  ['BAN_MEMBERS', 1n << 2n],
  ['MANAGE_CHANNELS', 1n << 4n],
  ['MANAGE_GUILD', 1n << 5n],
  ['MANAGE_MESSAGES', 1n << 13n],
  ['MANAGE_ROLES', 1n << 28n],
  ['MANAGE_WEBHOOKS', 1n << 29n],
  ['MODERATE_MEMBERS', 1n << 40n],
]) {
  const r = podeUsarCargo(cargo({ permissions: String(bit) }), POS_BOT)
  conf(!r.ok, `cargo com ${nome}: recusado`)
}

conf(
  !podeUsarCargo(cargo({ permissions: String((1n << 40n) | (1n << 11n)) }), POS_BOT).ok,
  'permissão perigosa misturada com inofensiva ainda é recusada',
)

/* ---------------------------------------------------------- regra repetida */
const nova = { nome: 'X', cargo: '222222222222222222', tipo: 'ERC-721', contrato: NFT, casas: 0, minimo: 10 }
conf(jaExiste(REGRAS, nova), 'mesma medida e mesmo cargo: é repetida')
conf(!jaExiste(REGRAS, { ...nova, cargo: '777777777777777777' }), 'mesmo contrato, cargo diferente: é legítima')
conf(!jaExiste(REGRAS, { ...nova, contrato: TOK, tipo: 'ERC-20' }), 'mesmo cargo, contrato diferente: é legítima')

console.log(falhas ? `\n${falhas} FALHA(S)\n` : '\nTUDO OK\n')
process.exitCode = falhas ? 1 : 0
