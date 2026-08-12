/**
 * ============================================================================
 * PROVA DE POSSE SEM CONECTAR CARTEIRA
 * ============================================================================
 *
 * O jeito padrão de verificar holder é: página, conectar carteira, assinar
 * mensagem. Funciona, e cria o problema que a gente passou a semana combatendo —
 * mais um lugar pedindo conexão de carteira, num servidor cuja regra fixada é
 * "nunca conecte, nunca clique em link". A página vira molde de clone, e o
 * membro perde a única defesa que tinha: não existir exceção.
 *
 * Aqui a prova é outra, e não tem página nenhuma:
 *
 *     O bot dá um endereço único pra cada pessoa.
 *     Ela manda uma transação de 0 RON daquela carteira pra aquele endereço.
 *     Só quem controla a carteira consegue fazer isso.
 *
 * Sem página, sem link, sem assinatura, sem nonce, sem replay. O custo é o gas
 * (centavos na Ronin) e a fricção de uma transação manual, uma vez por pessoa.
 *
 * ---------------------------------------------------------------------------
 * NENHUMA CHAVE PRIVADA EXISTE NESTE SISTEMA
 * ---------------------------------------------------------------------------
 * O endereço de destino é derivado de `hash(id do Discord + segredo)` e NINGUÉM
 * o controla — nem o bot. Isso é de propósito: o valor enviado é ZERO, então não
 * há nada pra resgatar, e não haver chave é não haver chave pra vazar.
 *
 * O segredo serve só pra que ninguém consiga calcular de fora o endereço de
 * outra pessoa e mandar a transação no lugar dela.
 *
 * ---------------------------------------------------------------------------
 * POR QUE A VARREDURA É SÓ SOB DEMANDA
 * ---------------------------------------------------------------------------
 * Transferência nativa NÃO emite log, então `eth_getLogs` não enxerga — a única
 * forma de ver é abrir cada bloco e olhar o `to` de cada transação. Medido no
 * RPC público: 426 ms por bloco, 5 transações por bloco.
 *
 * Isso seria caro se rodasse sempre, e não roda: verificação é evento raro (uma
 * vez por pessoa, numa comunidade de algumas centenas). Sem ninguém esperando,
 * a varredura nem começa. Com alguém esperando, são ~43 s por janela de 5 min —
 * folgado dentro de uma execução do GitHub Actions.
 */
import { createHash } from 'node:crypto'

const RPC = process.env.RONIN_RPC || 'https://api.roninchain.com/rpc'

/** O contrato cuja posse se prova. */
export const COLECAO =
  (process.env.CONTRATO || '0x810B6d1374ac7BA0E83612E7d49F49A13f1de019').toLowerCase()

/**
 * 429 NÃO É ERRO, É "MAIS DEVAGAR".
 *
 * O RPC público limita a taxa, e a varredura é o cliente mais faminto que
 * existe: transferência nativa não emite log, então achar uma exige ABRIR bloco
 * por bloco. Com gente na fila isso são dezenas de chamadas por minuto, sem
 * parar — mais cedo ou mais tarde ele diz não.
 *
 * Antes, esse "não" virava exceção que ninguém pegava e matava a varredura
 * inteira. Aconteceu em produção: o processo morreu com uma pessoa ainda na
 * fila, e ela ficou sem cargo até a execução seguinte. Pior, o aviso de
 * confirmação viaja num token que vale 15 minutos — uma varredura morta é um
 * aviso que nunca chega.
 *
 * Então 429 e 5xx viram espera e nova tentativa. `Retry-After`, quando vem, é
 * obedecido: adivinhar um tempo menor que o pedido é como insistir na porta.
 */
const TENTATIVAS = 4

async function rpc(method, params) {
  let ultimoErro
  for (let tentativa = 0; tentativa < TENTATIVAS; tentativa++) {
    let r
    try {
      r = await fetch(RPC, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // O RPC público devolve 403 pro User-Agent padrão de biblioteca.
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(20_000),
      })
    } catch (e) {
      // Rede caiu ou estourou o tempo. Vale a mesma paciência do 429.
      ultimoErro = new Error(`RPC ${method}: ${e.message}`)
      await espera(tentativa)
      continue
    }

    if (r.ok) {
      const d = await r.json()
      /*
       * Erro DENTRO do JSON-RPC é resposta, não falha de transporte: "execution
       * reverted" é o contrato dizendo não. Repetir não muda a resposta, e quem
       * chama já sabe interpretar (ver `saldoNoContrato`).
       */
      if (d.error) throw new Error(`RPC ${method}: ${d.error.message}`)
      return d.result
    }

    // 429 e 5xx passam; o resto é erro nosso e repetir não conserta.
    if (r.status !== 429 && r.status < 500) {
      throw new Error(`RPC ${method}: HTTP ${r.status}`)
    }

    ultimoErro = new Error(`RPC ${method}: HTTP ${r.status}`)
    const pedido = Number(r.headers.get('retry-after'))
    await espera(tentativa, Number.isFinite(pedido) && pedido > 0 ? pedido * 1000 : null)
  }
  throw ultimoErro
}

/**
 * 400ms, 800ms, 1,6s, 3,2s — ou o que o servidor pediu, se pediu.
 *
 * O TETO ERA 10 SEGUNDOS, E ERA CURTO DEMAIS. Medido no RPC publico da Ronin:
 * ele publica `x-ratelimit-limit-minute: 100` e, ao estourar, responde 429 com
 * `retry-after: 15`. Cortando em 10, a espera terminava antes da janela abrir e
 * a tentativa seguinte levava 429 de novo — as quatro tentativas queimavam sem
 * nunca esperar o suficiente.
 *
 * O teto existe contra um valor absurdo vindo de fora, nao contra o valor certo.
 * Sessenta segundos e alto o bastante pra caber qualquer pedido legitimo e baixo
 * o bastante pra nao travar a varredura.
 */
function espera(tentativa, pedido) {
  const ms = pedido ?? 400 * 2 ** tentativa
  return new Promise((f) => setTimeout(f, Math.min(ms, 60_000)))
}

/**
 * O endereço que UMA pessoa tem que pagar. Determinístico e sem dono.
 *
 * `hash(id + segredo)` truncado em 20 bytes. Duas propriedades importantes:
 *
 *   Sem o segredo, ninguém calcula o endereço de outra pessoa — o que impede
 *   alguém mandar a transação no lugar de um terceiro e sequestrar a
 *   verificação dele.
 *
 *   Com o segredo, o bot recalcula o mesmo endereço a qualquer momento, sem
 *   guardar nada. Se o banco de dados sumir, o endereço de cada um continua
 *   sendo o mesmo.
 */
export function enderecoDe(idDiscord, segredo = process.env.SEGREDO || '') {
  if (!segredo) throw new Error('SEGREDO não configurado — sem ele qualquer um forja o endereço de qualquer um')
  const h = createHash('sha256').update(`${idDiscord}:${segredo}`).digest('hex')
  return '0x' + h.slice(0, 40)
}

/**
 * Procura, numa faixa de blocos, alguma transação destinada aos endereços dados.
 *
 * Devolve a lista de `{ destino, remetente, tx, bloco }`. O REMETENTE é a prova:
 * é a carteira que assinou, e é ela que vai ser conferida contra o contrato.
 *
 * A faixa é aberta bloco a bloco porque o `to` de uma transferência nativa só
 * existe dentro do bloco — ver o cabeçalho.
 */
/**
 * ============================================================================
 * ACHAR O PAGAMENTO SEM ABRIR BLOCO — e por que isso importa tanto
 * ============================================================================
 *
 * `procuraPagamentos` abre bloco por bloco porque transferência nativa não emite
 * log. Funciona, e tem dois defeitos que se combinaram num estrago real:
 *
 *   É CARO. Dezenas de chamadas por minuto no RPC público, que responde 429 —
 *   e o 429 derrubou a varredura em produção hoje.
 *
 *   SÓ ENXERGA A JANELA. Ele varre de um bloco a outro. Pagamento que caiu
 *   enquanto a varredura estava parada fica pra trás pra sempre, e a pessoa
 *   perde o gas sem ganhar cargo nem receber aviso.
 *
 * O explorer resolve os dois: uma chamada por endereço, ~300 ms, e devolve o
 * histórico INTEIRO daquele endereço — inclusive o que chegou há uma hora.
 *
 * ---------------------------------------------------------------------------
 * MAS ELE NÃO É A AUTORIDADE
 * ---------------------------------------------------------------------------
 * O explorer é um índice mantido por terceiro. Confiar nele sozinho seria trocar
 * "li da cadeia" por "acreditei num site" — e o que está em jogo é dar cargo a
 * quem provou ter carteira. Um índice comprometido concederia cargo a qualquer
 * um.
 *
 * Por isso ele só APONTA. Cada transação que ele indica é conferida no RPC com
 * `eth_getTransactionByHash`, e é a resposta do nó que decide. O explorer vira
 * um atalho pra saber ONDE olhar; a cadeia continua dizendo O QUE é verdade.
 */
const EXPLORER = process.env.RONIN_EXPLORER || 'https://explorer.roninchain.com/api'

export async function pagamentosPara(endereco, desde) {
  const alvo = endereco.toLowerCase()
  const u = `${EXPLORER}?module=account&action=txlist&address=${alvo}&sort=desc&page=1&offset=20`

  let lista
  try {
    const r = await fetch(u, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!r.ok) return { ok: false, achados: [] }
    const j = await r.json()
    // "No transactions found" com result [] é RESPOSTA, não falha: significa que
    // ninguém pagou ainda, que é o caso normal de quem acabou de clicar.
    lista = Array.isArray(j.result) ? j.result : []
  } catch {
    return { ok: false, achados: [] }
  }

  const candidatos = lista.filter(
    (tx) =>
      String(tx.to || '').toLowerCase() === alvo &&
      tx.isError !== '1' &&
      // DEPOIS DO CLIQUE, e não qualquer pagamento da história. Sem este corte,
      // um pagamento antigo revalidaria a pessoa pra sempre a cada clique — e a
      // prova deixaria de ser "mandei agora" pra virar "mandei um dia".
      (!desde || Number(tx.timeStamp) * 1000 >= desde),
  )

  const achados = []
  for (const tx of candidatos) {
    // A CADEIA CONFIRMA. Ver o cabeçalho: o explorer aponta, o nó decide.
    const real = await rpc('eth_getTransactionByHash', [tx.hash]).catch(() => null)
    if (!real) continue
    if (String(real.to || '').toLowerCase() !== alvo) continue
    achados.push({
      destino: alvo,
      remetente: String(real.from).toLowerCase(),
      tx: real.hash,
      bloco: Number(real.blockNumber),
    })
  }
  return { ok: true, achados }
}

export async function procuraPagamentos(enderecos, de, ate) {
  const alvos = new Set(enderecos.map((e) => e.toLowerCase()))
  if (alvos.size === 0) return []
  const achados = []
  for (let n = de; n <= ate; n++) {
    const bloco = await rpc('eth_getBlockByNumber', ['0x' + n.toString(16), true])
    if (!bloco) continue
    for (const tx of bloco.transactions || []) {
      const destino = (tx.to || '').toLowerCase()
      if (!alvos.has(destino)) continue
      achados.push({
        destino,
        remetente: tx.from.toLowerCase(),
        tx: tx.hash,
        bloco: n,
      })
    }
  }
  return achados
}

/**
 * A carteira tem pelo menos um item da coleção AGORA?
 *
 * É a segunda metade da prova. A transação mostra QUEM é a carteira; isto
 * mostra se ela ainda tem o NFT — e é o que a varredura periódica repete pra
 * tirar o cargo de quem vendeu.
 */
export async function temNft(carteira) {
  return (await quantosNft(carteira)) > 0
}

/**
 * Quantos itens da coleção a carteira tem. Zero quando não dá pra saber.
 *
 * NÃO LANÇA, e isto foi aprendido apanhando: o padrão ERC-721 manda `balanceOf`
 * REVERTER pro endereço zero, e o contrato do Ronkeverse obedece. Com a versão
 * que lançava, uma única carteira estranha na lista derrubaria a varredura de
 * reverificação inteira — e as outras 299 pessoas perderiam o cargo por causa
 * de uma.
 *
 * Zero em caso de dúvida é o lado certo pra errar? NÃO, e por isso quem chama
 * precisa saber: zero aqui significa "não tem" E TAMBÉM "não consegui
 * perguntar". Pra dar cargo isso é seguro (na dúvida, não dá); pra TIRAR cargo
 * seria injusto — um RPC fora do ar tiraria o cargo de todo mundo. Ver
 * `verificaTodos`, que trata os dois casos de forma diferente.
 */
export async function quantosNft(carteira) {
  const dado = '0x70a08231' + carteira.replace(/^0x/, '').toLowerCase().padStart(64, '0')
  try {
    const res = await rpc('eth_call', [{ to: COLECAO, data: dado }, 'latest'])
    return Number(BigInt(res || '0x0'))
  } catch {
    return 0
  }
}

/**
 * O saldo, distinguindo "não tem" de "não consegui perguntar".
 *
 * É a função que a varredura de reverificação tem que usar: tirar o cargo de
 * alguém porque o RPC piscou é o pior erro que este sistema pode cometer — o
 * membro não fez nada e perde o acesso.
 */
export async function saldoSeguro(carteira) {
  const dado = '0x70a08231' + carteira.replace(/^0x/, '').toLowerCase().padStart(64, '0')
  try {
    const res = await rpc('eth_call', [{ to: COLECAO, data: dado }, 'latest'])
    return { ok: true, saldo: Number(BigInt(res || '0x0')) }
  } catch (e) {
    // Reverter é resposta do CONTRATO (endereço zero, por exemplo) e vale como
    // "não tem". Falha de rede não vale como nada.
    const reverteu = /revert/i.test(String(e.message))
    return reverteu ? { ok: true, saldo: 0 } : { ok: false, saldo: 0, erro: e.message }
  }
}

export async function blocoAtual() {
  return Number(BigInt(await rpc('eth_blockNumber', [])))
}

/**
 * O QUE HA NESTE ENDERECO? — pra o bot confirmar em portugues, nao em hexa.
 *
 * Quem configura vai COLAR um endereco de contrato. E o unico campo do comando
 * que nao e um seletor, e portanto o unico onde da pra errar: endereco de outra
 * colecao, endereco de carteira, endereco com um digito trocado.
 *
 * Um bot que aceita calado deixa a comunidade com uma regra que nunca vai dar
 * cargo a ninguem -- e sem nenhuma pista do porque. Entao antes de aceitar, ele
 * pergunta a cadeia o que e aquilo e devolve o NOME. A pessoa confirma "sim, e
 * o Ronkeverse" em vez de conferir 42 caracteres a olho.
 */
export async function descreveContrato(endereco) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(endereco)) {
    return { ok: false, erro: 'isso não parece um endereço (esperado 0x + 40 caracteres)' }
  }
  const texto = async (selector) => {
    try {
      const res = await rpc('eth_call', [{ to: endereco, data: selector }, 'latest'])
      const h = res.slice(2)
      const off = Number(BigInt('0x' + h.slice(0, 64))) * 2
      const tam = Number(BigInt('0x' + h.slice(off, off + 64)))
      return Buffer.from(h.slice(off + 64, off + 64 + tam * 2), 'hex').toString('utf8')
    } catch {
      return null
    }
  }
  /*
   * AS QUATRO PERGUNTAS DE UMA VEZ.
   *
   * Nenhuma depende da outra, e em fila elas custavam ~1,6 s — perto demais dos
   * 3 segundos que o Discord dá pra uma interação responder. Em paralelo o custo
   * vira o da mais lenta.
   *
   * `supportsInterface(0x80ac58cd)` = ERC-721. Se responder false ou reverter,
   * provavelmente e ERC-20 -- e ai "quantidade" quer dizer outra coisa (casas
   * decimais), o que muda o significado do `minimo` que a pessoa digitou.
   */
  const [codigo, nome, simbolo, ehNft] = await Promise.all([
    rpc('eth_getCode', [endereco, 'latest']).catch(() => '0x'),
    texto('0x06fdde03'), // name()
    texto('0x95d89b41'), // symbol()
    rpc('eth_call', [
      { to: endereco, data: '0x01ffc9a780ac58cd00000000000000000000000000000000000000000000000000000000' },
      'latest',
    ])
      .then((r) => BigInt(r || '0x0') === 1n)
      .catch(() => false),
  ])

  // A conferência do código vem depois de perguntar, e não antes: perguntar tudo
  // junto custa o mesmo que perguntar uma coisa só, e a resposta continua a mesma.
  if (!codigo || codigo === '0x') {
    return { ok: false, erro: 'não há contrato neste endereço — talvez seja uma carteira' }
  }

  return { ok: true, nome, simbolo, ehNft }
}

/**
 * SALDO DE QUALQUER CONTRATO — NFT ou token, com a unidade certa.
 *
 * A DIFERENCA QUE MORDE: `balanceOf` devolve unidades pra ERC-721 (3 = tres
 * NFTs) e WEI pra ERC-20 (1000 tokens = 1000000000000000000000). Tratar os dois
 * igual faz uma regra de "minimo 1000 do token" ser satisfeita por qualquer
 * pessoa com 0,000000000000001 -- ou seja, todo mundo.
 *
 * Por isso o tipo do contrato faz parte da conta, e nao e adivinhado na hora:
 * ele e descoberto uma vez (`descreveContrato`) e guardado junto da regra.
 */
export async function decimaisDe(contrato) {
  try {
    const res = await rpc('eth_call', [{ to: contrato, data: '0x313ce567' }, 'latest'])
    const n = Number(BigInt(res || '0x0'))
    return Number.isFinite(n) && n >= 0 && n <= 36 ? n : 18
  } catch {
    // Sem `decimals()` o contrato e quase certamente ERC-721, onde a unidade
    // ja e a contagem. Zero casas = nao divide nada.
    return 0
  }
}

/**
 * Saldo legivel de `carteira` no `contrato`, na unidade que a pessoa entende.
 *
 * Devolve `{ ok, saldo }`. `ok: false` significa "nao consegui perguntar" e NAO
 * pode ser lido como "nao tem" -- tirar cargo por RPC fora do ar e o pior erro
 * deste sistema. Ver `saldoSeguro`.
 */
export async function saldoNoContrato(carteira, contrato, decimais) {
  const casas = typeof decimais === 'number' ? decimais : await decimaisDe(contrato)
  const dado = '0x70a08231' + carteira.replace(/^0x/, '').toLowerCase().padStart(64, '0')
  try {
    const res = await rpc('eth_call', [{ to: contrato, data: dado }, 'latest'])
    const bruto = BigInt(res || '0x0')
    // Divisao INTEIRA de proposito: quem tem 999,9 tokens nao alcanca um minimo
    // de 1000. Arredondar pra cima daria cargo a quem esta abaixo da regra.
    const saldo = casas === 0 ? Number(bruto) : Number(bruto / 10n ** BigInt(casas))
    return { ok: true, saldo }
  } catch (e) {
    const reverteu = /revert/i.test(String(e.message))
    return reverteu ? { ok: true, saldo: 0 } : { ok: false, saldo: 0, erro: e.message }
  }
}

/**
 * DONO DE UM TOKEN ESPECIFICO — `ownerOf(id)`.
 *
 * Existe por causa de uma regra que saldo nao expressa: "Ronke Lord = tem um
 * 1/1". Isso nao e QUANTOS a pessoa tem, e QUAIS -- e `balanceOf` nao sabe
 * responder.
 *
 * Devolve o endereco do dono, ou null se o token nao existe (o padrao manda
 * `ownerOf` reverter pra id inexistente, e reverter aqui e resposta, nao falha).
 */
export async function donoDoToken(contrato, id) {
  const dado = '0x6352211e' + BigInt(id).toString(16).padStart(64, '0')
  try {
    const res = await rpc('eth_call', [{ to: contrato, data: dado }, 'latest'])
    if (!res || res === '0x') return null
    return '0x' + res.slice(-40).toLowerCase()
  } catch {
    return null
  }
}

/**
 * A carteira tem ALGUM dos tokens da lista?
 *
 * Para no primeiro que encontrar -- quem tem um 1/1 costuma ter o de numero
 * baixo, e a resposta e sim/nao, entao continuar perguntando so gasta chamada.
 *
 * `{ ok:false }` quando a rede falhou: quem chama NAO pode ler isso como "nao
 * tem", pelo mesmo motivo de `saldoSeguro` -- tirar cargo por RPC fora do ar e
 * o pior erro deste sistema.
 */
/**
 * ============================================================================
 * O MAPA DE DONOS — quem tem cada 1/1, fotografado devagar
 * ============================================================================
 *
 * `temAlgumToken` pergunta "esta carteira tem algum destes 107?" e, pra quem NÃO
 * tem, custa 107 chamadas pra descobrir um "não". Medido: 45 segundos. E o RPC
 * público da Ronin permite 100 chamadas por MINUTO — então esta pergunta estoura
 * o teto sozinha, toda vez. Foi ela que matou a varredura hoje com 429.
 *
 * A saída é inverter a pergunta. Em vez de perguntar por carteira (caro, e no
 * momento em que alguém espera), perguntar por TOKEN, uma vez só, quando ninguém
 * está esperando: quem é o dono de cada um dos 107?
 *
 * Com esse mapa, "esta carteira tem algum 1/1?" vira uma consulta local.
 *
 * ---------------------------------------------------------------------------
 * DEVAGAR DE PROPÓSITO
 * ---------------------------------------------------------------------------
 * O intervalo entre chamadas existe pra ficar ABAIXO do teto do RPC, não por
 * educação. 107 chamadas a 700 ms são ~75 segundos e ~86 por minuto — sob os 100
 * permitidos, com folga pra varredura respirar no meio.
 *
 * ---------------------------------------------------------------------------
 * `completo` NÃO É DETALHE
 * ---------------------------------------------------------------------------
 * Se um único `ownerOf` falhar, o dono daquele token some do mapa — e quem lê o
 * mapa concluiria que ninguém o tem. Num mapa que só serve pra NEGAR, isso vira
 * exatamente um cargo tirado de quem merece. Por isso a falha é registrada e o
 * mapa inteiro é marcado incompleto; quem lê tem que recusar a usá-lo.
 */
export async function mapaDeDonos(contrato, ids, { intervalo = 700 } = {}) {
  const donos = {}
  let falhou = false

  for (const id of ids) {
    const dono = await donoDoToken(contrato, id)
    if (dono === null) {
      falhou = true
    } else {
      ;(donos[dono] ||= []).push(id)
    }
    await new Promise((f) => setTimeout(f, intervalo))
  }

  return { donos, completo: !falhou, quando: Date.now(), total: ids.length }
}

export async function temAlgumToken(carteira, contrato, ids) {
  const alvo = carteira.toLowerCase()
  let falhou = false
  for (const id of ids) {
    try {
      const dono = await donoDoToken(contrato, id)
      if (dono === alvo) return { ok: true, tem: true, id }
      if (dono === null) falhou = true
    } catch {
      falhou = true
    }
  }
  return falhou ? { ok: false, tem: false } : { ok: true, tem: false }
}
