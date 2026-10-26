# Esclarecimentos: Recuperação de Senha com Segundo Fator

## P1: O convite de um colaborador novo (link por e-mail pra definir a 1ª senha) também passa a exigir confirmação por WhatsApp?
Resposta: Sim — mesmo nível de segurança do login/recuperação. O convite passa a exigir que o
colaborador já tenha celular cadastrado.

## P2: Contas "legacy" (sem 2FA no login) ou "isentas" (uso compartilhado/automação) também exigem WhatsApp pra recuperar a senha?
Resposta: Sim, sempre — mesmo quem ainda não tem 2FA ativo no login precisa de celular cadastrado
para recuperar a senha. Isso força indiretamente a migração para o 2FA completo.

## P3: Quando um admin usa "Reenviar credenciais" (redefine a senha de outra pessoa na tela de Administração), isso também deve derrubar as sessões já abertas dessa conta?
Resposta: Sim — mesmo comportamento do FR03. Qualquer troca de senha (pelo próprio usuário via
recuperação, ou por um admin via "Reenviar credenciais") derruba sessões já abertas da conta.

## P4: Derrubar as sessões (FR03) deve alcançar também as sessões já abertas nos sistemas satélite, ou só a sessão do próprio vpsistema?
Resposta: Só o vpsistema por agora. Cascatear a derrubada para os satélites é trabalho adicional
significativo (cada um tem seu próprio ciclo de sessão) e fica fora do escopo desta feature.
