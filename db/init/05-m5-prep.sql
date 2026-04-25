-- M5 schema prep: party enum expansion + customs milestone kinds
-- Reviewed alongside the M5 import (see docs/M5_INVENTORY.md "Schema additions required")
--
-- Idempotent — safe to apply on existing DBs.

\connect travel

-- ─── Party enum expansion ───────────────────────────────────────────────────
-- Old: 'solo' | 'family'
-- New: 'solo' | 'group_with_kids' | 'group_without_kids'

do $$
begin
  if exists (
    select 1 from information_schema.check_constraints
    where constraint_name = 'trips_party_check'
      and check_clause like '%solo%family%'
      and check_clause not like '%group_with_kids%'
  ) then
    -- Migrate any existing 'family' rows before swapping the constraint.
    update public.trips set party = 'group_with_kids' where party = 'family';
    alter table public.trips drop constraint trips_party_check;
    alter table public.trips add constraint trips_party_check
      check (party in ('solo','group_with_kids','group_without_kids'));
  end if;
end $$;

-- ─── Customs milestone kinds ────────────────────────────────────────────────
-- Insert dep_customs (after security in the dep flow) and arr_customs
-- (between off-plane and bags in the arr flow). Reorder existing arr kinds
-- to make room for arr_customs at order_seq=2.

-- Bump existing arr kinds order_seq to make room for arr_customs at 2
update public.milestone_kinds
set order_seq = order_seq + 1
where direction = 'arrival' and order_seq >= 2 and kind != 'arr_customs';

insert into public.milestone_kinds (kind, direction, order_seq, label, shown_when_carry_on) values
  ('dep_customs', 'departure', 5, 'Through Customs', true),
  ('arr_customs', 'arrival',   2, 'Through Customs', true)
on conflict (kind) do nothing;

-- ─── Defer the milestones_history FK ───────────────────────────────────────
-- The BEFORE INSERT trigger on public.milestones writes into
-- milestones_history with new.id BEFORE the parent milestone row is
-- visible to FK checks. With NOT DEFERRABLE this fails on the first real
-- write. Switching to DEFERRABLE INITIALLY IMMEDIATE preserves normal
-- behavior but allows bulk loaders to SET CONSTRAINTS DEFERRED.

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'milestones_history_milestone_id_fkey'
      and not condeferrable
  ) then
    alter table public.milestones_history
      drop constraint milestones_history_milestone_id_fkey;
    alter table public.milestones_history
      add constraint milestones_history_milestone_id_fkey
      foreign key (milestone_id) references public.milestones(id)
      on delete cascade
      deferrable initially immediate;
  end if;
end $$;
