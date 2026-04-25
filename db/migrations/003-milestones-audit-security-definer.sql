-- Migration 003 — fix the milestones audit trigger for live API calls.
--
-- Two bugs in one fix:
--
-- 1) Permissions: the original trigger ran as the invoking role and inserted
--    into public.milestones_history. postgrest_user has no grants on
--    public.* (by design — only the api.* views are exposed), so the M7
--    milestone POST died with "permission denied for table milestones_history".
--    Fix: SECURITY DEFINER so the audit insert runs as the function owner
--    (postgres). search_path is locked down to keep that safe.
--
-- 2) Order-of-operations: the original trigger was BEFORE INSERT and inserted
--    into milestones_history with milestone_id=new.id. milestones_history's
--    FK is `deferrable initially immediate`, so at insert time the parent
--    row didn't exist yet and the FK exploded. The M5 bulk loader worked
--    around this with `set constraints deferred`; the live PostgREST path
--    has no such hook.
--    Fix: split into two triggers — BEFORE UPDATE just bumps updated_at;
--    AFTER INSERT OR UPDATE writes audit rows when the parent row already
--    exists. INSERTs get their updated_at from the column default.
--
-- Apply (idempotent):
--   docker compose exec -T postgres psql -U postgres -d travel \
--     -f /tmp/003.sql   (or via < redirection)

drop trigger if exists milestones_audit_trg on public.milestones;
drop function if exists public.milestones_audit();
drop function if exists public.milestones_touch_updated_at();

create or replace function public.milestones_touch_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create or replace function public.milestones_audit() returns trigger as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.milestones_history (milestone_id, change_kind, new_logged_at)
      values (new.id, 'insert', new.logged_at);
  elsif (tg_op = 'UPDATE') then
    if (old.logged_at is distinct from new.logged_at) then
      insert into public.milestones_history (milestone_id, change_kind, old_logged_at, new_logged_at)
        values (new.id, 'update', old.logged_at, new.logged_at);
    end if;
    if (old.void is distinct from new.void) then
      insert into public.milestones_history (milestone_id, change_kind, reason)
        values (new.id, case when new.void then 'void' else 'unvoid' end, new.void_reason);
    end if;
  end if;
  return null;  -- AFTER trigger return value is ignored
end;
$$ language plpgsql security definer;

alter function public.milestones_audit() set search_path = public, pg_temp;

create trigger milestones_touch_trg
  before update on public.milestones
  for each row execute function public.milestones_touch_updated_at();

create trigger milestones_audit_trg
  after insert or update on public.milestones
  for each row execute function public.milestones_audit();
