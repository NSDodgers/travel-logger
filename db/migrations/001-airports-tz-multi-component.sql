-- Migration 001: relax airports.tz CHECK to allow multi-component IANA zones
-- Run: docker compose exec -T postgres psql -U postgres -d travel < db/migrations/001-airports-tz-multi-component.sql
-- Idempotent: safe to re-run.

\connect travel

alter table public.airports drop constraint if exists airports_tz_check;
alter table public.airports add constraint airports_tz_check
  check (tz ~ '^[A-Za-z_0-9+-]+(/[A-Za-z_0-9+-]+)*$');
