# Modelo de Dados: Recuperação de Senha com Segundo Fator

## Tabela nova: `credential_challenges`

Generaliza o desafio de dois fatores tanto para recuperação de senha (FR01-FR07) quanto para
primeiro acesso por convite (FR08) — um `purpose` distingue os dois usos, evitando duplicar a
mesma máquina de estado em duas tabelas.

| Coluna                | Tipo          | Observação |
|------------------------|---------------|------------|
| `id`                   | uuid pk       | |
| `user_id`              | uuid          | referencia `profiles(id)` |
| `purpose`              | text          | `'reset'` \| `'invite'` |
| `email_code_hash`      | text          | hash do código de 6 dígitos enviado por e-mail |
| `whatsapp_code_hash`   | text          | hash do código de 6 dígitos enviado por WhatsApp |
| `email_confirmed_at`   | timestamptz   | null até confirmar |
| `whatsapp_confirmed_at`| timestamptz   | null até confirmar |
| `attempts_email`       | int default 0 | |
| `attempts_whatsapp`    | int default 0 | |
| `ip`                   | inet          | pedido original, para rate limit |
| `created_at`           | timestamptz   | |
| `expires_at`           | timestamptz   | |
| `used_at`              | timestamptz   | null até a troca de senha ser concluída |

**RLS**: ligado, sem nenhuma policy — só `service_role` acessa (mesmo padrão de
`two_factor_challenges`/`whatsapp_login_attempts`, CLAUDE.md seção "RLS notáveis").

## Coluna nova: `profiles.pwd_changed_at`

`timestamptz`, default `now()` nas linhas existentes (não força logout de ninguém na hora do
deploy — só tokens emitidos *depois* desta migration carregam a informação, ver trigger/hook
abaixo). Atualizada toda vez que a senha de alguém muda — por recuperação (FR03), por conclusão
de convite, ou por um admin via "Reenviar credenciais" (FR10).

## Função SQL: `fn_session_not_stale()`

Helper de RLS: compara a claim `pwd_changed_at` do JWT atual (se existir) com o valor ao vivo em
`profiles.pwd_changed_at` para `auth.uid()`.

- Claim ausente (token emitido antes desta feature) → considera válido (não quebra sessões já
  abertas só pelo deploy da migration).
- Claim presente e `>=` valor ao vivo → válido.
- Claim presente e `<` valor ao vivo → **inválido** (a senha mudou depois deste token ser
  emitido — é exatamente o caso que o achado P1 do Codex apontava como furo).

## Onde `fn_session_not_stale()` entra nas RLS (impõe a regra 5 do CLAUDE.md: enforcement no banco, não só no frontend)

Adicionada como condição extra nas policies de leitura/escrita das tabelas que a seção 7 do
CLAUDE.md já trata como superfície de permissão mais sensível: `profiles` (própria linha),
`module_permissions`, `user_grants`, `user_value_exceptions`. As policies exatas (nomes atuais,
texto completo) serão lidas e ajustadas no `/tasks`/`/implement` — este documento fixa a direção
(quais tabelas, por quê), não reescreve SQL de policy existente sem olhar o texto real primeiro.

**Risco aceito e documentado**: tabelas fora desta lista continuam protegidas só pela revogação
do refresh token (`auth.admin.signOut(user_id, 'global')`, que barra qualquer sessão nova) — o
access token já emitido antes da troca de senha continua válido até expirar nessas tabelas
específicas. Fechar esse gap universalmente exigiria auditar todas as RLS policies do projeto,
isso é maior que o escopo desta feature e fica registrado como gap conhecido (mesmo padrão da
seção 11 do CLAUDE.md), não resolvido silenciosamente nem ignorado.

## Hook novo: Custom Access Token (Supabase Auth)

Função Postgres que embute `pwd_changed_at` (epoch) como claim customizada em todo JWT novo
emitido. Precisa ser ativada manualmente no painel do Supabase depois do deploy da migration —
mesmo tipo de passo manual pós-deploy que o Send Email Hook da PR antiga já exigia.
