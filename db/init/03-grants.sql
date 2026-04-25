\connect travel

-- ─── PostgREST role: only sees the api schema ─────────────────────────────
-- Never grant any privileges on public.* to postgrest_user.

grant usage on schema api to postgrest_user;

-- Read everything exposed via api views
grant select on all tables in schema api to postgrest_user;

-- Allow INSERT/UPDATE on the views that correspond to user-mutable resources.
-- PostgREST needs INSERT/UPDATE on the view AND on the underlying table.
-- We grant on the view for PostgREST's REST verb mapping; the view's
-- security_invoker behavior passes the user through to the underlying table.

-- Addresses: user creates, edits, archives (no hard delete)
grant insert, update on api.addresses to postgrest_user;
grant insert, update on public.addresses to postgrest_user;
grant usage on schema public to postgrest_user;

-- Trips: user creates + updates status
grant insert, update on api.trips to postgrest_user;
grant insert, update on public.trips to postgrest_user;

-- Milestones: user inserts; updates allowed for void/unvoid and time edits
grant insert, update on api.milestones to postgrest_user;
grant insert, update on public.milestones to postgrest_user;

-- Predictions: PostgREST can read but never insert; that's done by predict_user
-- (so predictions can only be recorded via the /api/predict endpoint, not fabricated)

-- ─── predict_user: reads trips/milestones, writes predictions ─────────────

grant usage on schema public to predict_user;
grant select on public.trips          to predict_user;
grant select on public.milestones     to predict_user;
grant select on public.airports       to predict_user;
grant select on public.milestone_kinds to predict_user;
grant select on public.addresses      to predict_user;
grant insert, update, select on public.predictions to predict_user;
-- SELECT on predictions: needed for INSERT...RETURNING (M10) and calibration
-- scoring reads (M13).

-- ─── Future tables inherit the same pattern ──────────────────────────────
-- Any new table added later needs matching grants; enforce via a review checklist,
-- not default privileges (too broad).
