# Central de Eventos: Etapa 1, Inventário de gatilhos

Levantamento somente leitura (2026-10-09) de VP Requisições, VP Pós-Venda 360, VP HUB e do próprio portal.
Itens marcados **(?)** não foram confirmados. Nenhum segredo nem detalhe de vulnerabilidade está reproduzido aqui (o repositório é público).

## 1. Visão geral

| Sistema | Repo / Supabase | Canais reais | Log de envio | Retry | Idempotência |
|---|---|---|---|---|---|
| VP Requisições | `003_requisicoes` / `vprequisicao` | WhatsApp (Evolution `pv360`), tarefas no VP Click | `whatsapp_notification_log`, `sla_notifications`, `audit_logs` | não | só no SLA |
| Pós-Venda 360 | `004_sac_posvenda360` / `vpposvenda360` | WhatsApp (Evolution `pv360`), VP Click (trigger `pg_net` e API) | `sac_logs_comunicacao` (só VIP e pesquisa) | não | quase nenhuma |
| VP HUB | `010_GestaoImportacao` / `vpprd` | Alerta interno (`alertas`, canal dominante), e-mail SMTP (manual), WhatsApp manual `wa.me`; WhatsApp automático existe mas está órfão | `emails_projeto`, `notificacoes_lidas`, `whatsapp_notification_log` (3 linhas de teste) | só `fluxo_pendentes` (5 tentativas) | boa nos triggers e crons, fraca no front |
| Portal (vpsistema) | `vpsistema` / `vpsistema` | WhatsApp (2FA, primeiro acesso, broadcast agendado), e-mail de recuperação e convite | tabelas de tentativas e `scheduled_broadcasts` | não **(?)** | tokens de uso único |

Padrões comuns: mesma instância Evolution `pv360` usada por pelo menos 3 sistemas, VP Click como canal interno, e regra "quem é o destinatário" reimplementada em cada sistema.

## 2. VP Requisições

Fluxo: GESTOR → ABERTO → COTAÇÃO → APROVAÇÃO → COMPRA → RECEBIMENTO → CONCLUÍDO (ou REJEITADO).

| Estágio (log) | Evento | Destinatário | Canal |
|---|---|---|---|
| LIDER_CIENCIA | requisição criada | `approver_id` do requisitante, senão `department_managers` | WhatsApp |
| REQUISITANTE_CRIADA | idem | requisitante | WhatsApp |
| COMPRADOR_COTAR | gestor deu ciência | role `cotador` | WhatsApp |
| REQUISITANTE_CIENCIA_OK / _REPROVADO_GESTOR | decisão do gestor | requisitante | WhatsApp |
| APROVACAO_PENDENTE | cotação finalizada | role `aprovador` por faixa de valor (`settings`) | WhatsApp, com link rápido de uso único |
| REQUISITANTE_COTADO / _APROVADO_FINANCEIRO / _REPROVADO_FINANCEIRO / _APROVADO_PARCIAL | andamento | requisitante | WhatsApp |
| COMPRA_APROVADA | aprovação concedida | role `comprador` | WhatsApp |
| REQUISITANTE_COMPRADO | compra confirmada | requisitante | WhatsApp |
| EXPEDICAO_RECEBIMENTO / REQUISITANTE_RECEBIDO | material chegou | role `expedicao` e requisitante | WhatsApp |
| REQUISITANTE_SLA_VENCIDO | etapa além da meta (GESTOR 24h, COTAÇÃO 72h, APROVAÇÃO 72h, COMPRA 48h, RECEBIMENTO 168h) | requisitante | WhatsApp via `pg_cron` a cada 4h |
| Tarefas VP Click (V1, V2, V3, V4, V5, GESTOR_URGENT) | mudança de etapa | papéis de `user_roles`, casados com o VP Click por e-mail | tarefa interna |

Achados:
- Os envios do app saem do front (`notifyWhatsappClient`). Se a aba fechar, perde-se a mensagem. **(?)** Os pontos exatos de chamada não foram lidos.
- No SLA, "sent" significa só "enfileirado em `net.http_post`".
- 21% dos avisos de SLA (45 de 215) foram descartados por falta de `whatsapp_number` (8 de 41 perfis sem número).
- Pontos de segurança desta área foram registrados fora deste repositório público.
- Links de aprovação por WhatsApp em texto simples. Domínio do SLA difere do domínio do app.

## 3. VP Pós-Venda 360

| # | Evento | Destinatário | Canal | Log |
|---|---|---|---|---|
| 1 | NF classe A emitida (VIP) | cliente (`sac_clientes`) | WhatsApp | `sac_logs_comunicacao` |
| 2 | Pesquisa NPS (manual pela UI) | cliente | WhatsApp | `sac_logs_comunicacao` |
| 3 | Handoff vencido (cobrança) | `handoffs.responsavel_tel` | WhatsApp (cron externo no VPS) | só o status do handoff |
| 4 | Mensagem de cliente, auto-resposta da IA | o próprio cliente | WhatsApp | `whatsapp_messages` |
| 5 | Mensagem de cliente, alerta ao time | destino de `NOTIFY_URL` **(?)** | webhook | nenhum |
| 6 | Operador envia pela UI | cliente | WhatsApp | `whatsapp_messages` |
| 7 | Ticket criado ou alterado | decidido no VP Click **(?)** | trigger `pg_net` | nenhum (`net._http_response` vazia) |
| 8 | Ticket interno criado | líder do departamento, por e-mail fixo no SQL | trigger `pg_net` para o VP Click | nenhum |
| 9 | NF faturada, tarefa Expedição | time `VC_TEAM_EXPEDICAO` (UUID fixo) | VP Click | `vpclick_integration_links` |
| 10 | Divergência na expedição | tarefa vinculada | comentário no VP Click | parcial |
| 11 | Atendimento concluído | tarefa vinculada | status no VP Click | nenhum |
| 12 | Observação e anexos de volta ao Omie | pedido no Omie | API Omie | parcial |
| 14 | Convite de usuário | e-mail informado | Supabase Auth | nenhum |

Não são mensagens: o sync de clientes a cada 2h (item 13 do relatório) e o sync de faturamento.

Achados:
- O VIP não checa "já enviado". Uma reentrega do webhook do Omie repete a mensagem ao cliente.
- A pesquisa marca `pesquisa_enviada=true` mesmo quando o envio falha.
- `notify_vpclick_interno` não trata exceção e pode derrubar o INSERT do ticket.
- Pontos de segurança desta área foram registrados fora deste repositório público.
  - O webhook do Omie aceita payload sem `appKey`.
- **(?)** Edge functions `pv360-delivery-event`, `mcp-server` e `omie-sync-nfs`, o arquivo `ai/index.mjs` e o cron externo de handoff não foram lidos.

## 4. VP HUB (hub.vpsistema.com, repo `010_GestaoImportacao`, banco `vpprd`)

Canal dominante: tabela `alertas` (Central de Notificações). Destinatário nulo significa alerta global para todos.

**Triggers SQL**

| # | Evento | Destinatário |
|---|---|---|
| T1 | Decisão pendente criada (8 tipos) | `aprovadores_esperados` |
| T2 | Proposta aprovada (abre avais) | global |
| T3 | Avais Financeiro e Jurídico OK | global |
| T4 | Cliente devolveu formulário | `created_by` |
| T5 | E-mail de entrada vinculado a cotação | dono, ou criador do formulário |
| T6 | E-mail sem vínculo com prioridade alta (IA) | global |
| T7 | Projeto de instalação assinado ou recusado | quem enviou, mais líderes de Engenharia |
| T8 | Todos os projetos assinados | fila `fluxo_pendentes` |
| T9 | Assinatura, recusa ou revisão pública (proposta, contratos) | global |

**Crons `pg_cron`**: C1 prazos vencidos, C2 inbox sem resposta (2h e 4h úteis), C3 inbox adiados, C4 rastreio de navio, C5 chegada de navio, C6 PCP compras, C7 PCP expedição, C8 PCP varejo, C9 expiração de alertas, C10 expiração de decisões órfãs.
Via edge function: E1 `alerta-pcp-compras`, E2 `alerta-pcp-prazos`.

**Front (JS grava em `alertas`)**: J1 a J11. Entre eles, J9 envia a e-mails fixos (`arilene.avila@` e `bianca@`) e J7 promete avisar o líder/CEO mas grava alerta global.

**E-mail SMTP (`send-email`)**: M1 RFQ ao fornecedor, M2 proposta, M3 contrato de venda, M4 contrato de instalador, M5 projeto de instalação, M6 desenho anexo, M7 tratativa, M8 inbox. Todos são disparados por ação do usuário no navegador, não por cron nem trigger.

**WhatsApp**: W1 `wa.me` manual, sem log real. W2 `whatsapp-notify` (Evolution), aparentemente **órfão**: nenhum código o chama e o log tem só 3 linhas de teste (21/09). Esse é o ponto de partida natural para a Central.

Achados:
- Erros de alerta são engolidos em T1, T4, T5 e T6 (`exception when others then null`).
- Idempotência fraca em T4, T9, J1 a J6 e J10 (id com uuid ou timestamp).
- Possível duplicidade proposta/contrato: banco (`_pp_efeitos`, `_cv_efeitos`, `_ci_efeitos`) e front (J2 a J4) cobrem o mesmo evento. Não confirmado em dados.
- `fluxo_pendentes` só é processada com um usuário interno logado (a cada 30s no navegador).
- Alertas globais demais, sem escopo de privacidade (inclui Aval Jurídico e estouro de teto).
- Hardcodes:
  - "CEO (Diego)" no texto dos avais.
  - Fallback para o domínio antigo `vpgestaoimportacao.vpsistema.com`.
  - O workflow de deploy no GitHub aponta para o site antigo **(?)**.
- Pontos de segurança desta área foram registrados fora deste repositório público.

## 5. Portal (vpsistema), levantamento parcial

Edge functions com envio: `whatsapp-login-request` e `whatsapp-login-verify`, `login-start` e `login-verify` (2FA por WhatsApp), `whatsapp-first-access`, `provision-whatsapp-access`, `send-broadcast` (disparos agendados via `pg_cron`, 2 a 3 s entre mensagens), `send-recovery-email`, `invite-user`.
O WhatsApp passa por `_shared/whatsapp.ts` (Evolution v2, config em secrets). **(?)** Falta ler cada função com o mesmo detalhe dos outros sistemas.

## 6. Síntese para o desenho da Central

1. **Cerca de 60 pontos de disparo** hoje, sem catálogo único: ~14 WhatsApp e 1 SLA em Requisições, ~14 em Pós-Venda, ~40 no HUB.
2. **Quatro "tipos" de gatilho aparecem**:
   - evento de negócio por mudança de status (trigger ou app);
   - evento por tempo (SLA e crons);
   - webhook externo (Omie, WhatsApp);
   - ação manual do operador.
   O contrato `sistema.entidade.acao` cobre os quatro.
3. **Destinatário** hoje é: papel em `user_roles`, líder de departamento, `approver_id`, e-mail fixo no código, "global" ou o próprio cliente. A tabela de destinatários da Central precisa aceitar pessoa, papel, departamento, líder do departamento e contato externo.
4. **Pré-requisito de segurança:** tratar os achados de segurança (registrados fora deste repositório) antes de integrar cada sistema.
5. **Candidatos à primeira migração**:
   - `whatsapp-notify` do HUB (órfão, sem duplicidade possível);
   - SLA do VP Requisições (já é 100% no banco, com idempotência);
   - VIP do Pós-Venda, que ganha a deduplicação que hoje não tem.

## 7. Complementos (segunda rodada)

### 7.1 VP Requisições: pontos de chamada
Cada ação do usuário dispara `notifyWhatsappClient` e `notifyVpClickClient` sem esperar resposta. Criar requisição (produtos, frete, manutenção, locação, serviços, viagens) dispara LIDER_CIENCIA e a tarefa V1. Aprovação ou reprovação do gestor (`approval.tsx`), confirmação do vencedor (`quoting.tsx`), decisão financeira (`approval.tsx` e `aprovar.$token.tsx`), compra (`purchasing.tsx`) e recebimento (`receipt.tsx`) completam o fluxo. O e-mail de redefinição de senha é do Supabase Auth.

### 7.2 Pós-Venda 360: itens novos
- Ferramenta `avisar_departamento` da IA avisa fones de departamento fixos no código e cria o `handoff`. O cron do VPS roda a cada 15 minutos.
- `sac-engine.ts` também dispara o alerta de atraso e o follow-up VIP, além do NPS.
- `pv360-delivery-event` atualiza a tarefa no VP Click ao salvar a expedição **(?)**. `omie-sync-nfs` e `mcp-server` não enviam mensagem.

### 7.3 VP Click (`005_vpclick`)
| Evento | Origem | Destinatário | Canal | Log |
|---|---|---|---|---|
| Eventos dos outros sistemas (`handle-integration-event`) | triggers de banco do Pós-Venda e de Propostas | responsável por lista ou departamento | tarefa interna (sem mensagem externa) | tarefa |
| Observador adicionado, menção, tarefa concluída | triggers → `whatsapp-notify-event` | observador, mencionado, criador | WhatsApp via gateway, em template | `notification_dispatch_log` |
| Cobrança reativa, resumo diário e inatividade | motor legado na VPS (cron a cada 15 min e diário às 07:00) | usuários ativos com telefone | WhatsApp | **(?)** scripts não lidos |
| PIN de 2FA | edge function `send-2fa-pin` | usuário | e-mail SMTP | `auth_pins` |

Achados:
- O caminho novo de WhatsApp está em **dry-run** (só há registros simulados desde 19/09). O motor legado cobre os mesmos eventos, então ligar o envio real sem desligar o legado duplicaria as notificações.
- Candidato direto à Central: unificar esses dois motores num só.

### 7.4 Outros sistemas (triagem)
| Sistema | Gatilhos de mensagem | Canal | Log |
|---|---|---|---|
| Propostas (`002`) | PIN de login; trigger que cria tarefa no VP Click | e-mail | nenhum |
| Visitas e Brindes (`006`) | pedido de kit para um e-mail interno fixo; trigger para o VP Click | e-mail SMTP | nenhum |
| Catraca (`007`) | nenhum no código do repo; triggers de banco **(?)** | n/a | n/a |
| Gente e Gestão (`17`) | `whatsapp-dispatcher` recebe tudo da instância compartilhada, mostra menu e repassa ao Pós-Venda; `whatsapp-send` e `whatsapp-start` para o RH | WhatsApp | `contratacao_whatsapp_*` |
| Escamax Compras (`011`) | aprovação de pedido por nível, aprovação do diretor, serviço aguardando CEO, código de acesso | WhatsApp e e-mail | auditoria `whatsapp.aviso_*` e logger |

Observação importante para a Central: **a instância de WhatsApp é única e compartilhada por Requisições, Pós-Venda, Gente e Gestão, Escamax, VP Click e portal.** O roteamento das respostas recebidas (hoje feito pelo dispatcher do Gente e Gestão) precisa ser considerado no desenho do canal.

## 8. Pendências para fechar o inventário

- Ler os scripts de cron da VPS (acesso negado ao agente) e as flags de runtime (`CLAUDE_AUTO_REPLY`, `WHATSAPP_REAL_SEND`, `NOTIFY_URL`).
- Confirmar triggers de banco da Catraca, de Visitas e de Gente e Gestão.
- Borderô diário (repo `008`): canal e destinatários desconhecidos.
- `pv360-delivery-event`, `whatsapp-start` do Gente e Gestão, `summarize-meeting` e `ask-ai`.
