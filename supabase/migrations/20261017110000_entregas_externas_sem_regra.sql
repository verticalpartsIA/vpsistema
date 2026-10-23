-- 17/10/2026 (Gelson): o Monitor marca o aviso que o gi-avisos recebeu mas não envia (sem regra, etapa sem aviso, teste).
-- Já aplicada em produção.
alter table eventos.entregas_externas drop constraint if exists entregas_externas_situacao_check;
alter table eventos.entregas_externas add constraint entregas_externas_situacao_check
  check (situacao in ('previsto', 'enviado', 'agrupado', 'encerrado', 'na_fila', 'sem_numero', 'autor', 'erro', 'pausado', 'sem_regra'));
