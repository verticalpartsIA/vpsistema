-- Alinha o rótulo da ação formularios.destravar com o do VP HUB (#840):
-- depois da 1ª Precificação o formulário trava; só o Líder destrava, com motivo.
update public.catalog_actions
   set label = 'Destrava formulário/cotação após a precificação (Líder)'
 where system_slug = 'cotacao-importacao' and module_key = 'formularios' and action_key = 'destravar';
