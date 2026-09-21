-- Reconciliação noturna: rede de segurança pro sync em tempo real
-- (trg_sync_profile_to_satellites). Chama reconcile-satellite-profiles,
-- que reaplica nome/departamento/celular/status ativo de todo profile
-- contra os 4 satélites — pega qualquer webhook perdido (net.http_post sem
-- retry, function fora do ar no momento do UPDATE, etc.).
--
-- 06:00 UTC = 03:00 BRT, fora do horário comercial. Usa o mesmo secret do
-- Vault (satellite_sync_secret) que o trigger em tempo real — nunca em
-- texto puro aqui.
select cron.schedule(
  'reconcile-satellite-profiles-nightly',
  '0 6 * * *',
  $$
  select net.http_post(
    url := 'https://ubdkoqxfwcraftesgmbw.supabase.co/functions/v1/reconcile-satellite-profiles',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'satellite_sync_secret'
        limit 1
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
