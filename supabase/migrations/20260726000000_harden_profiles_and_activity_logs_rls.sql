-- ── Correção 2: impede escalonamento de privilégio via profiles_update_own ──
-- A policy profiles_update_own permite que o usuário atualize a própria linha
-- (nome, avatar), mas sem WITH CHECK por coluna qualquer um podia se promover a
-- Administrador com um simples update. Um trigger BEFORE UPDATE bloqueia mudança
-- de campos administrativos por quem não é admin. Service role (auth.uid() null,
-- usado pelas edge functions) e Administradores passam direto.
create or replace function public.prevent_profile_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;  -- service role / edge functions admin
  end if;
  if public.get_my_level() = 'Administrador' then
    return new;
  end if;
  if new.level is distinct from old.level then
    raise exception 'Você não pode alterar seu nível de acesso.';
  end if;
  if coalesce(new.is_department_lead, false) is distinct from coalesce(old.is_department_lead, false) then
    raise exception 'Você não pode alterar liderança de departamento.';
  end if;
  if coalesce(new.is_active, true) is distinct from coalesce(old.is_active, true) then
    raise exception 'Você não pode alterar o status da conta.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_profile_privilege_escalation on public.profiles;
create trigger trg_prevent_profile_privilege_escalation
  before update on public.profiles
  for each row execute function public.prevent_profile_privilege_escalation();

-- ── Correção 5: log de auditoria não-falsificável ──
-- logs_insert_authenticated tinha WITH CHECK (true): qualquer autenticado podia
-- inserir um log em nome de outra pessoa. Passa a exigir que user_id seja o
-- próprio usuário. logActivity() no front já grava user_id = auth.uid().
drop policy if exists logs_insert_authenticated on public.activity_logs;
create policy logs_insert_authenticated on public.activity_logs
  for insert to authenticated
  with check (user_id = auth.uid());
