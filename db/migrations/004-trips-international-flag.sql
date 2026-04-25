-- Migration 004 — add public.trips.international flag for customs tile visibility.
--
-- M7 introduces a manual "international / preclearance" toggle in the
-- trip-start sheet. Without persisting it, the dep_customs tile disappears on
-- page reload (state.international is rebuilt from in-memory only).
--
-- The api.trips view needs the column too, since the screen reads/writes via
-- PostgREST.

alter table public.trips
  add column if not exists international boolean not null default false;

-- Drop+create instead of `create or replace`: Postgres won't reorder/insert
-- columns in the middle of a view via REPLACE, only append at the end.
drop view if exists api.trips;
create view api.trips as
select
  id, direction, address_id, dep_airport, arr_airport, actual_arr_airport,
  sched_dep_local, sched_arr_local, sched_dep_date, sched_arr_date,
  dst_warning, bags, party, transit, tsa_precheck, international,
  status, source, created_at, updated_at
from public.trips;

grant select, insert, update on api.trips to postgrest_user;
notify pgrst, 'reload schema';
