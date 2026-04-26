-- Migration 009 — add public.trips.sched_dep_board_local for scheduled boarding time.
--
-- Departures only — boarding happens before takeoff at the dep airport. Stored as
-- TIME (not TIMESTAMP) to mirror sched_dep_local; the boarding date is implicitly
-- sched_dep_date with prev-day inferred client-side for red-eyes
-- (boarding > flight on same date → boarding is the previous day). Single column
-- keeps storage symmetric with sched_dep_local instead of dragging a parallel
-- sched_dep_board_date along.
--
-- Nullable — legacy trips and trips logged before this migration carry no boarding.
-- The api.trips view is dropped + recreated rather than REPLACE-VIEWed so the new
-- column slots next to sched_dep_local for readability.
--
-- Idempotent — safe to apply on existing DBs.

\connect travel

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'trips'
      and column_name = 'sched_dep_board_local'
  ) then
    alter table public.trips add column sched_dep_board_local time without time zone;
  end if;
end $$;

drop view if exists api.trips;
create view api.trips as
  select
    id, direction, address_id, dep_airport, arr_airport, actual_arr_airport,
    sched_dep_local, sched_dep_board_local, sched_arr_local,
    sched_dep_date, sched_arr_date,
    dst_warning, bags, party, transit, tsa_precheck, international, test,
    status, source, created_at, updated_at
  from public.trips;

grant select, insert, update on api.trips to postgrest_user;
notify pgrst, 'reload schema';
