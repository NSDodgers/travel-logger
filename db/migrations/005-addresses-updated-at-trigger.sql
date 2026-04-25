-- Bump public.addresses.updated_at on every UPDATE so the address list
-- re-sorts after edit/archive. Mirrors the BEFORE-touch trigger that
-- migration 003 split out for milestones.
--
-- Pre-M7 STATUS noted: "public.addresses has no updated_at trigger. M6
-- edit/archive PATCHes bump it client-side so the list re-sorts. A proper
-- BEFORE UPDATE trigger should land when we touch lifecycle plumbing in M7."
-- M7 didn't land it; M8 (queue rewrite that drops client-side updated_at
-- from PATCH bodies) is the right time.

create or replace function public.addresses_touch_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists addresses_touch_trg on public.addresses;
create trigger addresses_touch_trg
  before update on public.addresses
  for each row execute function public.addresses_touch_updated_at();
