# gi-avisos — regras dos avisos de WhatsApp do fluxo (VP Gestão)

> Documento de referência para as sessões do Claude e para a equipe. Atualizado em 23/10/2026.
> Este repositório é público: aqui não vão telefones, e-mails pessoais, chaves nem detalhes de acesso.

## O que é
O **gi-avisos** é o serviço que avisa por WhatsApp a pessoa que precisa agir na próxima etapa do fluxo do VP Gestão
(cotação, precificação, proposta, contrato, importação, instalação). O Claude redige o texto; a Evolution é só o transporte.

- Roda na VPS da empresa como serviço `gi-avisos.service` (Node.js), com repositório git **local** na própria VPS
  (não há cópia no GitHub).
- **Origem dos avisos:** o HUB (VP Gestão) publica tudo na Central de Eventos do vpsistema como `hub.aviso_fluxo`
  (alertas, gatilhos de etapa, eventos do fluxo, respostas de fornecedor e assinaturas). O gi-avisos só lê dali.
- **Registro:** cada decisão por destinatário (enviado, na fila, agrupado, pausado, encerrado, sem número, autor,
  sem regra, erro) é anotada em `eventos.entregas_externas`, no vpsistema.
- **Telefones:** a fonte oficial é o cadastro do vpsistema (celular do perfil). Montadores externos são a exceção:
  o número vem no próprio aviso.
- O **RFQ ao fornecedor não passa pelo gi-avisos**: continua saindo na hora, pelo HUB.

## Janela de envio (horário em que as mensagens podem sair)
Configurada no arquivo `janela.json` do gi-avisos, relido a cada varredura (mudar o horário não exige reiniciar).

| Para quem / o quê | Dias | Horário (Brasília) |
|---|---|---|
| **Padrão** (todos os avisos) | seg–sex, exceto feriados | 07:00–18:00 |
| **Financeiro (Juliana) — Precificação** | seg–sex, exceto feriados | **09:30–17:30** |

- "Precificação" = pedido para precificar (etapa de Precificação nasceu), fornecedor respondeu (cotação pronta para
  precificar) e cobrança/escalonamento do prazo da Precificação. Os demais avisos da Juliana seguem o padrão.
- Fora da janela o aviso **espera na fila** e sai na próxima abertura da janela dele (ex.: precificação que chega às
  18:00 de sexta sai na segunda às 09:30). Se o assunto for resolvido no HUB enquanto espera, o aviso não sai.
- **Prazos x envio são calendários separados:** os prazos (SLA) são calculados pelo HUB; a janela acima só decide
  quando a mensagem sai.
- Feriados: lista nacional (+20/11) até 2027 no próprio gi-avisos. Feriados municipais não estão incluídos.
- Interruptor: `"ativa": false` no `janela.json` desliga as janelas (envia a qualquer hora). Arquivo ausente ou
  inválido volta ao padrão.

## Quem recebe (fluxo comercial)
| Evento | Recebe |
|---|---|
| Formulário preenchido (cotação nova) | Comercial (Regiane: seguir com a precificação; Guilherme e ADM do Comercial: acompanhar) |
| Fornecedor respondeu | vendedor que enviou a cotação + Financeiro (precificar) |
| Precificação nasceu | Financeiro (precificar) + ADM do Comercial (acompanhar) |
| Precificação vencida / escalonada | Financeiro / CEO |
| Precificação concluída | vendedor (montar e enviar a proposta) + Regiane (liberar o envio) + ADM do Comercial |
| Proposta enviada / revisada reenviada ao cliente | ADM do Comercial |
| Lead cadastrado / Cliente cadastrado | ADM do Comercial (conferir o cadastro) |
| "Cotação enviada ao fornecedor" | ninguém (decisão de 17/10/2026) |

- ADM do Comercial = Victoria (desde 23/10/2026): só acompanha, sem cobrança de prazo, e nada depois da proposta.
- Quem fez a ação não recebe o próprio aviso. Valores (R$) só aparecem para CEO, Financeiro e Gelson.

## Agrupamento (para não repetir o mesmo aviso)
- Avisos de origem `alertas` com o mesmo título (sem números, acentos e pontuação; 60 caracteres) + nº da cotação
  vão **uma vez por pessoa a cada 24 h**; os repetidos ficam como "agrupado".
- **Nunca agrupam:** avisos de decisão (`decisao_tipo` preenchido, ex.: aval do CEO) e do Contrato do Instalador
  (`alerta_id` começando com `ci-envio-`, `ci-assinado-` ou `ci-lembrete-`).
- O mesmo evento nunca sai duas vezes para a mesma pessoa (chave = `idempotency_key` + destinatário).

## Assinaturas e montador externo
- Assinatura em sequência (Contratado → CEO → Testemunhas): cada pessoa recebe o link na sua vez.
- **Montador sem e-mail:** recebe direto no telefone enviado no aviso (`destinatarios: [{ nome, telefone, externo: true }]`),
  com texto fixo (sem IA) e o link `https://hub.vpsistema.com/assinar/<código>`. Com `"lembrete": true` (booleano),
  o texto começa com "Lembrete: ". Telefone com menos de 12 dígitos não é enviado.
- A entrega ao montador fica só no log local do gi-avisos (a tabela de entregas exige e-mail).

## Pausas
Cada pessoa pode pausar o WhatsApp (tudo ou por assunto) em vpsistema.com/eventos/destinatarios.
Pedidos de assinatura nunca são pausados.

## Pendências conhecidas
- `clientes.criado_por` vazio no HUB: o aviso de "Cliente cadastrado" sai sem o nome do vendedor até o app gravar quem cadastrou.
- Entregas a destinatários sem e-mail (montadores) não aparecem em `eventos.entregas_externas`.
- Exceções de horário para aval do CEO e assinaturas: em avaliação (hoje seguem a janela padrão).

## Histórico
| Data | Mudança |
|---|---|
| 22/10/2026 | gi-avisos versionado em git local; decisões (`decisao_tipo`) deixam de ser agrupadas |
| 23/10/2026 | montador externo por telefone; `ci-envio-`/`ci-assinado-`/`ci-lembrete-` sem agrupamento; prefixo "Lembrete:"; ADM do Comercial nas etapas comerciais; janela configurável com Financeiro/Precificação 09:30–17:30 |
