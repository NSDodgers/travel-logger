-- M11 prep: trips.test boolean for QA/dogfooding trips that should be
-- excluded from predictions. Predict service adds `where t.test = false`
-- to the duration query; history list/timeline render a TEST pill when set.
--
-- Idempotent — safe to apply on existing DBs.

\connect travel

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'trips'
      and column_name = 'test'
  ) then
    alter table public.trips add column test boolean not null default false;
  end if;
end $$;

-- Re-create api.trips with the test column. drop + create rather than
-- replace view because we want to slot `test` between `international` and
-- `status` for readability (REPLACE VIEW can only append).
drop view if exists api.trips;
create view api.trips as
  select
    id, direction, address_id, dep_airport, arr_airport, actual_arr_airport,
    sched_dep_local, sched_arr_local, sched_dep_date, sched_arr_date,
    dst_warning, bags, party, transit, tsa_precheck, international, test,
    status, source, created_at, updated_at
  from public.trips;

-- Grants get reset when a view is dropped — re-issue.
grant select, insert, update on api.trips to postgrest_user;
