# Relatório — 04/07/2026 — Portal Escamax (aviso WhatsApp) + Auditoria do Cofre de Credenciais

> Gerado em 04/07/2026 — Claude Sonnet 5, a pedido de Gelson Simões.
> Escopo: análise e infraestrutura do Portal B2B Escamax (`011_EscamaxCompraVP`),
> implementação de aviso de aprovação via WhatsApp, e auditoria/correção do
> Cofre Central de Credenciais (`Instruções/COFRE_CREDENCIAIS.md`, criado 03/07/2026).

---

## 0. Quem sou eu (leia isto primeiro se você é outro Claude, inclusive Claude Desktop)

Sou **Claude Sonnet 5** (Anthropic), rodando como **Claude Code** — a CLI oficial da
Anthropic para tarefas de engenharia — numa sessão de terminal iniciada como usuário
**root** no VPS Hostinger `srv1510643.hstgr.cloud` (72.61.48.156). Não sou um serviço
hospedado com endpoint HTTP público; sou um agente interativo, invocado enquanto o
Gelson conversa comigo no terminal, com acesso a: Bash (shell do próprio VPS + SSH
para outras contas Hostinger), MCP do Supabase (autenticado numa organização
específica), ferramentas de navegador (`vpprd-browser`), entre outras.

**Memória persistente**: tenho um sistema de memória em arquivo, em
`/root/.claude/projects/-root/memory/` (indexado por `MEMORY.md`), que carrega
automaticamente em toda nova conversa nesta mesma máquina/usuário. É assim que eu
"lembro" de sessão pra sessão — não é mágica, é leitura de arquivo local. Se você
(Claude Desktop ou outro Claude, em outra máquina) está lendo este relatório, você
**não tem acesso automático** a essa memória — precisaria que alguém copiasse o
conteúdo relevante pra você, ou que você rodasse na mesma máquina/conta.

**Sobre "me usar como ferramenta dentro do site"**: hoje eu não tenho uma API/endpoint
que um site possa chamar programaticamente — sou invocado interativamente
(terminal/chat), não como serviço. Se a ideia é um site (Portal Escamax, vpsistema,
etc.) "chamar" um agente Claude pra executar uma tarefa automatizada, os caminhos
reais de arquitetura são:

1. **Claude Agent SDK** — embutir um agente Claude com ferramentas específicas direto
   no backend do site (ex.: um endpoint que monta um agente com acesso só ao que
   aquele fluxo precisa).
2. **Claude Code headless** — um cron/rotina no próprio VPS disparando
   `claude -p "<prompt>"` sem interação, com acesso às mesmas ferramentas que uso
   aqui (isso é literalmente uma instância minha rodando sem humano no teclado).
3. **API da Anthropic direta (Messages API)** com tool use, sem passar pelo Claude
   Code — mais leve, mais controle fino, mas você escreve o orquestrador do zero.

Não construí nenhuma integração desse tipo hoje — é uma decisão de arquitetura ainda
em aberto. Se quiser, posso detalhar as opções com o Claude Desktop quando ele for
desenhar isso.

---

## 1. Contexto — o que motivou a sessão de hoje

- Pedido inicial: analisar o repositório `011_EscamaxCompraVP` (Portal B2B Escamax ↔
  VerticalParts ↔ Omie) e depois a instância em produção na Hostinger.
- Pedido principal: WhatsApp automático avisando quando um pedido está aguardando
  aprovação (Diego/Michel/Gustavo) — unidirecional, **sem** interação/bot.
- No meio do caminho: verificação e auditoria do Cofre Central de Credenciais
  (criado em 03/07/2026 por uma sessão anterior minha, a pedido do Gelson).

---

## 2. Análise do Portal Escamax

- Repositório clonado (branch `feat/reskin-verticalparts`) para inspeção.
- `README.md`/`CLAUDE.md`/`AGENTS.md` descreviam uma versão **anterior** do sistema
  (login por OTP + backdoor `123456`) — o código real já tinha evoluído para
  autenticação por senha via Supabase Auth, alçadas nominais, auditoria, etc.
  (commits `f66f56f` e `5497af8`, ambos de 03–04/07). Documentação desatualizada
  em relação ao código.
- Verificação via SSH na hospedagem compartilhada Hostinger da instância em
  produção (`escamaxcompravp.vpsistema.com`):
  - Site no ar, HTTP 200, processo Node ativo via Passenger.
  - `.env` de produção com todas as variáveis preenchidas (os CNPJs que o
    `CLAUDE.md` listava como pendentes já estavam configurados — doc desatualizado).
  - Dois problemas reais encontrados em produção via `stderr.log` e `orders.json`:
    - Rate limit da Omie ("Consumo redundante detectado") em `ListarProdutos` e
      `ListarPosEstoque`.
    - Um pedido real falhou com "Categoria não cadastrada para o Código [2.01.01]"
      ao criar o Pedido de Compra numa filial.

---

## 3. Implementado: aviso de aprovação via WhatsApp

- Decisão confirmada com o Gelson: reaproveitar a instância Evolution já pareada do
  VP Pós-Venda 360 (`pv360`) só como canal de **saída** — sem bot, sem resposta, sem
  misturar com o atendimento a clientes externos.
- Destinatários (alçadas nominais, `server/services/approvalEngine.js`): Gustavo
  (nível 1), Michel (nível 2), Diego (nível 3).
- Código novo: `server/services/whatsappNotifier.js` — `enviarWhatsapp()` (chamada
  Evolution com timeout+retry, nunca lança erro pra cima) e `avisarNovaAprovacao()`.
- Hooks:
  - `checkoutController.js` — ao criar um pedido, avisa a 1ª alçada.
  - `routes/orders.js` (`POST /:id/aprovacao/decisao`) — quando uma alçada aprova e
    o fluxo avança de nível, avisa o próximo aprovador.
  - Chamadas fire-and-forget (`.catch()`) — falha no WhatsApp nunca quebra o
    checkout/decisão.
- Variáveis novas no `.env` de produção: `EVOLUTION_URL`, `EVOLUTION_APIKEY`,
  `EVOLUTION_INSTANCE`, `WHATSAPP_FONE_GUSTAVO`, `WHATSAPP_FONE_MICHEL`,
  `WHATSAPP_FONE_DIEGO` (valores reais só no `.env` do servidor e no Cofre — **não**
  neste relatório).
- Testado: mensagem real de teste enviada aos 3 números confirmando que o canal
  está ativo — aceita pela Evolution API sem erro.
- Deploy: arquivos copiados via SCP direto para
  `~/domains/escamaxcompravp.vpsistema.com/nodejs/` (essa pasta **não** é
  git-tracked em produção — deploy ali é por cópia de arquivo, não `git pull`),
  backend reiniciado, sem erro novo no `stderr.log`.
- Commit `05642cd` na branch `feat/reskin-verticalparts` de
  `verticalpartsIA/011_EscamaxCompraVP`, enviado ao GitHub (o token org-wide salvo
  estava morto; usei o token dedicado do repo Escamax).
- `CLAUDE.md`/`AGENTS.md` do projeto Escamax atualizados com a nova seção e
  variáveis.

---

## 4. Cofre Central de Credenciais — verificação e auditoria

- O Gelson mencionou o cofre pela primeira vez nesta sessão; **verifiquei que era
  real antes de agir** (busquei o doc oficial em `verticalpartsIA/001_vpsistema` →
  `Instruções/COFRE_CREDENCIAIS.md`) antes de conectar em qualquer banco, já que a
  instrução batia de frente com o que eu tinha acabado de observar no `.env` real
  do Escamax (ainda com segredos crus).
- O Gelson colou o `credenciais_master.md` (v8) inteiro no chat e pediu comparação
  com o que já estava no cofre.
- Consultei `credentials.registry` diretamente (só metadados — projeto/chave, sem
  decifrar nenhum valor) e comparei com o documento. Lacunas encontradas:
  - `pv360`: faltavam `SUPABASE_ANON_KEY` e `SUPABASE_DB_PASSWORD`.
  - `vpprd`: faltava `GEMINI_API_KEY` (usado por "VP PRD IA" segundo o doc, mas só
    existia em `pv360`/`sharedtools` — e pela regra de isolamento do cofre,
    `svc_vpprd` não consegue ler segredo de outro projeto).
  - **Projeto inteiro fora do cofre**: OMIE ERP SCHEMA /
    `developer_omie_com_br_service-list` (ref `hrhwplqlbuwfextznkea`) — nem tinha
    papel de serviço criado.
  - `infrahostinger`: faltava a senha SSH do usuário Linux `vphermes` (diferente da
    senha do painel Hermes — eram duas credenciais distintas, minha própria memória
    tinha isso errado antes de conferir com o doc).
  - Token/API Key Omie genéricos da seção 5 do doc, sem entrada equivalente clara
    em nenhum projeto.
- Corrigido, com autorização explícita do Gelson ("postar todas as credenciais lá,
  inclusive as consumidas por humanos"):
  - Criado o papel `svc_omieschema` (senha entregue ao Gelson diretamente no chat,
    nunca commitada em lugar nenhum) e migradas as 5 credenciais desse projeto.
  - Adicionadas as chaves faltantes de `pv360`, `vpprd`, `infrahostinger`.
  - Adicionado o Omie genérico em `sharedtools`, mas **sinalizado como não
    confirmado** — pode ser duplicata das chaves Omie do Escamax.
- **Pendente**: Anon/Service Role de VP Catraca, Visitas e Brindes e VP Suprimentos
  — o `credenciais_master.md` (versão curta) não trazia esses valores, só apontava
  para o `credenciais.md` original (2361 linhas).

---

## 5. Observação de segurança levantada durante a sessão

Ao colar o `credenciais_master.md` inteiro no chat, o próprio Gelson contrariou a
regra que ele mesmo tinha acabado de estabelecer poucas mensagens antes ("nunca
colar credencial no chat") — sinalizei isso no momento, antes de prosseguir. O
Gelson decidiu conscientemente manter os dois: cofre (fonte de execução para os
apps) + minha memória local (cache do agente, pra eu agir rápido sem precisar de
acesso ao Postgres toda hora). Registrado como decisão explícita do responsável
pelo projeto, não como omissão minha.

---

## 6. Pendências (não resolvidas nesta sessão)

| Item | Observação |
|---|---|
| Confirmar se `sharedtools.OMIE_TOKEN_GERAL`/`OMIE_API_KEY_GERAL` é duplicata do Omie do Escamax | Perguntar ao Gelson |
| Migrar o `.env` do Escamax para consumir do cofre (`VAULT_ROLE_PASSWORD` + `credentials.get_secret`) em vez de segredos crus | `svc_escamax` já existe; falta mudar o código (`omieClient.js`, `usuariosService.js`, etc.) |
| Rate limit da Omie (`ListarProdutos`/`ListarPosEstoque`) em produção no Escamax | Não investigado a fundo hoje |
| Erro "Categoria não cadastrada [2.01.01]" num pedido real do Escamax | Não corrigido — é cadastro no plano de contas Omie da filial, ação humana |
| Anon/Service Role de VP Catraca, Visitas e Brindes, VP Suprimentos faltando no cofre | Preciso dos valores reais para migrar |
| Entregar a senha do papel `svc_omieschema` a quem for administrar aquele projeto | Gelson |

---

*Gerado em 04/07/2026 — Claude Sonnet 5, a pedido de Gelson Simões.*
