-- M14: airports.lat/lng for Mapbox Directions live drive-time predictions.
-- Nullable — a few OpenFlights rows are missing coords; legacy code paths
-- shouldn't break on them.
-- Idempotent.

\connect travel

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='airports' and column_name='lat'
  ) then
    alter table public.airports add column lat double precision;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='airports' and column_name='lng'
  ) then
    alter table public.airports add column lng double precision;
  end if;
end $$;

drop view if exists api.airports;
create view api.airports as
  select iata, name, city, country, tz, lat, lng from public.airports;
grant select on api.airports to postgrest_user;
