---
name: specify
description: Gera a especificação funcional (spec.md) de uma nova funcionalidade do vpsistema a partir do pedido do usuário, sem detalhes técnicos, respeitando as regras permanentes do CLAUDE.md. Use no início de qualquer funcionalidade não trivial, antes de pensar em como implementar.
---

# Specify — gerar a especificação

## Objetivo

Criar um documento de especificação funcional baseado na solicitação do usuário, focando
estritamente no **comportamento do sistema e nas regras de negócio** — sem incluir detalhes
técnicos (tecnologias, frameworks, nomes de tabelas, nomes de componentes React, edge functions
específicas). Tecnologia é assunto do `/plan`, não do `/specify`.

## Passos

1. Leia atentamente o pedido do usuário. Se o pedido já vier com decisões técnicas misturadas
   (ex.: "cria uma tabela X com uma trigger Y"), separe a intenção de negócio da implementação —
   a implementação vai para o `/plan` depois.
2. Leia o `CLAUDE.md` da raiz do repositório — ele é a constituição do projeto. Preste atenção
   especial à seção 7 (regras de negócio permanentes): qualquer requisito que contradiga uma
   regra permanente precisa ser sinalizado na especificação, não silenciosamente ignorado nem
   silenciosamente aceito.
3. Descubra o próximo número de pasta em `specs/` (sequencial, 3 dígitos) e crie
   `specs/NNN-nome-curto-da-feature/spec.md` (ver `specs/README.md` para a convenção de
   nomenclatura).
4. Gere o `spec.md` neste formato:

```markdown
# Especificação: [Nome da Funcionalidade]

## Contexto e Objetivo
- Qual problema está sendo resolvido e o valor para quem usa o vpsistema (colaborador,
  administrador, CEO, sistema satélite).

## Requisitos Funcionais (FR)
- [FR01]: ...
- [FR02]: ...

## Regras de Negócio
- Regras específicas desta funcionalidade. Se alguma interage com uma regra permanente do
  CLAUDE.md (seção 7), cite explicitamente qual e como.

## Fora do Escopo (Out of Scope)
- O que NÃO será feito nesta versão.

## Cenários de Aceitação
- Dado que... Quando... Então...
```

5. Escreva tudo em português, como o resto do repositório.
6. Não avance para `/plan` sozinho — o próximo passo é sempre `/clarify`, mesmo que a
   especificação pareça completa.
