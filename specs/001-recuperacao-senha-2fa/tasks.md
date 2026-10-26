# Tarefas: Recuperação de Senha com Segundo Fator

Fase 4 (sincronização com satélites) não se aplica — `plan.md` registra impacto zero (decisão
`/clarify` P4).

## Fase 1 — Schema/Migração

- **T001**: Criar migration `YYYYMMDDHHMMSS_recuperacao_senha_2fa.sql` com comentário de "porquê"
  (fecha o elo mais fraco do 2FA: recuperação de senha só exigia e-mail). Cria a tabela
  `credential_challenges` (colunas conforme `data-model.md`), com RLS ligado e **sem nenhuma
  policy** (só `service_role`), igual ao padrão de `two_factor_challenges`.
  *Verificação*: `select * from credential_challenges limit 1;` como `service_role` funciona;
  como `anon`/`authenticated` falha (RLS bloqueia).
- **T002**: Na mesma migration, adicionar `profiles.pwd_changed_at timestamptz not null default
  now()`.
  *Verificação*: `select pwd_changed_at from profiles limit 5;` retorna valor para todas as linhas
  existentes (nenhum null).
- **T003**: Criar as funções SQL `SECURITY DEFINER` do desafio: `password_reset_start(p_email,
  p_ip)`, `credential_confirm_email(p_challenge, p_code)`, `credential_confirm_whatsapp(p_challenge,
  p_code)`, `credential_complete(p_challenge)` (esta última só valida estado e marca `used_at` —
  quem efetivamente troca a senha via Admin API é a edge function `reset-complete`, não o SQL).
  Rate limit (decisão fixada no `/analyze`, mesmos números já usados no 2FA do login): **5 erros
  por 15 min por e-mail, 20 por 15 min por IP** para os códigos; igual ao `two_factor_start`.
  *Verificação*: chamar cada função via `service_role` com dados de teste e conferir os estados
  de retorno (ok, locked, no_phone silencioso — ver T004).
- **T004**: Garantir que `password_reset_start` **não cria desafio nem dispara nada** quando a
  conta não tem `celular_corporativo`/`celular_pessoal`, mas ainda assim devolve o mesmo status
  genérico que o caso "conta não existe" (resolução da tensão FR02×FR05 registrada no `plan.md`).
  *Verificação*: chamar com um e-mail de conta sem celular e com um e-mail inexistente — os dois
  retornos da função são indistinguíveis do lado de quem chama a edge function depois.
- **T005**: Criar a função `fn_session_not_stale()` (ver `data-model.md` — claim ausente = válido;
  claim `< pwd_changed_at` ao vivo = inválido).
  *Verificação*: testar manualmente com um JWT de teste com e sem a claim, usando
  `set local role authenticated; set local "request.jwt.claims" = '...';` numa sessão psql.
- **T006**: Ler o SQL atual das policies de `profiles` (própria linha), `module_permissions`,
  `user_grants`, `user_value_exceptions`, e adicionar `fn_session_not_stale()` como condição
  extra em cada uma (não reescrever do zero — só adicionar a condição ao `USING`/`WITH CHECK`
  existente).
  *Verificação*: com um token de teste com claim desatualizada, um `select`/`update` numa dessas
  tabelas falha; com claim atual ou ausente, funciona normalmente.

## Fase 2 — Edge Functions

- **T007**: Criar `supabase/functions/reset-start/index.ts` (`verify_jwt: false`). Chama
  `password_reset_start`; se retornar que deve enviar código, dispara e-mail (SMTP do projeto,
  mesmo canal dos templates existentes) e WhatsApp (`sendWhatsAppText`, reaproveitando
  `_shared/whatsapp.ts`) com os dois códigos de 6 dígitos. Resposta HTTP sempre `{ ok: true }`.
  *Verificação*: `curl` com e-mail válido com celular → recebe e-mail e WhatsApp; com e-mail sem
  celular ou inexistente → mesma resposta, nada chega.
- **T008**: Criar `reset-confirm-email` e `reset-confirm-whatsapp` (`verify_jwt: false`), chamando
  `credential_confirm_email`/`credential_confirm_whatsapp`, com o mesmo limite de tentativas do
  `login-verify` (5 tentativas). Achado 2 do `/analyze`: `challenge_id` inexistente e código
  errado devolvem a **mesma mensagem genérica** (mesmo padrão da constante `INVALID` única do
  `login-verify`) — nunca uma mensagem diferente para "desafio não existe".
  *Verificação*: código certo confirma; código errado 5x bloqueia o desafio; `challenge_id`
  forjado/inexistente devolve texto idêntico ao de código errado.
- **T009**: Criar `reset-complete` (`verify_jwt: false`): confere os dois `*_confirmed_at`
  preenchidos e desafio não expirado/usado, e que a nova senha tem **mínimo 8 caracteres**
  (decisão fixada no `/analyze` — sobe de 6 para 8) → `auth.admin.updateUserById` (nova senha) →
  `profiles.pwd_changed_at = now()` → `auth.admin.signOut(user_id, 'global')` → marca desafio
  usado → grava `activity_logs` (`password_reset`). Não retorna sessão.
  *Verificação*: senha com menos de 8 caracteres é recusada; fluxo completo com 8+ troca a senha;
  tentar usar o mesmo `challenge_id` de novo falha (`used_at` já preenchido); login com a senha
  antiga falha, com a nova funciona.
- **T010**: Alterar `supabase/functions/invite-user/index.ts`: validar celular cadastrado antes de
  convidar (FR08); trocar o envio do convite nativo do Supabase por um desafio
  `credential_challenges` com `purpose='invite'`, reaproveitando `reset-confirm-*`/`reset-complete`
  (ou duplicando a validação de purpose, decisão de implementação).
  *Verificação*: convidar sem celular cadastrado é barrado com mensagem clara; convidar com
  celular dispara os dois códigos e o fluxo de "definir senha" funciona ponta a ponta.
- **T010b** (achado 1 do `/analyze`): no mesmo arquivo, no caminho `resend: true` (reenviar
  credenciais de alguém que já tem conta — não passa pelo desafio de dois fatores, é um admin
  autenticado agindo, não a própria pessoa provando identidade), gravar
  `profiles.pwd_changed_at = now()` e chamar `auth.admin.signOut(user_id, 'global')` logo depois
  de definir a senha temporária — mesmo efeito colateral do `reset-complete` (FR10).
  *Verificação*: reenviar credenciais de um usuário com sessão aberta em outra aba/dispositivo —
  essa sessão para de funcionar logo em seguida.
- **T011**: Transformar `send-recovery-email` em stub HTTP 410 — **só depois que T012-T014
  estiverem validadas em produção** (ordem de publicação do `plan.md`, passo 5).
  *Verificação*: chamada à function antiga retorna 410 e nenhum fluxo do frontend depende mais
  dela.

## Fase 3 — Frontend

- **T012**: Reescrever o fluxo "Esqueceu a senha?" em `src/pages/Login.jsx`: `reset-start` →
  confirmar e-mail e WhatsApp (`reset-confirm-email`/`reset-confirm-whatsapp`) → `reset-complete`.
  Remover toda chamada a `supabase.auth.verifyOtp`/`updateUser`/`resetPasswordForEmail` deste
  fluxo.
  *Verificação*: `npm run dev`, fluxo completo no navegador, incluindo os casos de código errado
  e conta sem celular (mensagem genérica, sem revelar nada).
- **T013**: Criar o modo "definir senha" (convite e recuperação) parametrizado por
  `?challenge=...` na query string (nunca hash) — pode reaproveitar o `mode: 'reset'` existente
  do `Login.jsx` trocando a origem do estado (de hash pra query param).
  *Verificação*: abrir a URL com um `challenge_id` de teste mostra a tela certa; sem parâmetro,
  cai no login normal.
- **T014**: Remover de `src/App.jsx` toda a detecção de `type=invite`/`type=recovery` no hash e os
  estados `isRecovery`/`linkExpired` associados.
  *Verificação*: `npm run build` passa; abrir a raiz do site sem hash nenhum continua levando ao
  login normalmente.

## Fase 5 — Verificação

- **T015**: Escrever teste de unidade (`node:test`, padrão de
  `supabase/functions/_shared/__tests__/`) para a lógica pura de decidir "enviar código ou não"
  (a resolução FR02×FR05 do T004/T007) e para a lógica de expiração/tentativas dos desafios, se
  essa lógica puder ser extraída para um módulo `_shared/credential-challenges-core.ts` testável
  fora do runtime Deno (mesmo padrão de `eventos-ingest-core.ts`).
  *Verificação*: `node --experimental-strip-types --test
  supabase/functions/_shared/__tests__/credential-challenges-core.test.mjs` passa.
- **T016**: Checklist de verificação manual completo em produção (ou ambiente equivalente) antes
  de considerar a feature pronta — repetir aqui o checklist do `plan.md`:
  - [ ] Login normal com 2FA sem regressão.
  - [ ] Recuperação ponta a ponta com celular cadastrado.
  - [ ] Recuperação de conta sem celular: nenhum código enviado, mensagem genérica.
  - [ ] Convite ponta a ponta com celular cadastrado.
  - [ ] Convite barrado para quem não tem celular.
  - [ ] Sessão aberta em outro dispositivo cai de fato após reset (próprio usuário e via admin).
  - [ ] Ativação do hook/RLS (passo 6 do rollout) não desloga ninguém só pelo deploy.
