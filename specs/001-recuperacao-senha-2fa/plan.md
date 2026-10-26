# Plano Técnico: Recuperação de Senha com Segundo Fator

Stack fixa do `CLAUDE.md` (seção 2): React 19 + Vite no frontend, Supabase (Postgres/RLS/Edge
Functions Deno) no backend, sem ORM.

## Decisão de desenho: abandonar o caminho nativo do Supabase Auth, não só "corrigir a corrida"

A PR #49 tentava barrar o `detectSessionInUrl` com um `useEffect` correndo contra o client do
Supabase (achado P2 do Codex: o client processa o hash antes do efeito rodar). Este plano resolve
a causa, não a corrida: a recuperação e o convite deixam de usar o link mágico nativo do Supabase
Auth (`resetPasswordForEmail`, `verifyOtp type:recovery`, link de invite) inteiramente. Em vez
disso, os dois fluxos usam uma máquina de desafio própria (`credential_challenges`, ver
`data-model.md`) com dois códigos de 6 dígitos (e-mail + WhatsApp), nunca um token de sessão na
URL. Sem token na URL, não há o que o `detectSessionInUrl` possa capturar — o P2 deixa de ter
onde acontecer, em vez de ser bloqueado na corrida.

Isso também simplifica em relação à PR #49: não precisa mais do hook `auth-email-hook` pra
descartar e-mails nativos do Supabase, porque o fluxo novo nunca aciona o e-mail nativo de
recuperação/convite — o e-mail do código de 6 dígitos é disparado pelo próprio projeto, pelo
mesmo canal SMTP já usado nos templates de boas-vindas.

## Frontend

- `src/pages/Login.jsx`: troca `handleForgotPassword` / `handleVerifyOtp` / `handleSetNewPassword`
  (hoje chamam `send-recovery-email` e `supabase.auth.verifyOtp`/`updateUser`) por um fluxo que
  chama `reset-start` → confirma e-mail e WhatsApp (`reset-confirm-email`,
  `reset-confirm-whatsapp` — simultâneo ou sequencial é detalhe de UI pro `/tasks`) →
  `reset-complete`. Nenhuma chamada a `supabase.auth.*` nesse fluxo inteiro.
- `src/App.jsx`: remove a detecção de `type=invite`/`type=recovery` no hash e todo o estado
  `isRecovery`/`linkExpired` ligado a isso — não existe mais link com token na URL pra detectar.
  Simplifica o arquivo.
- Página/modo novo (`/definir-senha?challenge=...`, query string — nunca hash) cobre tanto
  "concluir convite" quanto "concluir recuperação", parametrizado pelo `purpose` do desafio.
- Celular ausente: tela mostra a mesma orientação que o login já usa pro erro `no_phone`
  ("fale com o administrador"), sem revelar se o e-mail existe (ver nota de anti-enumeração
  abaixo).

## Edge Functions

- **`reset-start`** (novo, `verify_jwt: false`): recebe `{ email }`. Chama uma função SQL que:
  confere rate limit (mesmo espírito do login: por e-mail e por IP), confere se o e-mail existe e
  a conta está ativa. **Resolução da tensão FR02 × FR05**: a resposta HTTP é sempre genérica
  (`{ ok: true }`), inclusive quando a conta não tem celular — a diferença é que, nesse caso, o
  sistema simplesmente **não envia nenhum código** (nem e-mail nem WhatsApp). Isso evita vazar
  "esse e-mail existe mas não tem celular" para quem só forneceu o e-mail sem provar nada — e
  ainda assim cumpre o FR02 porque a pessoa de verdade, que não recebe nada, é orientada por um
  aviso padrão na tela ("se não chegar nada em alguns minutos, fale com o administrador") que
  aparece sempre, não só pra quem não tem celular.
- **`reset-confirm-email`** / **`reset-confirm-whatsapp`** (novos, `verify_jwt: false`): recebem
  `{ challenge_id, code }`, confirmam o código correspondente (com limite de tentativas, mesmo
  padrão do `login-verify`).
- **`reset-complete`** (novo, `verify_jwt: false`): recebe `{ challenge_id, new_password }`.
  Exige os dois `*_confirmed_at` preenchidos e o desafio não expirado/usado. Troca a senha via
  **Admin API** (`auth.admin.updateUserById`, mesmo mecanismo já usado por `invite-user` e
  `delete-user` — nunca manipula `auth.users` direto por SQL). Em seguida: grava
  `profiles.pwd_changed_at = now()`, chama `auth.admin.signOut(user_id, 'global')` (revoga
  refresh tokens na hora), marca o desafio como usado, registra `activity_logs` (`password_reset`).
  **Não abre sessão** — FR07 exige login normal depois.
- **`invite-user`** (existente, alterado): passa a exigir celular cadastrado antes de permitir o
  convite (FR08) — validação adicional, erro claro se faltar. A conclusão do convite deixa de
  depender do link mágico nativo do Supabase: usa o mesmo `credential_challenges` com
  `purpose='invite'`.
- **`send-recovery-email`** (existente): vira stub HTTP 410, igual a PR #49 propunha — só depois
  que o frontend novo estiver no ar (ver ordem de publicação).

## Banco

- Migration nova (nome `YYYYMMDDHHMMSS_recuperacao_senha_2fa.sql`, comentário de "porquê"
  obrigatório): tabela `credential_challenges`, coluna `profiles.pwd_changed_at`, função
  `fn_session_not_stale()`, e as funções SQL de apoio aos desafios (`SECURITY DEFINER`,
  chamadas só pelas edge functions com service role). Ver `data-model.md` para o detalhe de cada
  peça.
- Hook de Custom Access Token: função Postgres nova, mas a **ativação em si é manual no painel
  do Supabase** (Authentication → Hooks), passo pós-deploy — mesmo tipo de ativação manual que o
  `Send Email Hook` da PR antiga já exigia.
- RLS: adicionar `fn_session_not_stale()` às policies de `profiles`, `module_permissions`,
  `user_grants`, `user_value_exceptions` — texto exato das policies a conferir no `/tasks`
  (preciso ler o SQL atual de cada uma antes de editar, não reescrever às cegas).

## Impacto em satélites

Nenhum. Por decisão explícita em `/clarify` (P4), derrubar sessão não alcança os sistemas
satélite nesta feature — fica registrado como extensão futura, não implementado aqui.

## Risco e rollback (CLAUDE.md seção 3 — mudança em autenticação/sessão é alto risco)

Rollout em passos independentes, cada um revertível sem precisar desfazer schema (as mudanças de
banco são só aditivas):

1. Aplicar a migration (tabela/coluna/funções novas) — não muda nenhum comportamento ainda.
2. Publicar as novas edge functions ao lado das antigas, sem trocar o frontend.
3. Trocar o frontend para o fluxo novo.
4. Validar manualmente em produção (checklist abaixo).
5. Aposentar `send-recovery-email` (410) e remover o hash-handling antigo do `App.jsx`.
6. Por último, ativar o Custom Access Token Hook e as RLS novas — são a mudança de maior alcance
   (afeta o formato do JWT emitido para todo mundo, não só quem usa recuperação), então só depois
   dos passos 1-5 estarem estáveis em produção, pra poder desligar só o hook e reverter rápido se
   algo quebrar, sem precisar reverter o resto.

**Checklist de verificação manual obrigatório antes de considerar pronto** (não existe suíte
automatizada que pegue regressão aqui — CLAUDE.md seção 3):
- Login normal com 2FA continua funcionando sem regressão (login-start/login-verify intocados).
- Recuperação de senha ponta a ponta, com celular cadastrado: os dois códigos, troca de senha,
  login normal depois funciona.
- Recuperação de conta sem celular cadastrado: não entrega nenhum código, mostra orientação
  genérica, não revela nada sobre a conta.
- Convite de colaborador novo ponta a ponta (com celular cadastrado).
- Tentativa de convite para alguém sem celular: barrado com erro claro pro admin.
- Sessão aberta em outro dispositivo/aba realmente para de funcionar depois de um reset (tanto
  por recuperação quanto por "Reenviar credenciais" do admin).
- Depois de ativar o hook/RLS novas (passo 6): confirmar que ninguém com sessão já aberta antes
  do deploy foi deslogado à força só pelo deploy em si (claim ausente = token grandfathered).
