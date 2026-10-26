# Especificação: Recuperação de Senha com Segundo Fator

## Contexto e Objetivo

Hoje o login do vpsistema exige e-mail + senha **e** um código por WhatsApp (2FA real, imposto
no servidor) — mas a recuperação de senha ("Esqueceu a senha?") só exige acesso à caixa de
e-mail. Isso cria um elo mais fraco: quem comprometer só o e-mail de um colaborador consegue
trocar a senha dele e, a partir daí, logar normalmente — efetivamente contornando a proteção que
o 2FA do login foi construído para garantir.

Objetivo: exigir a mesma dupla confirmação (e-mail + WhatsApp) para trocar a senha de uma conta,
igualando o nível de segurança da recuperação ao do login, sem deixar ninguém irremediavelmente
sem acesso — quem não tem celular cadastrado precisa de um caminho alternativo (via
administrador), nunca de um atalho que dependa só do e-mail.

## Requisitos Funcionais (FR)

- [FR01]: Um pedido de recuperação de senha só pode ser concluído depois de confirmar **as duas**
  coisas — um código enviado por e-mail e um código enviado por WhatsApp — para o mesmo pedido.
  Confirmar só uma das duas não é suficiente.
- [FR02]: Se a conta não tiver celular cadastrado, o sistema não pode oferecer nenhum caminho de
  recuperação que dependa só do e-mail. A pessoa é orientada a procurar um administrador (mesmo
  princípio do erro "sem celular" que já existe no login).
- [FR03]: Ao concluir a troca de senha com sucesso, **todo acesso de sessões já abertas daquela
  conta para de funcionar imediatamente** — em qualquer dispositivo, não só o reemissão de token
  (refresh). Não é aceitável que uma sessão aberta antes da troca continue acessando o sistema até
  o token expirar sozinho.
- [FR04]: Um link ou código de recuperação (ou de convite de primeiro acesso) não pode, por si
  só, abrir uma sessão autenticada enquanto a segunda confirmação não tiver sido dada — mesmo que
  o link ainda esteja dentro do prazo de validade.
- [FR05]: A resposta do sistema a um pedido de recuperação é igual para um e-mail que existe e
  para um que não existe na base — sem pista nenhuma sobre a existência da conta (mesma
  convenção antienumeração já usada no login).
- [FR06]: Existem limites de quantos pedidos de recuperação uma mesma conta/IP pode fazer num
  período, e de quantas tentativas de código errado antes do desafio expirar — no mesmo espírito
  das limitações já existentes no login. Os números exatos ficam para o `/plan`.
- [FR07]: Depois de trocar a senha com sucesso, a pessoa precisa entrar pelo fluxo de login normal
  (e-mail + senha + 2FA) — o processo de recuperação não deixa ninguém automaticamente logado.
- [FR08]: O convite de um colaborador novo (link para definir a primeira senha) também exige
  confirmação por WhatsApp antes de ativar a conta — mesmo nível de segurança da recuperação. Um
  convite só pode ser enviado a quem já tem celular cadastrado.
- [FR09]: A exigência de confirmação por WhatsApp na recuperação vale para **toda** conta,
  inclusive contas "legacy" (ainda sem 2FA ativo no login) e "isentas" (uso
  compartilhado/automação) — não existe exceção por tipo de conta.
- [FR10]: Quando um administrador redefine a senha de outra pessoa (ex.: "Reenviar credenciais"
  na tela de Administração), o mesmo efeito do FR03 se aplica: as sessões já abertas daquela
  conta param de funcionar imediatamente.

## Regras de Negócio

- Interage diretamente com a **regra permanente nº1** do `CLAUDE.md` (2FA real acontece no
  servidor, nunca só no client): a confirmação por WhatsApp na recuperação não pode ser decorativa
  no frontend — tem que ser imposta no servidor, do mesmo jeito que o login.
- Interage com a **regra permanente nº2** (sessão nunca é persistida em cache): o processo de
  recuperação não pode, em nenhum momento, abrir uma sessão "de passagem" que fique válida além
  do estritamente necessário para a pessoa definir a nova senha.
- **Decidido em `/clarify` (P1)**: o convite de colaborador novo também exige WhatsApp — ver FR08.
- **Decidido em `/clarify` (P2)**: contas legacy/isentas também exigem WhatsApp na recuperação,
  sem exceção — ver FR09.
- **Decidido em `/clarify` (P3)**: redefinição de senha por um admin ("Reenviar credenciais")
  também derruba sessões abertas, mesmo efeito do FR03 — ver FR10.
- **Decidido em `/clarify` (P4)**: derrubar sessão (FR03/FR10) alcança só o vpsistema, não os
  sistemas satélite — ver seção Fora do Escopo.

## Fora do Escopo (Out of Scope)

- Mudar o mecanismo de 2FA do login em si (`login-start`/`login-verify` já funciona e não deve
  ser tocado).
- Qualquer fluxo de "lembrar este dispositivo" ou equivalente.
- Derrubar sessões já abertas nos sistemas satélite (HUB, VPRequisições etc.) — o FR03/FR10
  alcança só o vpsistema; cascatear para satélites é trabalho futuro, fora desta feature.
- Qualquer mudança no fluxo de convite além de exigir WhatsApp antes de ativar a conta (FR08).

## Cenários de Aceitação

1. **Dado** um colaborador ativo com celular cadastrado, **quando** ele pede recuperação de senha
   e confirma corretamente o código de e-mail e o código de WhatsApp, **então** ele consegue
   definir uma nova senha e precisa fazer login normal (com 2FA) depois.
2. **Dado** um colaborador sem celular cadastrado, **quando** ele pede recuperação de senha,
   **então** o sistema não permite concluir a troca sozinho e orienta a procurar um administrador
   — não existe caminho de "só e-mail".
3. **Dado** um pedido de recuperação em andamento, **quando** a pessoa confirma só o código de
   e-mail (ou só o de WhatsApp), **então** a senha não é trocada e nenhuma sessão é aberta.
4. **Dado** que a senha de uma conta foi trocada com sucesso pela recuperação, **quando** um
   dispositivo que já estava logado com essa conta antes da troca tenta usar o sistema, **então**
   o acesso falha e a pessoa precisa logar de novo.
5. **Dado** um e-mail que não existe na base, **quando** alguém pede recuperação de senha para
   esse e-mail, **então** a resposta do sistema é idêntica à de um e-mail que existe.
6. **Dado** um link de recuperação ou convite ainda dentro do prazo de validade, **quando**
   alguém abre esse link sem completar a segunda confirmação, **então** nenhuma sessão é aberta
   automaticamente só por abrir o link.
7. **Dado** um administrador convidando um colaborador sem celular cadastrado, **quando** ele
   tenta enviar o convite, **então** o sistema não permite até que um celular seja cadastrado.
8. **Dado** um administrador que usa "Reenviar credenciais" para redefinir a senha de outra
   pessoa, **quando** essa redefinição é concluída, **então** as sessões já abertas daquela
   conta param de funcionar imediatamente, do mesmo jeito que numa recuperação feita pela própria
   pessoa.
9. **Dado** uma conta "legacy" (sem 2FA ativo no login) ou "isenta", **quando** essa conta passa
   pelo fluxo de recuperação de senha, **então** ela também precisa confirmar o código de
   WhatsApp — não existe atalho só por e-mail para nenhum tipo de conta.
