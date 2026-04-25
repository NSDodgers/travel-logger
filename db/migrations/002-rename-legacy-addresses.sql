-- Migration 002: rename M5 legacy addresses to human-readable labels.
-- Run: docker compose exec -T postgres psql -U postgres -d travel < db/migrations/002-rename-legacy-addresses.sql
-- Idempotent: subsequent runs no-op because the `where label = 'legacy:...'` clause no longer matches.
--
-- Mapping approved 2026-04-24 at the start of M6.
-- Current home is Inwood; 192nd St and Bronx are prior residences and get neighborhood labels.

\connect travel

begin;

update public.addresses set label = 'Home',                    updated_at = now() where label = 'legacy:home_inwood';
update public.addresses set label = '192nd St',                updated_at = now() where label = 'legacy:home_192nd';
update public.addresses set label = '240th St (Bronx)',        updated_at = now() where label = 'legacy:home_bronx';
update public.addresses set label = 'Mom''s (Burbank)',        updated_at = now() where label = 'legacy:mom_burbank';
update public.addresses set label = 'MIL''s (Long Beach)',     updated_at = now() where label = 'legacy:mil_long_beach';
update public.addresses set label = 'Steppenwolf',             updated_at = now() where label = 'legacy:steppenwolf';
update public.addresses set label = 'A.R.T. (Cambridge)',      updated_at = now() where label = 'legacy:art_cambridge';
update public.addresses set label = 'Chicago — State St',      updated_at = now() where label = 'legacy:chicago_state';
update public.addresses set label = 'Chicago — Parkline',      updated_at = now() where label = 'legacy:chicago_parkline';
update public.addresses set label = 'Chicago — Grand Ave',     updated_at = now() where label = 'legacy:chicago_grand';
update public.addresses set label = 'Chicago — Level',         updated_at = now() where label = 'legacy:chicago_level';
update public.addresses set label = 'Boston — Ames St',        updated_at = now() where label = 'legacy:boston_ames';
update public.addresses set label = 'Toronto — Victoria St',   updated_at = now() where label = 'legacy:toronto_victoria';
update public.addresses set label = 'Köln — Vogelsanger',      updated_at = now() where label = 'legacy:koln_vogelsanger';

commit;

-- Verify: no legacy: labels remain.
select count(*) as remaining_legacy_labels
from public.addresses
where label like 'legacy:%';
