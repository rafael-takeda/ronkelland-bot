/**
 * ============================================================================
 * A ASSINATURA DO DISCORD — a única porta de entrada do bot
 * ============================================================================
 *
 * O bot recebe interações por HTTP, numa URL pública. Sem esta checagem,
 * QUALQUER PESSOA que descubra a URL pode mandar um corpo dizendo "o usuário
 * fulano clicou em verificar" e o bot obedeceria — dando cargo a quem quisesse,
 * sem carteira, sem transação, sem nada.
 *
 * O Discord assina cada requisição com Ed25519. A chave pública fica no painel
 * da aplicação e é só isso que precisa ser configurado; ela é pública mesmo, não
 * é segredo. O segredo é a chave privada, e ela nunca sai do Discord.
 *
 * ---------------------------------------------------------------------------
 * O QUE É ASSINADO: `timestamp + corpo`, NOS BYTES CRUS
 * ---------------------------------------------------------------------------
 * Tem que ser o corpo EXATAMENTE como chegou. Se alguém fizer `JSON.parse` e
 * depois `JSON.stringify` pra remontar, a assinatura quebra — troca de ordem de
 * chave, de espaçamento, de escape, e o byte deixa de ser o mesmo. Este é o erro
 * clássico de quem implementa isso, e o sintoma é "não valida nunca".
 *
 * Por isso `valida` recebe o corpo como TEXTO, e quem chama tem que ler o corpo
 * cru antes de qualquer parse.
 */
import { verify } from 'node:crypto'

/**
 * Idade máxima de uma requisição. O Discord não exige, mas sem isso uma
 * requisição capturada hoje continuaria válida pra sempre — e replay de "fulano
 * clicou" é barato demais pra deixar em aberto.
 */
const IDADE_MAX_S = 300

/**
 * A requisição veio mesmo do Discord?
 *
 * @param corpo   texto CRU do corpo, sem parse
 * @param assinatura  cabeçalho `X-Signature-Ed25519`
 * @param timestamp   cabeçalho `X-Signature-Timestamp`
 * @param chavePublica  hex, do painel da aplicação
 */
export function valida(corpo, assinatura, timestamp, chavePublica) {
  if (!corpo || !assinatura || !timestamp || !chavePublica) return false

  const idade = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(idade) || idade > IDADE_MAX_S) return false

  try {
    // A chave crua vira DER porque `crypto.verify` só aceita chave em formato
    // reconhecido. O prefixo é o cabeçalho DER fixo de uma Ed25519 pública.
    const der = Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      Buffer.from(chavePublica, 'hex'),
    ])
    return verify(
      null, // Ed25519 não usa hash separado
      Buffer.from(timestamp + corpo, 'utf8'),
      { key: der, format: 'der', type: 'spki' },
      Buffer.from(assinatura, 'hex'),
    )
  } catch {
    // Assinatura malformada, chave errada, hex inválido — tudo isso é "não veio
    // do Discord". Nunca deixa passar por causa de exceção.
    return false
  }
}
