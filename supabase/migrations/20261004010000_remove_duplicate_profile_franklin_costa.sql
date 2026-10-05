-- Remove o perfil placeholder duplicado "Franklin Costa" (sem e-mail e sem
-- conta no Auth). O Franklin real é "Franklin Santos da Costa"
-- (ea9db1b5-03e3-4f65-ae5a-6fa1dea4fd68, franklin.costa@verticalparts.com.br).
--
-- A exclusão pela UI (delete-user) falhava porque profiles.manager_id do
-- Tiago Acácio apontava pro duplicado (FK sem ON DELETE) e porque o perfil
-- não tem e-mail pra checar os satélites.
--
-- BACKUP (para rollback manual) do que foi removido:
--
-- profiles:
--   id 60bfae80-6c17-472a-9aec-68afe78534ed, name 'Franklin Costa',
--   role/level 'Colaborador', email null, celular '11975670375',
--   is_active true, job_title null, unit null,
--   avatar_url 'https://ubdkoqxfwcraftesgmbw.supabase.co/storage/v1/object/public/avatars/60bfae80-6c17-472a-9aec-68afe78534ed-20260802.png',
--   department 'Logística/Almoxarifado/Produção',
--   manager_id 8c294f66-5d61-4fb1-a672-de1d86448a8c (Danilo Oliveira),
--   is_placeholder true, is_department_lead false,
--   created_at 2026-07-25T01:28:49.90516+00
-- module_permissions (todas can_access=false, granted_by null,
--   created_at 2026-09-09T18:57:32.403989+00):
--   cotacao-importacao, engenharia, propostas, vpposvenda360, gente-gestao
-- profiles.manager_id do Tiago Acácio (931d9c56-a087-4200-976b-cebb16de25bd)
--   era 60bfae80-6c17-472a-9aec-68afe78534ed

update public.profiles
   set manager_id = '8c294f66-5d61-4fb1-a672-de1d86448a8c' -- Danilo Oliveira
 where id = '931d9c56-a087-4200-976b-cebb16de25bd';       -- Tiago Acácio

delete from public.module_permissions
 where user_id = '60bfae80-6c17-472a-9aec-68afe78534ed';

delete from public.profiles
 where id = '60bfae80-6c17-472a-9aec-68afe78534ed'
   and email is null
   and not exists (select 1 from auth.users u where u.id = profiles.id);
