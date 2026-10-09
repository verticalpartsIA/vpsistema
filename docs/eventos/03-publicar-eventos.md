# Como um sistema publica eventos na Central

Guia para quem vai integrar um sistema (etapa 4). Contrato completo em `02-modelo-dados-api.md`.

## 1. Cadastrar o segredo da origem (uma vez, por um administrador)

No SQL editor do Supabase do portal. O segredo nunca vai para o código nem para o Git.

```sql
select vault.create_secret('<segredo longo e aleatório>', 'eventos_hmac_<slug da origem>');
-- ex.: eventos_hmac_vprequisicoes. Gere com: openssl rand -hex 32
```

Guarde o mesmo valor como variável de ambiente do sistema de origem (`CENTRAL_EVENTOS_SEGREDO`).
Rotação: `select vault.update_secret('<id>', '<novo segredo>')` e troca da variável no sistema.

## 2. Enviar um evento

`POST https://ubdkoqxfwcraftesgmbw.supabase.co/functions/v1/eventos-ingest`

```bash
TS=$(date +%s)
BODY='{"tipo":"requisicao.aprovada","idempotency_key":"req-1234-aprovada-v1","ocorrido_em":"2026-10-09T14:03:11Z","ator":{"email":"gestor@verticalparts.com.br"},"entidade":{"tipo":"requisicao","id":"1234","numero":"REQ-0456"},"payload":{"valor_total":18250.0}}'
SIG="sha256=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$CENTRAL_EVENTOS_SEGREDO" -hex | sed 's/^.* //')"
curl -X POST "$URL" -H "x-origem: vprequisicoes" -H "x-timestamp: $TS" -H "x-assinatura: $SIG" \
     -H "content-type: application/json" --data-binary "$BODY"
```

Em Node: `crypto.createHmac('sha256', segredo).update(`${ts}.${corpo}`).digest('hex')`.
Assine exatamente os mesmos bytes que enviar no corpo.

## 3. Regras para a origem

- **`idempotency_key` estável por fato**: reenviar o mesmo fato com a mesma chave é seguro e devolve `200`. Chave nova para o mesmo fato gera evento duplicado.
- **Tentar de novo** em `429`, `503` e erro de rede, com a mesma chave. Não tentar de novo em `400`, `401` e `404`.
- **Nunca bloquear a operação** do usuário esperando a Central: grave o evento numa tabela local (outbox) na mesma transação da mudança e envie por um job.
- **O tipo precisa estar no catálogo** da origem (aba Catálogo de Gatilhos). Tipo desconhecido recebe `404`.
- **Sem dados desnecessários no `payload`**: ele fica registrado e aparece na tela de monitoramento.

## 3.1 Respostas

`202` aceito, `200` já recebido antes, `400` corpo inválido, `401` assinatura ou origem inválida, `403` origem desativada, `404` tipo fora do catálogo, `413` corpo grande, `429` limite por minuto (padrão 300 por origem), `503` falha temporária.
