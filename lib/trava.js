/**
 * A TRAVA DA REVARREDURA DIÁRIA — como o laço de pagamento sabe que deve esperar.
 *
 * A revarredura roda sozinha de propósito: ela pode varrer os 159 ids dos 1/1 a
 * 700 ms cada, e o RPC público da Ronin aceita 100 chamadas por minuto por IP.
 * Dois consumidores famintos juntos viram 429 pros dois.
 *
 * A primeira versão parava o serviço do laço (`systemctl stop`) enquanto ela
 * rodava. Funciona, mas o vigia do servidor lê "serviço parado" e manda alarme
 * no Telegram toda madrugada, às 02:17. Agora o serviço fica de pé o tempo todo e
 * só PULA as voltas de pagamento enquanto existir este arquivo, que a unidade da
 * revarredura cria na partida e apaga no fim.
 *
 * O ARQUIVO ENVELHECE: trava mais velha que o teto vale como esquecida. Se a
 * unidade morrer sem apagar, o laço volta sozinho em vez de ficar mudo pra
 * sempre. O teto é o `TimeoutStartSec` da revarredura (45 min) com folga.
 *
 * Sem `TRAVA_REVARRE` no ambiente (Actions, terminal) não há trava nenhuma.
 */
import { statSync } from 'node:fs'

export const TETO_DA_TRAVA_MS = 50 * 60_000

export function travaFresca(caminho, agora = Date.now(), tetoMs = TETO_DA_TRAVA_MS) {
  if (!caminho) return false
  try {
    return agora - statSync(caminho).mtimeMs < tetoMs
  } catch {
    return false
  }
}
