-- M10: predict_user needs SELECT on predictions so INSERT...RETURNING works
-- (RETURNING is essentially a SELECT). M13 will also read this table for
-- calibration scoring, so the grant is permanent rather than temporary.

\connect travel

grant select on public.predictions to predict_user;
