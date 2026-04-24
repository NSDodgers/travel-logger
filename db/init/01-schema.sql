-- Travel Logger schema
-- Two schemas: public (source of truth) + api (REST-exposed views only)
-- PostgREST's postgrest_user has grants only on api.*, never public.*

\connect travel

create schema if not exists api;

-- Enable gen_random_uuid() from pgcrypto (bundled with postgres:16)
create extension if not exists pgcrypto;

-- ─── Lookup tables ────────────────────────────────────────────────────────

create table public.milestone_kinds (
  kind                 text primary key,
  direction            text not null check (direction in ('departure','arrival')),
  order_seq            int not null,
  label                text not null,
  shown_when_carry_on  boolean not null default true
);

-- ─── Airports ─────────────────────────────────────────────────────────────

create table public.airports (
  iata    text primary key,
  name    text not null,
  city    text,
  country text,
  tz      text not null check (tz ~ '^[A-Za-z_]+/[A-Za-z_+-]+')
);

-- ─── Addresses ────────────────────────────────────────────────────────────

create table public.addresses (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  mapbox_id  text,
  formatted  text not null,
  lat        double precision not null,
  lng        double precision not null,
  archived   boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─── Trips ────────────────────────────────────────────────────────────────

create table public.trips (
  id                  uuid primary key default gen_random_uuid(),
  direction           text not null check (direction in ('departure','arrival')),

  -- Endpoints
  address_id          uuid references public.addresses(id),
  dep_airport         text references public.airports(iata),
  arr_airport         text references public.airports(iata),
  actual_arr_airport  text references public.airports(iata),

  -- Scheduled times: wall-clock local + date; tz comes from airport lookup
  sched_dep_local     time,
  sched_arr_local     time,
  sched_dep_date      date,
  sched_arr_date      date,

  -- DST flag: populated by app on trip creation for spring-forward / fall-back warnings
  dst_warning         text check (dst_warning is null or dst_warning in ('spring_nonexistent','fall_ambiguous')),

  -- Variables
  bags                text not null check (bags in ('checked','carry_on','unknown')),
  party               text not null check (party in ('solo','family')),
  transit             text not null check (transit in ('car','public')),
  tsa_precheck        boolean not null default false,

  status              text not null default 'in_progress' check (status in ('in_progress','complete','abandoned')),
  source              text not null default 'app' check (source in ('app','legacy')),
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create index on public.trips (dep_airport, bags, transit, party, tsa_precheck);
create index on public.trips (arr_airport, bags, transit, party, tsa_precheck);
create index on public.trips (status) where status = 'in_progress';

-- ─── Milestones ───────────────────────────────────────────────────────────

create table public.milestones (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  kind        text not null references public.milestone_kinds(kind),
  logged_at   timestamptz not null,
  client_seq  int not null,
  void        boolean not null default false,
  void_reason text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Unique partial index: only non-void rows count, so re-tap after mistap works
create unique index milestones_trip_kind_unique_idx
  on public.milestones (trip_id, kind)
  where not void;

-- Time-ordered lookup for trip timeline views
create index on public.milestones (trip_id, logged_at);

-- ─── Milestone edit audit log (populated by trigger) ──────────────────────

create table public.milestones_history (
  id            uuid primary key default gen_random_uuid(),
  milestone_id  uuid not null references public.milestones(id) on delete cascade,
  changed_at    timestamptz default now(),
  change_kind   text not null check (change_kind in ('insert','update','void','unvoid')),
  old_logged_at timestamptz,
  new_logged_at timestamptz,
  reason        text
);

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
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger milestones_audit_trg
  before insert or update on public.milestones
  for each row execute function public.milestones_audit();

-- ─── Predictions (accuracy feedback loop) ─────────────────────────────────

create table public.predictions (
  id               uuid primary key default gen_random_uuid(),
  predicted_at     timestamptz default now(),
  direction        text not null check (direction in ('departure','arrival')),
  airport          text not null references public.airports(iata),
  filters          jsonb not null,
  relaxed_filters  text[] not null default '{}',
  sample_n         int not null,
  predicted_p50    interval,
  predicted_p90    interval,

  -- Scored post-trip
  actual_trip_id   uuid references public.trips(id),
  actual_duration  interval,
  scored_at        timestamptz
);

create index on public.predictions (airport, direction);
create index on public.predictions (actual_trip_id) where actual_trip_id is not null;

-- ─── API views (what PostgREST exposes) ───────────────────────────────────

create view api.airports as
  select iata, name, city, country, tz from public.airports;

create view api.milestone_kinds as
  select kind, direction, order_seq, label, shown_when_carry_on from public.milestone_kinds;

create view api.addresses as
  select id, label, mapbox_id, formatted, lat, lng, archived, created_at, updated_at
  from public.addresses;

create view api.trips as
  select
    id, direction, address_id, dep_airport, arr_airport, actual_arr_airport,
    sched_dep_local, sched_arr_local, sched_dep_date, sched_arr_date,
    dst_warning, bags, party, transit, tsa_precheck, status, source,
    created_at, updated_at
  from public.trips;

create view api.milestones as
  select id, trip_id, kind, logged_at, client_seq, void, void_reason, created_at, updated_at
  from public.milestones;

create view api.predictions as
  select
    id, predicted_at, direction, airport, filters, relaxed_filters,
    sample_n, predicted_p50, predicted_p90,
    actual_trip_id, actual_duration, scored_at
  from public.predictions;

-- Computed view: trip timeline (milestones per trip, time-ordered, non-void)
create view api.trip_timeline as
  select
    t.id                as trip_id,
    t.direction,
    t.dep_airport,
    t.arr_airport,
    mk.order_seq,
    m.kind,
    mk.label            as kind_label,
    m.logged_at,
    m.client_seq
  from public.trips t
  join public.milestones m on m.trip_id = t.id and not m.void
  join public.milestone_kinds mk on mk.kind = m.kind
  order by t.id, m.logged_at;
