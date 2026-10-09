# Roteador e worker de envio

Fecha o ciclo da Central: **evento recebido → envios → entrega**. SQL em `sql/03_roteador_worker.sql`,
função em `supabase/functions/eventos-worker`. Status: **testado em branch, ainda não aplicado em produção.**

## Como funciona

```
evento (recebido) ──rotear_pendentes()──► envios ──eventos-worker──► canal ──► enviado | falha
   (pg_cron, 1 min)   simulado | pendente | descartado   (pg_cron + pg_net, 1 min)
```

1. **Roteador (SQL).** Para cada evento: acha o gatilho, avalia a condição das regras, resolve os destinatários,
   renderiza o modelo (`{{campo}}`) e cria um envio por destinatário e canal. Reexecutar não duplica
   (`unique(evento, regra, destinatário, canal)`).
2. **Destinatários.** Sincronizados dos perfis do portal a cada 15 min. Celular: corporativo, senão pessoal,
   senão o legado; só dígitos com 10 ou 11. `ativo` segue o perfil; `aceita_whatsapp` é escolha do administrador
   e não é sobrescrita.
3. **Worker.** Reserva um lote respeitando o limite por minuto do canal (WhatsApp: 20, com 2 s entre mensagens),
   entrega e registra cada tentativa. Falha temporária: espera 1, 5, 15 e 60 min; na 5ª vira falha. Erro definitivo
   (número inexistente, HTTP 400/404/422) vira falha na hora. 401/403 (chave errada) **não** é culpa da mensagem:
   tenta de novo com espera. Se a Evolution não estiver configurada, o envio volta à fila sem gastar tentativa.
4. **Travados.** Envio "processando" há mais de 10 min volta à fila (ou falha, após 5 tentativas).
5. **Reenvio manual** (aba Falhas): `eventos.reenviar_envio()` confere que é administrador, zera as tentativas e
   grava quem reenviou na auditoria.

## Segurança de operação

- **Modo sombra nunca envia.** Gatilho em `sombra` só gera envios `simulado`. Só `ativo` gera `pendente`.
- Canal desativado, destinatário sem contato ou sem modelo: o envio fica `descartado` com o motivo (aparece em Falhas).
- O worker só responde ao `x-worker-token` (Vault: `eventos_worker_token`). Sem token ou com token errado: 401.
- Telefone nunca aparece inteiro em log; a tela também mascara.

## Para colocar em produção (nesta ordem, por você)

1. Aplicar `sql/03_roteador_worker.sql`. Ele já cria o modelo e a regra do `requisicao.sla_vencida` (em sombra) e
   agenda o roteador e a sincronização. **O agendamento do worker só envia algo depois do passo 3.**
2. Publicar a função `eventos-worker` (`verify_jwt = false`) e conferir os secrets `EVOLUTION_API_URL`,
   `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE` (os mesmos do portal).
3. Cadastrar o token: `select vault.create_secret('<token longo e aleatório>', 'eventos_worker_token');`
4. Com o gatilho em sombra, conferir em `/eventos` (Fila de Envios) os envios `simulado` e comparar com o WhatsApp
   do SLA atual por 7 dias úteis. Só então mudar o modo para `ativo` na aba Catálogo, **e desligar o envio antigo no
   mesmo momento** para ninguém receber duas vezes.

## O que ainda não existe

- Adaptador do canal **interno** (por sistema) e do **e-mail**: o worker marca esses envios como falha definitiva
  com o motivo, em vez de fingir que enviou.
- Tela para criar e editar **regras e modelos**: hoje só por SQL (a regra do SLA já vem pronta).
- O **agendamento `pg_cron`** não rodou na branch (ela não tem a extensão); o mesmo comando foi executado
  manualmente e funcionou. O envio real pela **Evolution** não foi testado: nos testes um eco ocupou o lugar dela.
- O limite de 20 envios por minuto vale para o canal todo, não por sistema.
