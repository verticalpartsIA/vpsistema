# Análise: Recuperação de Senha com Segundo Fator

## Checklist (seção 7 do CLAUDE.md)

- Allow-list disfarçada de bloqueio-por-exceção? **N/A** — esta feature não mexe em controle de
  acesso a módulo.
- Enforcement de permissão no banco, não só no React? **OK** — `fn_session_not_stale()` entra na
  RLS (T006), não é checagem só no frontend.
- Dado relevante pra sync de satélite sem propagar? **OK** — `plan.md`/`clarify.md` (P4) já
  registram que isso fica fora do escopo, de propósito.
- Mudança em login/2FA/sessão sem passo de verificação manual? **OK** — T016 cobre o checklist
  completo, incluindo o caso de sessão em outro dispositivo.
- Migration sem comentário de "porquê"? **OK** — T001 já prevê o comentário.
- Requisito do `spec.md` sem tarefa correspondente, ou vice-versa? **Achado real, ver abaixo.**
- Tipos de dado conflitantes entre `data-model.md` e as tarefas? Nenhum encontrado.

## Achados

### 1. FR10 não está coberto de verdade pelo `tasks.md` (gap real)

`spec.md` FR10 exige que redefinir a senha de alguém via "Reenviar credenciais" (admin) derrube
as sessões abertas da conta, igual ao FR03. `tasks.md` T010 só altera `invite-user` para exigir
celular e trocar o convite **novo** pelo desafio de dois fatores — não diz nada sobre o caminho
`resend: true` (reenvio de credenciais pra quem já tem conta), que hoje só troca a senha sem
tocar em sessão nenhuma. Falta uma tarefa explícita: quando `invite-user` é chamado com
`resend: true`, gravar `profiles.pwd_changed_at = now()` e chamar
`auth.admin.signOut(user_id, 'global')`, do mesmo jeito que o `reset-complete` faz.

Esse caminho **não** precisa do desafio de dois fatores (quem está agindo é um admin autenticado
com poder, não a própria pessoa provando identidade) — só precisa do efeito colateral de derrubar
sessão.

### 2. Anti-enumeração não está explícita para `reset-confirm-*` (achado menor)

`spec.md` FR05 e a resolução da tensão FR02×FR05 no `plan.md` cobrem bem o `reset-start`
(T004/T007). Mas `tasks.md` T008 não deixa explícito que `reset-confirm-email`/
`reset-confirm-whatsapp` devem devolver a mesma mensagem genérica de erro tanto para
"challenge_id não existe" quanto para "código errado" — mesmo padrão que o `login-verify` já usa
(constante `INVALID` única). Sem isso, uma resposta diferente para "desafio não existe" vazaria
informação que o resto do desenho tenta esconder.

### 3. Duas decisões de implementação ficaram sem número definido (não-bloqueante)

- Tamanho mínimo da nova senha: `plan.md` menciona manter 6 ou subir para 8 (como a PR #49
  antiga propunha), mas não decide. Hoje o mínimo é 6 (`Login.jsx` atual).
- Limites de taxa exatos do `reset-start` (pedidos por hora/e-mail/IP): `spec.md` FR06 e
  `plan.md`/T003 deixam para decidir na escrita da função, sem um número de referência fixado.

Nenhum dos dois contraria uma regra permanente nem bloqueia o `/implement` — só ficam como
parâmetros a decidir no momento de escrever o código, a menos que você prefira fixar agora.

## Veredito

Spec, plan e tasks são consistentes entre si e com o `CLAUDE.md`, com uma exceção real (achado 1)
que deveria virar uma tarefa nova antes do `/implement`, e um reforço de redação recomendado
(achado 2). Os dois números em aberto (achado 3) podem ser decididos durante a implementação sem
problema.

**Atualização**: todos os 3 achados foram corrigidos no `tasks.md` antes do `/implement` — T010b
cobre o achado 1, T008 cobre o achado 2, T003/T009 fixam os números do achado 3 (senha mínimo 8,
rate limit igual ao 2FA do login).
