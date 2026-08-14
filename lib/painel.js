/**
 * ============================================================================
 * O PAINEL — `/ronkelland`, a tela do admin
 * ============================================================================
 *
 * Uma mensagem efêmera com botões. O admin não digita subcomando nem cola ID de
 * cargo: o Discord desenha a janelinha de formulário, a lista de cargos e a
 * lista de canais, e o painel se redesenha a cada passo.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO EXISTE, DEPOIS DE EU TER ARGUMENTADO CONTRA
 * ---------------------------------------------------------------------------
 * O `regras.js` defende que regra deve morar em arquivo, e o motivo era bom: o
 * arquivo dá histórico. Só que o custo disso é que ninguém além de quem mexe no
 * repositório consegue criar uma regra — e num servidor de comunidade isso é
 * caro demais.
 *
 * O painel resolve o acesso e devolve o histórico por outro caminho: TODA
 * mudança é registrada com autor e hora, e o próprio painel mostra o registro.
 * O que se perde de verdade é a revisão ANTES de valer, e essa é a troca que o
 * dono do servidor escolheu conscientemente.
 *
 * ---------------------------------------------------------------------------
 * O QUE O PAINEL NÃO PODE FAZER
 * ---------------------------------------------------------------------------
 * Nada aqui amplia o alcance do bot. Ele continua só concedendo cargos abaixo
 * dele na hierarquia, continua recusando cargo com permissão perigosa
 * (`segurancacargo.js`) e continua sem tocar em cargo que não é dele. O painel
 * escolhe QUAL cargo dentro do que já era permitido — não abre porta nova.
 */
import { descreveContrato } from './prova.js'
import { chaveDaMedida, tipoDaRegra, validaRegras } from './regras.js'
import { explicaRecusa, podeGerir } from './segurancacargo.js'
import {
  anota,
  apagaRascunho,
  guardaRascunho,
  guardaRegras,
  historico,
  rascunhoDe,
  regrasGuardadas,
} from './estado.js'

/** Tipos de componente do Discord. */
export const COMP = {
  LINHA: 1,
  BOTAO: 2,
  LISTA: 3,
  TEXTO: 4,
  LISTA_CARGO: 6,
  LISTA_CANAL: 8,
}

/** Estilos de botão. 1 primário, 2 secundário, 4 vermelho. */
const ESTILO = { PRIMARIO: 1, SECUNDARIO: 2, PERIGO: 4 }

/** Tipos de resposta a interação. */
export const RESP = { MENSAGEM: 4, ATUALIZA: 7, JANELINHA: 9 }

const EFEMERA = 64
const VERDE = 0x7fd48a
const VERMELHO = 0xff9b9b

/** Prefixo de tudo que o painel manda e escuta. Ver `ehDoPainel`. */
export const PREFIXO = 'painel:'

export function ehDoPainel(id) {
  return String(id || '').startsWith(PREFIXO)
}

/* ==========================================================================
 * COMO UMA REGRA VIRA TEXTO
 * ========================================================================== */

function numero(n) {
  return Number(n).toLocaleString('en-US')
}

/** Uma linha legível pra cada regra. É o que o admin lê pra conferir. */
export function descreveRegra(r) {
  const tipo = tipoDaRegra(r)
  if (tipo === 'score') return `Ronke Score ${numero(r.minimo)}+`
  // "Top 69" e nao "69+": o numero aqui e uma posicao, e maior e pior.
  if (tipo === 'rank') return `Top ${numero(r.minimo)} by Ronke Score`
  if (tipo === 'ERC-721-ids') return `any of ${numero((r.ids || []).length)} specific tokens`
  const unidade = r.rotulo || (tipo === 'ERC-20' ? 'tokens' : 'NFTs')
  return `${numero(r.minimo)}+ ${unidade}`
}

/* ==========================================================================
 * A TELA
 * ========================================================================== */

/**
 * O painel em si.
 *
 * `aviso` aparece no topo quando o passo anterior tem algo a dizer — é o que
 * transforma "criei a regra" numa confirmação em vez de um painel que
 * simplesmente reaparece igual.
 */
export function tela(regras, { aviso, servidor } = {}) {
  const linhas = regras.length
    /*
     * O CARGO É MENCIONADO, NÃO ESCRITO.
     *
     * `r.nome` é uma fotografia do nome no dia do cadastro. O cabeçalho do
     * `regras.js` já dizia que nome muda — e é por isso que a LÓGICA usa o ID.
     * Mas o texto continuava imprimindo a foto, então quem renomeasse o cargo
     * via o painel repetir o nome antigo pra sempre, e concluía que a regra
     * apontava pro cargo errado.
     *
     * `<@&id>` o Discord resolve na hora de exibir, com o nome de agora e a cor
     * do cargo. Zero chamada de API, e não tem como envelhecer.
     *
     * `r.nome` continua guardado: ele é o que aparece no histórico e no log, onde
     * o certo é registrar como o cargo se chamava QUANDO a coisa aconteceu.
     */
    ? regras.map((r, i) => `\`${String(i + 1).padStart(2)}\`  <@&${r.cargo}> — ${descreveRegra(r)}`)
    : ['_No rules yet. Add one below._']

  const embed = {
    title: 'Ronkelland — setup',
    description: [
      aviso ? aviso + '\n' : '',
      `**Rules** (${regras.length})`,
      ...linhas,
      '',
      '_Members keep a role while they hold. Selling removes it on the next check._',
    ]
      .filter((l) => l !== null)
      .join('\n'),
    color: VERDE,
  }

  const botoes = [
    { type: COMP.BOTAO, style: ESTILO.PRIMARIO, label: 'Add rule', custom_id: PREFIXO + 'add' },
    {
      type: COMP.BOTAO,
      style: ESTILO.SECUNDARIO,
      label: 'Remove rule',
      custom_id: PREFIXO + 'rm',
      // Sem regra nenhuma não há o que remover. Botão que não faz nada é pior
      // que botão ausente: a pessoa clica e conclui que está quebrado.
      disabled: regras.length === 0,
    },
    {
      type: COMP.BOTAO,
      style: ESTILO.SECUNDARIO,
      label: 'Post verify message',
      custom_id: PREFIXO + 'postar',
    },
    { type: COMP.BOTAO, style: ESTILO.SECUNDARIO, label: 'History', custom_id: PREFIXO + 'hist' },
  ]

  return {
    embeds: [embed],
    components: [{ type: COMP.LINHA, components: botoes }],
    flags: EFEMERA,
  }
}

/**
 * QUAL TIPO DE REGRA — o passo que existe porque score não tem contrato.
 *
 * Dava pra ter dois botões no painel ("Add token rule", "Add score rule"), e
 * seria um clique a menos. Não faço: a linha de botões já tem quatro e o teto do
 * Discord é cinco, então o próximo tipo de regra não caberia. Um passo que
 * escala é melhor que um clique economizado numa ação que acontece cinco vezes
 * na vida do servidor.
 */
export function escolheTipo() {
  return {
    embeds: [
      {
        title: 'What should the rule check?',
        color: VERDE,
      },
    ],
    components: [
      {
        type: COMP.LINHA,
        components: [
          {
            type: COMP.LISTA,
            custom_id: PREFIXO + 'add:tipo',
            placeholder: 'Pick what to measure',
            options: [
              {
                label: 'Token or NFT holdings',
                description: 'How much of a contract they hold. Buyable today.',
                value: 'contrato',
              },
              {
                label: 'Ronke Score',
                description: 'Holding time, never-sold, collection breadth, 1/1s.',
                value: 'score',
              },
              /*
               * RANK E SCORE SAO A MESMA FONTE E PERGUNTAS DIFERENTES, e a
               * descricao precisa dizer isso em uma linha — senao o admin
               * escolhe no chute e descobre a diferenca meses depois.
               *
               * Um corte de pontos envelhece: 2.320 e "top 69" hoje e outra
               * coisa quando a pontuacao da comunidade inteira subir. Uma
               * posicao nao envelhece.
               */
              {
                label: 'Top rank',
                description: 'A fixed number of seats. Does not drift as scores rise.',
                value: 'rank',
              },
            ],
          },
        ],
      },
      {
        type: COMP.LINHA,
        components: [
          { type: COMP.BOTAO, style: ESTILO.SECUNDARIO, label: 'Cancel', custom_id: PREFIXO + 'voltar' },
        ],
      },
    ],
    flags: EFEMERA,
  }
}

/**
 * A RÉGUA DO SCORE, antes de pedir o número.
 *
 * "Minimum score" numa caixa vazia é um convite ao chute, e os dois chutes
 * possíveis matam o cargo: alto demais e ninguém alcança, baixo demais e todo
 * mundo tem. Mostrar quanto vale cada faixa HOJE transforma a pergunta em
 * escolha.
 */
export function telaDoScore(marcos) {
  const regua = marcos.length
    ? marcos.map((m) => `\`${String(m.score).padStart(5)}\`  → top ${numero(m.rank)}`).join('\n')
    : '_Could not read the ranking right now — pick a number and adjust later._'

  return {
    embeds: [
      {
        title: 'Ronke Score rule',
        description: [
          'This is the one role nobody can buy in a click. The score counts how long they have held, whether they ever sold, how much of the collection they cover, and 1/1s.',
          '',
          '**Where the cutoffs land today**',
          regua,
          '',
          '_The score is rebuilt once a day at 07:00 UTC, so a new buyer earns the role the next day._',
        ].join('\n'),
        color: VERDE,
      },
    ],
    components: [
      {
        type: COMP.LINHA,
        components: [
          { type: COMP.BOTAO, style: ESTILO.PRIMARIO, label: 'Set the score', custom_id: PREFIXO + 'add:score' },
          { type: COMP.BOTAO, style: ESTILO.SECUNDARIO, label: 'Cancel', custom_id: PREFIXO + 'voltar' },
        ],
      },
    ],
    flags: EFEMERA,
  }
}

/**
 * A RÉGUA, LIDA AO CONTRÁRIO.
 *
 * É a mesma tabela da tela do score — `4342 → top 10` —, só que aqui a coluna
 * que interessa é a da direita. Quem escolhe por posição quer saber quantas
 * cadeiras está abrindo, não quantos pontos custa.
 *
 * O texto diz o que o score NÃO diz: o número de cadeiras não muda sozinho.
 */
export function telaDoRank(marcos) {
  const regua = marcos.length
    ? marcos.map((m) => `\`top ${String(numero(m.rank)).padStart(5)}\`  → ${numero(m.score)} points today`).join('\n')
    : '_Could not read the ranking right now — pick a number and adjust later._'

  return {
    embeds: [
      {
        title: 'Top rank rule',
        description: [
          'A fixed number of seats. Whoever is inside the top N by Ronke Score has the role — and when someone passes them, they lose it.',
          '',
          '**Where the ranks sit today**',
          regua,
          '',
          '_Unlike a score cutoff, this does not drift as the community\'s scores rise._',
          '_The ranking is rebuilt once a day at 07:00 UTC._',
        ].join('\n'),
        color: VERDE,
      },
    ],
    components: [
      {
        type: COMP.LINHA,
        components: [
          { type: COMP.BOTAO, style: ESTILO.PRIMARIO, label: 'Set the rank', custom_id: PREFIXO + 'add:rank' },
          { type: COMP.BOTAO, style: ESTILO.SECUNDARIO, label: 'Cancel', custom_id: PREFIXO + 'voltar' },
        ],
      },
    ],
    flags: EFEMERA,
  }
}

/** A janelinha do rank: a POSIÇÃO, não a pontuação. */
export function janelinhaDeRank() {
  return {
    type: RESP.JANELINHA,
    data: {
      custom_id: PREFIXO + 'add:rank:janelinha',
      title: 'Top rank rule',
      components: [
        {
          type: COMP.LINHA,
          components: [
            {
              type: COMP.TEXTO,
              custom_id: 'minimo',
              // "How many seats" e nao "minimum rank": o admin esta escolhendo
              // um tamanho de grupo, e e assim que ele pensa nisso.
              label: 'How many seats (top N)',
              style: 1,
              placeholder: '69',
              max_length: 6,
              required: true,
            },
          ],
        },
      ],
    },
  }
}

/** A janelinha do score: um campo só, porque score não sai de contrato nenhum. */
export function janelinhaDeScore() {
  return {
    type: RESP.JANELINHA,
    data: {
      custom_id: PREFIXO + 'add:score:janelinha',
      title: 'Ronke Score rule',
      components: [
        {
          type: COMP.LINHA,
          components: [
            {
              type: COMP.TEXTO,
              custom_id: 'minimo',
              label: 'Minimum Ronke Score',
              style: 1,
              placeholder: '1200',
              max_length: 10,
              required: true,
            },
          ],
        },
      ],
    },
  }
}

/** A janelinha de cadastro. Só texto — o Discord não aceita lista de cargo aqui. */
export function janelinhaDeRegra() {
  return {
    type: RESP.JANELINHA,
    data: {
      custom_id: PREFIXO + 'add:janelinha',
      title: 'New rule',
      components: [
        {
          type: COMP.LINHA,
          components: [
            {
              type: COMP.TEXTO,
              custom_id: 'contrato',
              label: 'Contract address on Ronin',
              style: 1,
              placeholder: '0x810b6d1374ac7ba0e83612e7d49f49a13f1de019',
              min_length: 42,
              max_length: 42,
              required: true,
            },
          ],
        },
        {
          type: COMP.LINHA,
          components: [
            {
              type: COMP.TEXTO,
              custom_id: 'minimo',
              label: 'How many they must hold',
              style: 1,
              placeholder: '1',
              max_length: 20,
              required: true,
            },
          ],
        },
      ],
    },
  }
}

/**
 * A lista de cargos, depois da janelinha.
 *
 * ESTA LISTA É MONTADA AQUI, e não pelo seletor nativo de cargo do Discord.
 *
 * O nativo mostra TODOS os cargos do servidor — inclusive os que este bot não
 * consegue dar. Na Ronke Guild isso era 8 de 20: cargos de integração (Dyno,
 * Collab.Land, Server Booster), os que estão acima do cargo do bot, e os que
 * têm poder de moderação. A recusa só chegava DEPOIS do clique, então quem
 * configurava garimpava numa lista em que 40% das opções não serviam — sem
 * nenhuma marca dizendo quais.
 *
 * O nativo também ordena por nome, o que junta oito cargos "Ronke *" em
 * sequência e esconde os de baixo atrás da rolagem. Aqui a ordem é a MESMA das
 * Configurações do Servidor (mais alto primeiro), que é onde a pessoa acabou de
 * criar o cargo.
 *
 * Sem `cargos` (a chamada à API falhou), cai no seletor nativo: pior lista,
 * melhor que nenhuma.
 */
export function escolheCargo(resumo, cargos, posicaoDoBot) {
  const cancelar = {
    type: COMP.LINHA,
    components: [
      { type: COMP.BOTAO, style: ESTILO.SECUNDARIO, label: 'Cancel', custom_id: PREFIXO + 'voltar' },
    ],
  }

  if (!cargos) {
    return {
      embeds: [{ title: 'Which role?', description: resumo, color: VERDE }],
      components: [
        {
          type: COMP.LINHA,
          components: [
            {
              type: COMP.LISTA_CARGO,
              custom_id: PREFIXO + 'add:cargo',
              placeholder: 'Pick the role to grant',
              min_values: 1,
              max_values: 1,
            },
          ],
        },
        cancelar,
      ],
      flags: EFEMERA,
    }
  }

  const todos = cargos.filter((c) => c.position !== 0)
  const podem = todos.filter((c) => podeGerir(c, posicaoDoBot).pode).sort((a, b) => b.position - a.position)

  // Lista vazia é erro duro no Discord — e aqui ela tem uma causa que se
  // conserta arrastando um cargo, então vale dizer isso em vez de estourar.
  if (!podem.length) {
    return {
      embeds: [
        {
          title: 'I cannot grant any role here',
          description:
            `${resumo}\n\n` +
            'Every role in this server is either above mine, an integration role, or has moderation powers.\n\n' +
            '**Fix:** Server Settings → Roles, and drag my role above the ones I should grant.',
          color: VERMELHO,
        },
      ],
      components: [cancelar],
      flags: EFEMERA,
    }
  }

  const mostrados = podem.slice(0, 25)
  const notas = []

  // Nada de corte silencioso: se sobrou cargo de fora, a mensagem diz quantos.
  if (podem.length > mostrados.length) {
    notas.push(`Showing the ${mostrados.length} highest — ${podem.length - mostrados.length} more exist further down.`)
  }
  if (todos.length > podem.length) {
    notas.push(`${todos.length - podem.length} role${todos.length - podem.length > 1 ? 's are' : ' is'} not listed: ${porQueDeFora(todos, posicaoDoBot)}`)
  }

  return {
    embeds: [
      {
        title: 'Which role?',
        description: resumo + (notas.length ? '\n\n' + notas.join('\n') : ''),
        color: VERDE,
      },
    ],
    components: [
      {
        type: COMP.LINHA,
        components: [
          {
            type: COMP.LISTA,
            custom_id: PREFIXO + 'add:cargo',
            placeholder: 'Pick the role to grant',
            options: mostrados.map((c) => ({ label: c.name.slice(0, 100), value: c.id })),
          },
        ],
      },
      cancelar,
    ],
    flags: EFEMERA,
  }
}

/**
 * Por que os cargos de fora ficaram de fora, contados por motivo.
 *
 * A ordem importa: um cargo pode bater em vários motivos, e o que a pessoa
 * precisa ouvir é o que ela consegue resolver. "Arraste meu cargo pra cima" só
 * ajuda se depois disso o cargo passe — então quem tem poder de moderação é
 * contado antes, porque esse a gente recusa mesmo alcançando.
 */
function porQueDeFora(todos, posicaoDoBot) {
  let integracao = 0
  let poder = 0
  let acima = 0

  for (const c of todos) {
    const { pode, motivos } = podeGerir(c, posicaoDoBot)
    if (pode) continue
    if (c.managed) integracao++
    else if (motivos.some((m) => m.startsWith('tem permissao'))) poder++
    else acima++
  }

  const partes = []
  if (acima) partes.push(`${acima} sit${acima > 1 ? '' : 's'} above my role (Server Settings → Roles, drag mine up)`)
  if (poder) partes.push(`${poder} ${poder > 1 ? 'have' : 'has'} moderation powers — I refuse those on purpose`)
  if (integracao) {
    partes.push(
      integracao > 1
        ? `${integracao} are integration roles Discord lets nobody assign`
        : '1 is an integration role Discord lets nobody assign',
    )
  }
  return partes.join('; ') + '.'
}

/** A lista de regras, pra remover. */
/**
 * `nomeAgora` é um mapa `{ idDoCargo: nome }` lido do servidor na hora.
 *
 * Aqui não dá pra mencionar o cargo como no painel: rótulo de opção de lista é
 * texto puro, o Discord não resolve `<@&id>` dentro dele. Então o nome atual
 * precisa vir de uma chamada — e ela cabe, porque isto é caminho de admin e roda
 * cinco vezes na vida do servidor.
 *
 * Sem o mapa, cai no `r.nome` guardado. Nome velho numa lista de REMOÇÃO é o
 * pior lugar pra ele estar: a pessoa apaga achando que é outro cargo.
 */
export function escolheParaRemover(regras, nomeAgora) {
  return {
    embeds: [{ title: 'Remove which rule?', description: 'The role stays until the next check.', color: VERDE }],
    components: [
      {
        type: COMP.LINHA,
        components: [
          {
            type: COMP.LISTA,
            custom_id: PREFIXO + 'rm:qual',
            placeholder: 'Pick a rule',
            options: regras.slice(0, 25).map((r, i) => ({
              label: String(nomeAgora?.[String(r.cargo)] ?? r.nome).slice(0, 100),
              description: descreveRegra(r).slice(0, 100),
              value: String(i),
            })),
          },
        ],
      },
      {
        type: COMP.LINHA,
        components: [
          { type: COMP.BOTAO, style: ESTILO.SECUNDARIO, label: 'Cancel', custom_id: PREFIXO + 'voltar' },
        ],
      },
    ],
    flags: EFEMERA,
  }
}

/** A lista de canais, pra publicar a mensagem do botão. */
export function escolheCanal() {
  return {
    embeds: [
      {
        title: 'Where should the verify message go?',
        description: 'I post it and pin it. Running this again edits that message instead of posting a second one.',
        color: VERDE,
      },
    ],
    components: [
      {
        type: COMP.LINHA,
        components: [
          {
            type: COMP.LISTA_CANAL,
            custom_id: PREFIXO + 'postar:canal',
            placeholder: 'Pick a channel',
            channel_types: [0], // só texto
            min_values: 1,
            max_values: 1,
          },
        ],
      },
      {
        type: COMP.LINHA,
        components: [
          { type: COMP.BOTAO, style: ESTILO.SECUNDARIO, label: 'Cancel', custom_id: PREFIXO + 'voltar' },
        ],
      },
    ],
    flags: EFEMERA,
  }
}

/** O registro de mudanças. */
export function telaDoHistorico(entradas) {
  const linhas = entradas.length
    ? entradas.map((e) => {
        const quando = new Date(e.quando).toISOString().slice(0, 16).replace('T', ' ')
        return `\`${quando}\`  <@${e.quem}>  ${e.acao} — ${e.detalhe}`
      })
    : ['_Nothing changed yet._']

  return {
    embeds: [{ title: 'Rule history', description: linhas.join('\n').slice(0, 4000), color: VERDE }],
    components: [
      {
        type: COMP.LINHA,
        components: [
          { type: COMP.BOTAO, style: ESTILO.SECUNDARIO, label: 'Back', custom_id: PREFIXO + 'voltar' },
        ],
      },
    ],
    flags: EFEMERA,
  }
}

/* ==========================================================================
 * AS DECISÕES
 * ========================================================================== */

/**
 * O cargo pode ser gerido?
 *
 * A TRAVA JÁ EXISTIA — em `segurancacargo.js`, escrita pra quando as regras
 * vinham só do arquivo. Ela vale mais agora: no arquivo, escolher um cargo de
 * moderação exigia colar o ID dele de propósito; no painel, basta um clique
 * errado numa lista onde "Moderator" está três linhas abaixo de "Ronke Holder".
 *
 * Reaproveitar em vez de reescrever também garante que as duas portas — arquivo
 * e painel — recusem exatamente as mesmas coisas. Duas listas de permissões
 * perigosas seriam duas listas pra manter, e uma delas ficaria pra trás.
 */
export function podeUsarCargo(cargo, posicaoDoBot) {
  if (!cargo) return { ok: false, porque: 'I cannot see that role.' }
  const { pode, motivos } = podeGerir(cargo, posicaoDoBot)
  if (pode) return { ok: true }
  return { ok: false, porque: explicaRecusa(cargo, motivos) }
}

/**
 * Monta a regra a partir do rascunho e do que a cadeia diz do contrato.
 *
 * O TIPO NÃO É PERGUNTADO, é descoberto. Perguntar "é ERC-20 ou ERC-721?" seria
 * transferir pro admin uma dúvida que a cadeia responde sozinha — e a resposta
 * errada faz um mínimo de 1000 ser satisfeito por qualquer poeira, porque token
 * responde em wei e NFT responde em unidades.
 */
export async function montaRegra(rascunho, cargo) {
  /*
   * O CAMINHO DO SCORE NÃO TOCA A CADEIA. Não há contrato pra descrever: a
   * medida vem da API de analytics, e o único número é o corte. Por isso ele sai
   * antes — e de graça, sem os 0,5 s da consulta.
   */
  if (rascunho.tipo === 'score' || rascunho.tipo === 'rank') {
    return {
      ok: true,
      regra: {
        nome: cargo.name,
        cargo: String(cargo.id),
        tipo: rascunho.tipo,
        minimo: rascunho.minimo,
      },
      descricao:
        rascunho.tipo === 'rank'
          ? `top ${numero(rascunho.minimo)} by Ronke Score`
          : `Ronke Score ${numero(rascunho.minimo)} or higher`,
    }
  }

  const d = await descreveContrato(rascunho.contrato)
  if (!d.ok) return { ok: false, porque: d.erro }

  const nome = cargo.name
  const rotulo = d.simbolo || d.nome || null

  return {
    ok: true,
    regra: {
      nome,
      cargo: String(cargo.id),
      tipo: d.ehNft ? 'ERC-721' : 'ERC-20',
      contrato: rascunho.contrato.toLowerCase(),
      casas: d.ehNft ? 0 : 18,
      minimo: rascunho.minimo,
      rotulo: rotulo ? (d.ehNft ? rotulo + ' NFTs' : '$' + rotulo) : undefined,
    },
    descricao: `${d.nome || 'contract'}${d.simbolo ? ` (${d.simbolo})` : ''}, ${d.ehNft ? 'NFT collection' : 'token'}`,
  }
}

/**
 * Guarda a lista nova, se ela for válida.
 *
 * A validação roda ANTES de salvar, sempre. Salvar uma lista quebrada faria a
 * varredura parar de subir — e o painel teria transformado um clique num bot
 * fora do ar.
 */
export async function salva(regras, quem, acao, detalhe) {
  const erros = validaRegras(regras)
  if (erros.length) return { ok: false, porque: erros[0] }
  await guardaRegras(regras)
  await anota(quem, acao, detalhe)
  return { ok: true }
}

/** Repetida? O par medida+cargo é o que não pode existir duas vezes. */
export function jaExiste(regras, nova) {
  const chave = `${chaveDaMedida(nova)}|${nova.cargo}`
  return regras.some((r) => `${chaveDaMedida(r)}|${r.cargo}` === chave)
}

export { historico, rascunhoDe, guardaRascunho, apagaRascunho, regrasGuardadas }
