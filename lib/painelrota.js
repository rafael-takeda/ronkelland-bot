/**
 * ============================================================================
 * O PAINEL, LIGADO — do clique à tela seguinte
 * ============================================================================
 *
 * O `painel.js` só desenha; aqui é onde cada clique vira ação. A separação
 * existe porque desenhar é testável sem rede nenhuma, e agir não é.
 *
 * ---------------------------------------------------------------------------
 * TRÊS SEGUNDOS, DE NOVO
 * ---------------------------------------------------------------------------
 * O passo mais caro é o que cadastra a regra: ele pergunta à cadeia o que é o
 * contrato (~0,5 s, depois de as quatro perguntas passarem a ser feitas em
 * paralelo) e ao Discord onde o bot está na hierarquia (~0,2 s). Cabe, mas não
 * há espaço pra acrescentar chamada sem medir de novo.
 *
 * ---------------------------------------------------------------------------
 * A PERMISSÃO É CONFERIDA AQUI TAMBÉM
 * ---------------------------------------------------------------------------
 * O `default_member_permissions` do comando já faz o Discord esconder e recusar
 * pra quem não é admin. Mesmo assim eu confiro de novo: aquilo é configurável
 * pelo dono do servidor (Integrações), e um clique num botão de painel não passa
 * pela mesma checagem que o comando. Uma linha aqui fecha o buraco.
 */
import { cargosDoServidor, postaNoCanal, posicaoDoBot } from './discord.js'
import { mensagemDoCanal } from './resposta.js'
import { validaRegras } from './regras.js'
import {
  apagaRascunho,
  escolheCanal,
  escolheCargo,
  escolheParaRemover,
  escolheTipo,
  guardaRascunho,
  historico,
  jaExiste,
  janelinhaDeRank,
  janelinhaDeRegra,
  janelinhaDeScore,
  montaRegra,
  telaDoRank,
  telaDoScore,
  podeUsarCargo,
  PREFIXO,
  rascunhoDe,
  regrasGuardadas,
  RESP,
  salva,
  tela,
  telaDoHistorico,
  descreveRegra,
} from './painel.js'
import { marcosDeCorte } from './score.js'
import { readFileSync } from 'node:fs'

export { ehDoPainel } from './painel.js'

const EFEMERA = 64
const MANAGE_GUILD = 1n << 5n

/**
 * As regras que valem AGORA: as do painel, ou o arquivo se ele nunca mexeu.
 *
 * ESTA LEITURA DE DISCO TEM UMA PEGADINHA DE HOSPEDAGEM. O empacotador da Vercel
 * inclui na função só o que ele consegue rastrear por `import` — e isto aqui é
 * `readFileSync`, que ele pode não seguir. Por isso o `vercel.json` declara
 * `includeFiles: "regras.json"`.
 *
 * Sem aquela linha, o arquivo some do pacote, o `catch` devolve lista vazia e o
 * painel abre dizendo "nenhuma regra" com cinco configuradas. Nada estoura, e é
 * isso que torna o erro ruim: ele mente na direção que parece plausível.
 */
export async function regrasEmUso() {
  const doPainel = await regrasGuardadas().catch(() => null)
  if (doPainel) return doPainel
  try {
    return JSON.parse(readFileSync(new URL('../regras.json', import.meta.url), 'utf8')).regras
  } catch {
    return []
  }
}

/**
 * Um campo da janelinha.
 *
 * O Discord entrega os campos aninhados em linhas, e SEMPRE como texto — não
 * existe campo numérico em janelinha. Por isso todo número que sai daqui passa
 * por `Number.isInteger` antes de virar regra: "1.5", "mil" e "-3" chegam iguais
 * a "1200", e um NaN guardado como mínimo faz a regra nunca conceder nada, em
 * silêncio. Que foi exatamente o bug do Ronke Lord.
 */
function campoDaJanelinha(corpo, nome) {
  for (const linha of corpo.data?.components || []) {
    for (const c of linha.components || []) {
      if (c.custom_id === nome) return String(c.value || '').trim()
    }
  }
  return ''
}

const so = (texto) => ({ type: RESP.MENSAGEM, data: { content: texto, flags: EFEMERA } })
const mostra = (corpo) => ({ type: RESP.ATUALIZA, data: corpo })
const abre = (corpo) => ({ type: RESP.MENSAGEM, data: corpo })

/** O painel, do zero. `novo` decide entre abrir mensagem e redesenhar a atual. */
async function painelAtual(aviso, novo) {
  const regras = await regrasEmUso()
  const corpo = tela(regras, { aviso })
  return novo ? abre(corpo) : mostra(corpo)
}

export async function respondePainel(corpo, membro) {
  const id = corpo.data?.custom_id || ''
  const acao = id.slice(PREFIXO.length)
  const servidor = corpo.guild_id

  if (!servidor) return { resposta: so('This only works inside the server.') }

  /*
   * A CONFERÊNCIA DE ADMIN. `member.permissions` é o que a pessoa PODE de fato
   * naquele canal, já resolvido pelo Discord — não é a lista de cargos dela.
   */
  const podeMexer = (BigInt(corpo.member?.permissions || '0') & MANAGE_GUILD) === MANAGE_GUILD
  if (!podeMexer) {
    return { resposta: so('You need the **Manage Server** permission to set this up.') }
  }

  // ---------------------------------------------------------- abrir o painel
  if (corpo.type === 2 /* comando */) {
    return { resposta: await painelAtual(null, true), log: { acao: 'abriu o painel', membro } }
  }

  if (acao === 'voltar') return { resposta: await painelAtual(null, false) }

  // ------------------------------------------------------------- nova regra
  if (acao === 'add') return { resposta: mostra(escolheTipo()) }

  if (acao === 'add:tipo') {
    const tipo = corpo.data?.values?.[0]
    // Contrato vai direto pra janelinha: os campos se explicam sozinhos.
    if (tipo === 'contrato') return { resposta: janelinhaDeRegra() }
    /*
     * Score e rank passam por uma tela antes, com a régua do dia. Um campo vazio
     * não diz se 500 é muito ou pouco, e o chute erra pros dois lados: cargo
     * inalcançável ou cargo que todo mundo tem.
     *
     * É a MESMA régua nas duas telas, lida em sentidos opostos — uma chamada só,
     * e o admin vê a equivalência que vai precisar pra escolher entre elas.
     */
    const marcos = await marcosDeCorte()
    return { resposta: mostra(tipo === 'rank' ? telaDoRank(marcos) : telaDoScore(marcos)) }
  }

  if (acao === 'add:score') return { resposta: janelinhaDeScore() }

  if (acao === 'add:rank') return { resposta: janelinhaDeRank() }

  if (acao === 'add:rank:janelinha') {
    const minimo = Number(campoDaJanelinha(corpo, 'minimo'))
    if (!Number.isInteger(minimo) || minimo < 1) {
      return { resposta: so('The number of seats has to be a whole number, 1 or more.') }
    }
    await guardaRascunho(membro, { tipo: 'rank', minimo })
    return {
      resposta: abre(escolheCargo(`Top **${minimo.toLocaleString('en-US')}** by Ronke Score`)),
    }
  }

  if (acao === 'add:score:janelinha') {
    const bruto = campoDaJanelinha(corpo, 'minimo')
    const minimo = Number(bruto)
    if (!Number.isInteger(minimo) || minimo < 1) {
      return { resposta: so('The score has to be a whole number, 1 or more.') }
    }
    await guardaRascunho(membro, { tipo: 'score', minimo })
    return {
      resposta: abre(escolheCargo(`Ronke Score **${minimo.toLocaleString('en-US')}** or higher`)),
    }
  }

  if (acao === 'add:janelinha') {
    const contrato = campoDaJanelinha(corpo, 'contrato')

    if (!/^0x[0-9a-fA-F]{40}$/.test(contrato)) {
      return { resposta: so('That contract address does not look right. It should be `0x` plus 40 characters.') }
    }
    /*
     * O MÍNIMO PRECISA SER INTEIRO E POSITIVO, e a janelinha do Discord não tem
     * campo numérico — o que chega é texto. "1.5", "mil" e "-3" todos chegariam
     * aqui, e um `NaN` guardado como mínimo faz a regra nunca conceder nada, em
     * silêncio. Que é exatamente o bug que o Ronke Lord teve.
     */
    const minimo = Number(campoDaJanelinha(corpo, 'minimo'))
    if (!Number.isInteger(minimo) || minimo < 1) {
      return { resposta: so('The minimum has to be a whole number, 1 or more.') }
    }

    await guardaRascunho(membro, { tipo: 'contrato', contrato, minimo })
    return {
      resposta: abre(escolheCargo(`\`${contrato}\`\nMinimum: **${minimo.toLocaleString('en-US')}**`)),
    }
  }

  if (acao === 'add:cargo') {
    const rascunho = await rascunhoDe(membro)
    if (!rascunho) return { resposta: so('That took too long — start again with `/ronkelland`.') }

    const idCargo = corpo.data?.values?.[0]
    // O Discord manda o cargo inteiro junto do clique. Sem isso seria mais uma
    // ida à API dentro dos 3 segundos.
    const cargo = corpo.data?.resolved?.roles?.[idCargo]

    const [posicao, regras] = await Promise.all([
      posicaoDoBot(servidor, corpo.application_id),
      regrasEmUso(),
    ])

    const permitido = podeUsarCargo(cargo, posicao)
    if (!permitido.ok) return { resposta: so(permitido.porque) }

    const montada = await montaRegra(rascunho, cargo)
    if (!montada.ok) return { resposta: so(montada.porque) }

    if (jaExiste(regras, montada.regra)) {
      return { resposta: so(`There is already a rule granting **${cargo.name}** for that contract.`) }
    }

    const nova = [...regras, montada.regra]
    const gravou = await salva(nova, membro, 'added', `${cargo.name} — ${descreveRegra(montada.regra)}`)
    if (!gravou.ok) return { resposta: so(`I could not save that: ${gravou.porque}`) }

    await apagaRascunho(membro)
    return {
      resposta: await painelAtual(`Added **${cargo.name}** — ${montada.descricao}.`, false),
      log: { acao: 'criou regra', membro, endereco: montada.regra.contrato },
    }
  }

  // ------------------------------------------------------------ tirar regra
  if (acao === 'rm') {
    return { resposta: mostra(escolheParaRemover(await regrasEmUso())) }
  }

  if (acao === 'rm:qual') {
    const regras = await regrasEmUso()
    const i = Number(corpo.data?.values?.[0])
    if (!Number.isInteger(i) || i < 0 || i >= regras.length) {
      return { resposta: await painelAtual('That rule is gone already.', false) }
    }
    const fora = regras[i]
    const restantes = regras.filter((_, j) => j !== i)

    /*
     * LISTA VAZIA É PERMITIDA AQUI, e o `validaRegras` recusaria.
     *
     * Tirar a última regra é escolha legítima do dono do servidor. O efeito não
     * é o que se imagina: sem regra, `cargosGeridos` fica vazio, então a
     * revarredura não tira NADA de ninguém — os cargos congelam como estão.
     *
     * É o comportamento certo. "Parei de gatear" não pode significar "arranquei
     * o cargo de todo mundo de uma vez".
     */
    const erros = restantes.length ? validaRegras(restantes) : []
    if (erros.length) return { resposta: so(`I could not save that: ${erros[0]}`) }

    const gravou = await salva(restantes.length ? restantes : [], membro, 'removed', fora.nome)
    if (!gravou.ok && restantes.length) return { resposta: so(`I could not save that: ${gravou.porque}`) }

    return {
      resposta: await painelAtual(
        `Removed **${fora.nome}**. Members keep it until the next check.`,
        false,
      ),
      log: { acao: 'apagou regra', membro },
    }
  }

  // ------------------------------------------------- publicar a mensagem fixa
  if (acao === 'postar') return { resposta: mostra(escolheCanal()) }

  if (acao === 'postar:canal') {
    const canal = corpo.data?.values?.[0]
    try {
      await postaNoCanal(canal, mensagemDoCanal())
    } catch (e) {
      return {
        resposta: so(
          `I could not post there. Check that I have **Send Messages** and **Embed Links** in <#${canal}>.\n\`${String(e.message).slice(0, 140)}\``,
        ),
      }
    }
    return {
      resposta: await painelAtual(`Posted the verify message in <#${canal}>.`, false),
      log: { acao: 'publicou mensagem', membro },
    }
  }

  // ---------------------------------------------------------------- registro
  if (acao === 'hist') {
    return { resposta: mostra(telaDoHistorico(await historico(10))) }
  }

  return { resposta: so('I do not know that button.') }
}
