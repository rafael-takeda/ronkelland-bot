/**
 * ============================================================================
 * OS COMANDOS — o que o Discord registra e desenha
 * ============================================================================
 *
 * TUDO QUE O USUÁRIO LÊ É EM INGLÊS. Os comentários seguem em português: eles
 * são pra quem mantém o código, e as duas comunidades falam inglês no Discord.
 *
 * Este arquivo é só a DECLARAÇÃO — a forma dos comandos. Ele é enviado uma vez
 * pro Discord, que a partir daí desenha o formulário, o seletor de cargo e
 * decide quem enxerga o quê. Nenhuma lógica de negócio aqui, de propósito: erro
 * de forma tem que estourar no registro, não no meio de uma conversa.
 *
 * ---------------------------------------------------------------------------
 * QUEM PODE USAR CADA UM
 * ---------------------------------------------------------------------------
 * `default_member_permissions` é um bitfield em string. Quem não tem a permissão
 * nem VÊ o comando, e o Discord recusa a chamada no servidor dele — não é a
 * interface escondendo botão.
 *
 *   `verify`     — qualquer membro (sem permissão declarada = todos)
 *   `ronkelland` — exige MANAGE_GUILD (1 << 5 = 32)
 *
 * O dono do servidor pode mudar isso depois em Configurações → Integrações.
 * Isso é recurso, não furo: o servidor é dele.
 */

const MANAGE_GUILD = String(1n << 5n)

/** Tipos de opção do Discord. O 8 é o que desenha o SELETOR DE CARGOS. */
const TIPO = { SUB: 1, GRUPO: 2, STRING: 3, INTEGER: 4, ROLE: 8 }

export const COMANDOS = [
  {
    name: 'verify',
    description: 'Prove you hold the NFT and get your role',
    options: [],
  },
  /*
   * UM COMANDO SÓ, SEM SUBCOMANDO — e o painel faz o resto.
   *
   * A primeira versão era `/ronkelland rule add <contrato> <minimo> <cargo>`.
   * Funciona, mas obriga o admin a saber a forma do comando antes de conseguir
   * usá-lo, e a digitar tudo numa linha só, sem ver o que já existe.
   *
   * `/ronkelland` sozinho abre uma tela: as regras atuais à vista, e botões pro
   * que dá pra fazer. Quem nunca usou descobre olhando, que é como se aprende
   * uma interface — ninguém lê a documentação de um bot de Discord.
   */
  {
    name: 'ronkelland',
    description: 'Open the setup panel',
    default_member_permissions: MANAGE_GUILD,
    options: [],
  },
]

/**
 * Confere a forma contra as regras do Discord ANTES de registrar.
 *
 * O registro falha com mensagem genérica ("Invalid Form Body") e um caminho tipo
 * `options.0.options.2.name` — ilegível, e só aparece na hora de subir o bot.
 * Aqui o erro sai em português e dizendo o que fazer.
 */
export function validaComandos(comandos) {
  const erros = []
  const nomeOk = (n) => /^[-_a-z0-9]{1,32}$/.test(String(n ?? ''))

  for (const c of comandos) {
    if (!nomeOk(c.name)) erros.push(`comando "${c.name}": nome tem que ser minúsculo, 1-32 chars`)
    if (!c.description || c.description.length > 100) {
      erros.push(`comando "${c.name}": descrição de 1 a 100 chars`)
    }
    if ((c.options ?? []).length > 25) erros.push(`comando "${c.name}": máximo 25 opções`)

    for (const o of c.options ?? []) {
      if (!nomeOk(o.name)) erros.push(`"${c.name} ${o.name}": nome inválido`)
      if (!o.description || o.description.length > 100) {
        erros.push(`"${c.name} ${o.name}": descrição de 1 a 100 chars`)
      }
      for (const s of o.options ?? []) {
        if (!nomeOk(s.name)) erros.push(`"${c.name} ${o.name} ${s.name}": nome inválido`)
        if (!s.description || s.description.length > 100) {
          erros.push(`"${c.name} ${o.name} ${s.name}": descrição de 1 a 100 chars`)
        }
        // Obrigatórias antes das opcionais — o Discord recusa o contrário.
        let viuOpcional = false
        for (const p of s.options ?? []) {
          if (!p.required) viuOpcional = true
          else if (viuOpcional) {
            erros.push(`"${c.name} ${o.name} ${s.name}": opção obrigatória depois de opcional`)
          }
        }
      }
    }
  }
  return erros
}
