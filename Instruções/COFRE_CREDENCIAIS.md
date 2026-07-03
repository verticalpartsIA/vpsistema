# Cofre Central de Credenciais — VerticalParts

> Leia este arquivo inteiro antes de tentar consumir ou alterar qualquer credencial.
> Este documento serve tanto para um assistente de IA (LLM) entender como agir, quanto
> para um humano entender o que existe e por quê.

---

## O que é isso

Em vez de espalhar tokens, chaves e senhas em dezenas de arquivos `.env` e `.md` por
projeto (o que já causou pelo menos um vazamento/rotação de token no passado), todas as
credenciais importantes da VerticalParts e da Escamax foram centralizadas em **um único
projeto Supabase**: o próprio `vpsistema` (este repositório).

O valor real de cada credencial fica **criptografado** dentro do
[Supabase Vault](https://supabase.com/docs/guides/database/vault) (extensão
`supabase_vault`, já habilitada neste projeto). Nenhum segredo em texto puro é salvo em
tabela normal, em `.env` de outro projeto ou — **e isso é importante** — dentro deste
próprio repositório de instruções.

> ⚠️ **Este arquivo NUNCA deve conter valores reais de credenciais.** Ele explica a
> estrutura e como consumir, não os segredos em si.

---

## Onde vive

```
Projeto Supabase: vpsistema
ID/ref:           ubdkoqxfwcraftesgmbw
URL:              https://ubdkoqxfwcraftesgmbw.supabase.co
Host Postgres:    db.ubdkoqxfwcraftesgmbw.supabase.co  (porta 5432, conexão direta)
Pooler:           aws-1-sa-east-1.pooler.supabase.com  (porta 6543, transaction mode)
Schema:           credentials   (NÃO exposto via PostgREST/API pública — só acessível
                                 via conexão Postgres direta com um papel de serviço)
```

---

## Estrutura interna

| Objeto                          | Tipo     | Para quê |
|----------------------------------|----------|----------|
| `vault.secrets`                  | tabela (nativa do Supabase Vault) | Valor real, criptografado |
| `vault.decrypted_secrets`        | view (nativa) | Só legível dentro de função `security definer` |
| `credentials.registry`           | tabela   | Metadados: qual projeto, qual chave, qual `vault_secret_id`, ambiente, data de rotação |
| `credentials.access_log`         | tabela   | Auditoria: quem pediu, o quê, quando, se deu certo ou foi negado |
| `credentials.set_secret(...)`    | função   | Grava/rotaciona um segredo. Só chamável com acesso direto de `postgres` (não é concedida a nenhum papel de serviço) |
| `credentials.get_secret(projeto, chave)` | função | **Gateway único de leitura**. Cada papel de serviço só executa isso para o seu próprio projeto |

Ninguém — nem os papéis de serviço dos projetos — tem `SELECT` direto em
`credentials.registry`, `credentials.access_log` ou `vault.decrypted_secrets`. O único
caminho de leitura é a função `get_secret`.

---

## Como o isolamento funciona

Cada projeto consumidor tem **um papel de login no Postgres** chamado `svc_<projeto>`
(ex.: `svc_escamax`, `svc_pv360`). Dentro de `get_secret`, a função verifica quem está
chamando (`session_user`) e só entrega o segredo se `session_user = 'svc_' || projeto`
pedido. Se o Escamax tentar ler um segredo do `pv360`, a função devolve `NULL` — não
erro, para que a tentativa negada seja **registrada em `access_log`** (uma versão
anterior desta função usava `raise exception`, que desfazia a transação e apagava esse
registro do log; foi corrigida).

```sql
-- exemplo: svc_escamax só consegue isto
select credentials.get_secret('escamax', 'OMIE_APP_SECRET');   -- ✅ funciona

-- e NÃO consegue isto (retorna NULL, fica no access_log como 'role mismatch')
select credentials.get_secret('pv360', 'ESCAMAX_WEBHOOK_SECRET');  -- ❌ null
```

---

## Papéis de serviço já criados

| Papel                  | Projeto / uso                                  |
|-------------------------|------------------------------------------------|
| `svc_escamax`           | Portal B2B Escamax (AprovacaoCompra / 011_EscamaxCompra) |
| `svc_pv360`             | VP Pós-Venda 360 / SAC (004_sac_posvenda360)   |
| `svc_vprequisicoes`     | VP Requisições Pro                             |
| `svc_vpprd`             | VP PRD — Cotação de Importação                 |
| `svc_propostas`         | VP Proposta Comercial                          |
| `svc_bdomie`            | Omie ERP Schema (espelho Supabase)             |
| `svc_vpproject`         | VP Project (OpenProject)                       |
| `svc_livetv`            | VerticalParts Live TV                          |
| `svc_vpclick`           | VP Click                                       |
| `svc_vpsuprimentos`     | VP Suprimentos (legado)                        |
| `svc_vpcatraca`         | VP Catraca                                     |
| `svc_visitasbrindes`    | Visitas e Brindes                              |
| `svc_sharedtools`       | Tokens/chaves de uso transversal (GitHub org, IA, proxy) |
| `svc_infrahostinger`    | Infra Hostinger/VPS (não é um projeto Supabase, mas os segredos de infra ficam aqui) |
| `svc_humans`            | Senhas de login humano (painéis, e-mails)      |
| `svc_vpsistema`         | O próprio portal central                       |

Cada papel só tem `EXECUTE` na função `get_secret` — nada mais. As senhas desses papéis
**não estão neste arquivo**; foram entregues fora deste canal a quem administra cada
projeto. Se você é um LLM lendo isto para configurar um novo ambiente e não tem a senha
do papel de serviço correspondente, **pare e peça ao humano responsável** — não tente
adivinhar, gerar ou resetar sozinho sem autorização explícita.

---

## Como um projeto consome (exemplo Node.js)

Cada backend guarda **apenas um segredo próprio**: a senha do seu `svc_<projeto>`. Com
isso ele se conecta diretamente ao Postgres do `vpsistema` (não via REST/PostgREST — o
schema `credentials` não é exposto ali) e chama a função:

```js
const { Client } = require('pg');

async function getSecret(key) {
  const client = new Client({
    host: 'db.ubdkoqxfwcraftesgmbw.supabase.co',
    port: 5432,
    user: 'svc_escamax',                       // um por projeto
    password: process.env.VAULT_ROLE_PASSWORD, // o ÚNICO segredo que este projeto guarda
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const { rows } = await client.query(
    'select credentials.get_secret($1, $2) as v',
    ['escamax', key]
  );
  await client.end();
  return rows[0].v; // null se não existir OU se o papel não tiver permissão
}

// uso:
const omieSecret = await getSecret('OMIE_APP_SECRET');
```

Para funções serverless em Deno (ex.: Supabase Edge Functions do `pv360`), o mesmo
padrão vale usando um client Postgres para Deno (ex. módulo `postgres` do deno.land/x)
apontando para o mesmo host/porta, com o papel `svc_pv360`.

Recomenda-se buscar os segredos **uma vez, na inicialização do processo**, e manter em
memória — não chamar `get_secret` a cada requisição.

---

## Como rotacionar um segredo

Só quem tem acesso direto de `postgres` (hoje: PAT master do Supabase / SQL Editor do
projeto `vpsistema`) pode rotacionar:

```sql
select credentials.set_secret(
  'escamax',                 -- projeto
  'OMIE_APP_SECRET',         -- chave
  'novo-valor-aqui',         -- valor novo
  'rotacionado em DD/MM/AAAA porque ...'  -- descrição (opcional)
);
```

Isso atualiza o valor no Vault e marca `rotated_at = now()` no registry. O projeto
consumidor não precisa mudar nada — na próxima vez que chamar `get_secret`, já recebe o
valor novo.

---

## Como adicionar um novo projeto

1. Escolher um `project_slug` curto (minúsculo, sem espaços) — ex. `novoapp`.
2. No SQL Editor do `vpsistema`, criar o papel:
   ```sql
   create role svc_novoapp login password '<senha-forte-gerada>' noinherit;
   grant usage on schema credentials to svc_novoapp;
   grant execute on function credentials.get_secret(text, text) to svc_novoapp;
   ```
3. Popular os segredos desse projeto com `credentials.set_secret('novoapp', 'CHAVE', 'valor', 'descrição')`.
4. Entregar a senha do papel ao responsável pelo projeto, fora deste repositório
   (chat direto, gerenciador de senhas — nunca em commit).
5. Atualizar a tabela de papéis acima, sem incluir a senha.

---

## Regras de segurança (leia antes de mexer)

- **Nunca** commitar valores reais de credenciais neste repositório, em nenhum arquivo.
- **Nunca** expor o schema `credentials` via PostgREST (verificar em Project Settings →
  API → Exposed schemas, que deve conter só `public` e o que já era exposto antes).
- **Nunca** conceder `EXECUTE` em `credentials.set_secret` a um papel `svc_*` — escrita é
  só para quem administra via acesso direto de `postgres`.
- Se um papel de serviço vazar, o dano fica **restrito ao projeto dele** (ex.: vazamento
  de `svc_escamax` não expõe nada do `pv360`). Revogar/trocar a senha desse papel com
  `alter role svc_<projeto> password '<nova-senha>';` e avisar quem consome.
- O `credenciais_master.md` (fora deste repo, em
  `C:\Users\gelso\VerticalParts\01_Gelson_Simoes\03_Credenciais_e_Chaves\CredenciaisMD\`)
  continua existindo como registro histórico de auditoria de quando cada coisa foi
  criada — mas o **consumo por aplicações** deve migrar para este cofre, não mais para
  aquele arquivo.

---

*Criado em 03/07/2026 — Claude Sonnet 5, a pedido de Gelson Simões.*
