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

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // O RPC público devolve 403 pro User-Agent padrão de biblioteca.
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!r.ok) throw new Error(`RPC ${method}: HTTP ${r.status}`)
  const d = await r.json()
  if (d.error) throw new Error(`RPC ${method}: ${d.error.message}`)
  return d.result
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
  const codigo = await rpc('eth_getCode', [endereco, 'latest']).catch(() => '0x')
  if (!codigo || codigo === '0x') {
    return { ok: false, erro: 'não há contrato neste endereço — talvez seja uma carteira' }
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
  const nome = await texto('0x06fdde03')   // name()
  const simbolo = await texto('0x95d89b41') // symbol()

  // `supportsInterface(0x80ac58cd)` = ERC-721. Se responder false ou reverter,
  // provavelmente e ERC-20 -- e ai "quantidade" quer dizer outra coisa (casas
  // decimais), o que muda o significado do `minimo` que a pessoa digitou.
  let ehNft = false
  try {
    const r = await rpc('eth_call', [
      { to: endereco, data: '0x01ffc9a780ac58cd00000000000000000000000000000000000000000000000000000000' },
      'latest',
    ])
    ehNft = BigInt(r || '0x0') === 1n
  } catch {
    ehNft = false
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
