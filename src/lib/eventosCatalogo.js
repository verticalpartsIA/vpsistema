// Catálogo inicial de gatilhos, levantado no inventário (docs/eventos/01-inventario.md).
// Serve para popular a tela enquanto o banco da Central (schema `eventos`) não está ativo.
// Quando o banco responde, a tela passa a usar o catálogo dele.
//
// modo: 'sombra'  = a Central só registra/simula; o mecanismo antigo continua enviando
//       'legado'  = só existe no sistema de origem, ainda sem evento publicado
//       'novo'    = gatilho que nasce já na Central

export const SISTEMAS = {
  vprequisicoes: 'VP Requisições',
  posvenda360:   'Pós-Venda 360',
  vphub:         'VP HUB',
  vpclick:       'VP Click',
  vpsistema:     'Portal',
}

const g = (sistema, tipo, descricao, destinatario, canal, legado, modo = 'sombra') =>
  ({ sistema, tipo, descricao, destinatario, canal, legado, modo })

export const CATALOGO_INICIAL = [
  // VP Requisições
  g('vprequisicoes', 'requisicao.criada',            'Requisição criada, aguarda ciência do gestor', 'Gestor do requisitante; confirmação ao requisitante', 'WhatsApp', 'LIDER_CIENCIA / REQUISITANTE_CRIADA'),
  g('vprequisicoes', 'requisicao.ciencia_ok',        'Gestor deu ciência, segue para cotação',       'Cotadores; requisitante',                       'WhatsApp', 'COMPRADOR_COTAR / REQUISITANTE_CIENCIA_OK'),
  g('vprequisicoes', 'requisicao.reprovada_gestor',  'Gestor reprovou a requisição',                 'Requisitante',                                  'WhatsApp', 'REQUISITANTE_REPROVADO_GESTOR'),
  g('vprequisicoes', 'requisicao.cotada',            'Cotação finalizada, aguarda aprovação',        'Aprovadores da alçada; requisitante',           'WhatsApp', 'APROVACAO_PENDENTE / REQUISITANTE_COTADO'),
  g('vprequisicoes', 'requisicao.aprovada',          'Aprovação financeira concedida (total ou parcial)', 'Compradores; requisitante',               'WhatsApp', 'COMPRA_APROVADA / REQUISITANTE_APROVADO_*'),
  g('vprequisicoes', 'requisicao.reprovada',         'Aprovação financeira negada',                  'Requisitante',                                  'WhatsApp', 'REQUISITANTE_REPROVADO_FINANCEIRO'),
  g('vprequisicoes', 'requisicao.comprada',          'Compra confirmada',                            'Requisitante',                                  'WhatsApp', 'REQUISITANTE_COMPRADO'),
  g('vprequisicoes', 'requisicao.recebida',          'Material recebido',                            'Expedição; requisitante',                       'WhatsApp', 'EXPEDICAO_RECEBIMENTO / REQUISITANTE_RECEBIDO'),
  g('vprequisicoes', 'requisicao.sla_vencida',       'Etapa parada além da meta de SLA',             'Requisitante',                                  'WhatsApp', 'cron SLA a cada 4h'),
  // Pós-Venda 360
  g('posvenda360', 'nf.emitida_classe_a',     'NF de cliente classe A emitida (follow-up VIP)',      'Cliente',                    'WhatsApp', 'VIP_FOLLOWUP'),
  g('posvenda360', 'pesquisa.enviada',        'Pesquisa de satisfação (NPS) após a entrega',         'Cliente',                    'WhatsApp', 'enviar-pesquisa'),
  g('posvenda360', 'handoff.vencido',         'Responsável não atendeu o cliente no prazo',          'Responsável do handoff',     'WhatsApp', 'cron-handoffs'),
  g('posvenda360', 'handoff.criado',          'IA acionou um departamento (avisar_departamento)',    'Responsável do departamento','WhatsApp', 'avisar_departamento'),
  g('posvenda360', 'ticket.criado',           'Ticket de atendimento criado ou alterado',            'Definido no VP Click',       'VP Click', 'trg_vpclick_ticket_*', 'legado'),
  g('posvenda360', 'ticket_interno.criado',   'Ticket interno criado',                               'Líder do departamento',      'VP Click', 'trg_vpclick_interno', 'legado'),
  g('posvenda360', 'expedicao.divergencia',   'Divergência na conferência da expedição',             'Time de expedição',          'VP Click', 'expedicao-divergencia', 'legado'),
  // VP HUB
  g('vphub', 'decisao.pendente',        'Decisão gerencial aguardando aprovação',            'Aprovadores esperados',       'WhatsApp, interno', 'whatsapp-notify (não ativo) / alerta T1'),
  g('vphub', 'decisao.resolvida',       'Decisão aprovada ou reprovada',                     'Solicitante',                 'WhatsApp, interno', 'whatsapp-notify (não ativo) / alerta J1'),
  g('vphub', 'proposta.aprovada',       'Proposta aprovada, avais financeiro e jurídico abertos','Global (a restringir)',    'Interno', 'alerta T2', 'legado'),
  g('vphub', 'aval.liberado',           'Avais OK, compra na China liberada',                'Global (a restringir)',       'Interno', 'alerta T3', 'legado'),
  g('vphub', 'contrato.assinado',       'Proposta ou contrato assinado, recusado ou revisado','Global (a restringir)',      'Interno', 'alerta T9 / J2-J4', 'legado'),
  g('vphub', 'projeto_instalacao.assinado','Projeto de instalação assinado ou recusado',      'Quem enviou; líderes de Engenharia','Interno', 'alerta T7', 'legado'),
  g('vphub', 'inbox.sem_resposta',      'E-mail de entrada sem resposta (2h e 4h úteis)',    'Responsável; líderes; gerente','Interno', 'cron C2', 'legado'),
  g('vphub', 'embarque.chegando',       'Navio chegando em até 3 dias úteis',                'Líderes de Engenharia, Instalação, Logística e Almoxarifado','Interno','cron C5', 'legado'),
  g('vphub', 'pcp.atraso',              'Pedidos, compras e expedição com prazo vencido',    'Líderes de Almoxarifado e Logística','Interno','crons C6-C8, E1, E2', 'legado'),
  g('vphub', 'solicitacao_produto.criada','Nova solicitação de produto',                     'Engenharia e Importação',     'Interno', 'alerta J9 (destinatário fixo no código)', 'legado'),
  // VP Click
  g('vpclick', 'tarefa.observador_adicionado','Pessoa adicionada como observador da tarefa', 'Observador',                  'WhatsApp', 'whatsapp-notify-event (dry-run) e motor legado'),
  g('vpclick', 'tarefa.mencao',               'Pessoa mencionada em tarefa ou comentário',    'Mencionado',                 'WhatsApp', 'whatsapp-notify-event (dry-run) e motor legado'),
  g('vpclick', 'tarefa.concluida',            'Tarefa concluída ou cancelada',                'Criador da tarefa',          'WhatsApp', 'whatsapp-notify-event (dry-run) e motor legado'),
  g('vpclick', 'tarefa.resumo_diario',        'Resumo diário de atrasadas e inatividade',     'Usuários ativos com telefone','WhatsApp', 'motor legado na VPS', 'legado'),
  // Portal
  g('vpsistema', 'acesso.codigo_2fa',        'Código de verificação no login',            'Usuário',                    'WhatsApp', 'two-factor', 'legado'),
  g('vpsistema', 'acesso.primeiro_acesso',   'Link de primeiro acesso',                   'Usuário convidado',          'WhatsApp', 'whatsapp-first-access', 'legado'),
  g('vpsistema', 'comunicado.agendado',      'Disparo agendado de WhatsApp',              'Público escolhido',          'WhatsApp', 'send-broadcast', 'legado'),
]
