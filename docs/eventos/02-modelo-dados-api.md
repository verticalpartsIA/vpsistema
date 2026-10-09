# Central de Eventos: Etapa 2, Modelo de dados e API (proposta para revisão)

Status: **rascunho**. Nada foi aplicado em banco. O SQL de referência está em `docs/eventos/sql/central_eventos.sql`
e fica fora de `supabase/migrations` de propósito, para não ser executado por engano.

## 1. Decisões de arquitetura

| Tema | Decisão |
|---|---|
| Onde fica | Projeto Supabase do portal (`vpsistema`), schema próprio `eventos`, sem misturar com `public`. |
| Quem acessa | Origens só chamam a API de ingestão. Elas nunca leem nem escrevem nas tabelas. A interface lê por RLS (perfil admin) e por RPCs. |
| Desacoplamento | A origem grava o evento e segue. Se a Central estiver fora, a origem guarda localmente (outbox) e reenvia. A Central nunca bloqueia a operação da origem. |
| Processamento | Dois estágios assíncronos: (1) evento → regras → `envios` (fila); (2) worker envia cada `envio` pelo canal. Ambos via `pg_cron` + edge function, com `FOR UPDATE SKIP LOCKED`. |
| Duplicidade | `unique(origem, idempotency_key)` no evento e `unique(evento_id, regra_id, destinatario_id, canal)` no envio. |
| Convivência com o legado | Cada gatilho migrado tem `modo`: `sombra` (Central registra e simula, sem enviar), `ativo` (Central envia) e `desligado`. O mecanismo antigo só é desligado depois de um período em `sombra` sem divergência. |
| Regra de negócio | Fica na origem. A Central só decide **como e para quem comunicar**. |
| Segredos | Chaves de canal e de origem no Vault. Nenhuma credencial em texto claro nem em corpo de função. |

## 2. Modelo de dados (schema `eventos`)

```
origens ──< catalogo_gatilhos ──< regras >── templates
   │              │                 │
   └──< eventos ──┴─────────────────┤
          │                         ▼
          └──────────────< envios >── destinatarios (pessoa | papel | departamento | grupo | externo)
                              │
                              └──< tentativas
auditoria (append-only, referencia tudo)
```

| Tabela | Finalidade | Campos principais |
|---|---|---|
| `origens` | Sistemas que publicam | `id`, `slug` (ex.: `vprequisicoes`), `nome`, `ativo`, `chave_hash` (hash da chave de API), `chave_ultima_rotacao`, `segredo_hmac_ref` (referência ao Vault) |
| `catalogo_gatilhos` | Tipos de evento conhecidos | `origem_id`, `tipo` (`requisicao.aprovada`), `descricao`, `schema_payload` (JSON Schema), `ativo`, `modo` (`sombra`/`ativo`/`desligado`), `legado_ref` (qual mecanismo antigo equivale) |
| `eventos` | Tudo que foi recebido | `id`, `origem_id`, `tipo`, `idempotency_key`, `ocorrido_em`, `recebido_em`, `ator` (quem causou), `entidade_tipo`, `entidade_id`, `payload` (jsonb), `status` (`recebido`/`processado`/`sem_regra`/`erro`), `correlacao_id` |
| `templates` | Texto por canal e idioma | `id`, `canal`, `idioma`, `assunto`, `corpo` (com `{{variaveis}}`), `versao` |
| `regras` | Quando, como e para quem enviar | `gatilho_id`, `ativa`, `condicao` (jsonb, ex.: valor acima de X), `canais` (lista), `template_id`, `destino` (jsonb: papel, departamento, campo do payload), `janela_envio` (horário comercial), `atraso_segundos`, `prioridade` |
| `destinatarios` | Pessoas e contatos externos | `id`, `tipo` (`pessoa`/`externo`), `perfil_id` (opcional), `nome`, `whatsapp`, `email`, `ativo`, `aceita_whatsapp`, `aceita_email` |
| `grupos` / `grupo_membros` | Papéis, departamentos e listas | `slug`, `tipo` (`papel`/`departamento`/`lista`), membros |
| `canais` | Configuração por canal | `slug` (`whatsapp`, `email`, `interno`), `ativo`, `config_ref` (Vault), `limite_por_minuto`, `intervalo_min_ms` |
| `envios` | Fila persistente | `evento_id`, `regra_id`, `destinatario_id`, `canal`, `status` (`pendente`/`processando`/`enviado`/`falha`/`descartado`/`cancelado`), `agendado_para`, `tentativas`, `proxima_tentativa_em`, `mensagem_renderizada`, `motivo_descarte` |
| `tentativas` | Uma linha por tentativa de envio | `envio_id`, `iniciada_em`, `resultado`, `http_status`, `erro`, `id_externo` |
| `auditoria` | Trilha imutável | `quando`, `ator`, `acao`, `objeto`, `antes`, `depois` (mudanças de regra, gatilho, canal, reenvio manual) |

Regras de projeto:
- `envios` e `tentativas` **nunca** guardam telefone completo nos logs de tela. A interface mascara por padrão.
- `eventos.payload` não deve carregar dados sensíveis além do necessário. O JSON Schema do gatilho define o que é aceito.
- Retenção: eventos e envios por 12 meses (configurável), depois arquivados.
- Sem destinatário (ex.: perfil sem WhatsApp), o envio vira `descartado` com `motivo_descarte='sem_contato'` e aparece em **Falhas**. Não é mais perda silenciosa.

## 3. API de ingestão

`POST /functions/v1/eventos-ingest`, uma edge function com `verify_jwt=false` e autenticação própria.

**Autenticação (por origem):**
- Cabeçalho `X-Origem: vprequisicoes`.
- `X-Assinatura: sha256=<HMAC do corpo bruto com o segredo da origem>`, mais `X-Timestamp` (rejeita se a diferença passar de 5 minutos).
- Chaves separadas por origem, rotacionáveis, guardadas como hash. Origem inativa recebe 403.

**Corpo:**
```json
{
  "tipo": "requisicao.aprovada",
  "idempotency_key": "req-1234-aprovada-v1",
  "ocorrido_em": "2026-10-09T14:03:11Z",
  "ator": { "email": "gestor@verticalparts.com.br" },
  "entidade": { "tipo": "requisicao", "id": "1234", "numero": "REQ-0456" },
  "payload": { "valor_total": 18250.0, "departamento": "Compras", "requisitante_email": "x@verticalparts.com.br" }
}
```

**Respostas:**

| Status | Significado |
|---|---|
| `202` | Aceito (corpo traz `evento_id`). Se a `idempotency_key` já existe, devolve `200` com o mesmo `evento_id`, sem reprocessar. |
| `400` | Corpo inválido ou fora do JSON Schema do gatilho. |
| `401` / `403` | Assinatura inválida, timestamp fora da janela ou origem inativa. |
| `404` | Tipo de evento desconhecido (opção `auto_registrar=false` por padrão: gatilho novo precisa estar no catálogo). |
| `429` | Limite por origem excedido (`Retry-After`). |

Garantias: gravação síncrona do evento e resposta em poucos ms. Nada de envio dentro da requisição.

**Contrato para a origem (outbox):** a origem grava o evento numa tabela local `outbox_eventos` na mesma transação da mudança de negócio e um job local envia com retry. Assim a falha da Central não perde evento nem trava a operação.

**Outras rotas (autenticadas por JWT, perfil admin):**
- `GET /eventos`, `GET /eventos/:id` (monitor e rastreio por entidade, ex.: "quem foi avisado sobre a P.I. X").
- `POST /envios/:id/reenviar`, `POST /envios/:id/cancelar`.
- `PATCH /gatilhos/:id` (liga, desliga e troca `modo`), `CRUD /regras`, `CRUD /grupos`, `PATCH /canais/:slug`.
- `GET /metricas?de=&ate=` para o Painel Geral e o Painel Executivo.

## 4. Processamento

1. **Roteador** (`pg_cron` a cada minuto ou gatilho por inserção): para cada evento `recebido`, acha as regras ativas do tipo, avalia a `condicao`, resolve os destinatários (papel e departamento viram pessoas), renderiza o template e cria os `envios`. Se o gatilho está em `sombra`, grava os `envios` com status `simulado` e não envia. Evento sem regra vira `sem_regra`.
2. **Worker de envio** (edge function, a cada minuto): pega lote com `SKIP LOCKED`, respeita `janela_envio`, o limite do canal e o intervalo mínimo entre mensagens (hoje o portal usa 2 a 3 s no broadcast). Registra a `tentativa`. Erro transitório reagenda com backoff (1, 5, 15, 60 minutos, no máximo 5). Erro permanente (número inválido) vai direto para `falha`.
3. **Reenvio manual** pela tela de Falhas cria nova tentativa sobre o mesmo `envio`, sem duplicar a mensagem lógica.
4. **Canal WhatsApp:** a Evolution API, com a URL e a chave vindas do Vault. Um único adaptador substitui os envios espalhados nos sistemas.
5. **Canal interno:** entregue pelo adaptador do sistema de destino (seção 6.1), registrado como `interno:<sistema>`.

## 5. Mapeamento inicial (primeiros gatilhos, todos em `sombra` primeiro)

| Origem | Evento publicado | Equivale a (legado) | Canais |
|---|---|---|---|
| `vprequisicoes` | `requisicao.criada`, `.ciencia_ok`, `.reprovada_gestor`, `.cotada`, `.aprovada`, `.reprovada`, `.comprada`, `.recebida` | 14 estágios do `notifyWhatsappStage` | WhatsApp, interno |
| `vprequisicoes` | `requisicao.sla_vencida` | cron SLA a cada 4h | WhatsApp |
| `vphub` | `decisao.pendente`, `decisao.resolvida` | `whatsapp-notify` (órfão) e alerta T1/J1 | WhatsApp, interno |
| `posvenda360` | `nf.emitida_classe_a` | VIP follow-up | WhatsApp |

O restante entra depois, um sistema por vez, seguindo o inventário.

## 6. Decisões tomadas

| # | Tema | Decisão |
|---|---|---|
| 1 | Hospedagem | Schema `eventos` no projeto Supabase do portal (`vpsistema`). |
| 2 | Destinatários | Baseados em `profiles` do portal, mais contatos externos. `destinatarios.perfil_id` aponta para `profiles`. |
| 3 | Notificação interna | Cada sistema mantém a sua caixa (alertas/VP Click), **entregue pela Central por um adaptador por sistema** (ver 6.1). |
| 4 | Período em `sombra` | 7 dias úteis sem divergência antes de desligar o mecanismo antigo. |
| 5 | E-mail | Fora da primeira fase. A tabela `canais` já prevê `email`, desativado. |

### 6.1 Notificação interna: como fazer bem

Manter a caixa de cada sistema é uma boa prática, desde que a Central **não grave direto nas tabelas dos outros sistemas**. Isso exigiria credencial de cada banco dentro da Central e criaria acoplamento por esquema.

O desenho recomendado é um **adaptador de entrega por sistema**:
- Cada sistema expõe um ponto de entrada mínimo e autenticado, por exemplo a RPC ou edge function `receber_notificacao_central`.
- Esse ponto grava na caixa local (`alertas` no HUB, notificações no VP Click, etc.), já com o destinatário individual, e devolve o id local.
- A Central registra esse envio como qualquer outro canal: canal `interno:<sistema>`, com tentativa, resultado e retry.
- Cada sistema decide como exibir. A Central decide quem recebe e garante registro, deduplicação e auditoria.

Vantagens: a experiência de cada sistema não muda, o log fica num lugar só, e o fim dos alertas "globais" vira uma regra de destinatário na Central. Mais tarde, um canal `interno:portal` pode oferecer uma caixa única sem refazer nada.

## 7. Fora do escopo desta etapa

Interface `/eventos` (etapa 3), integração dos sistemas (etapa 4) e correção das credenciais expostas (tratada à parte, fora deste repositório público).
