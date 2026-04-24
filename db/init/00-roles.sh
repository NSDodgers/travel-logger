#!/bin/bash
# Role + auxiliary database setup.
# Runs once on a fresh pgdata volume. To re-run, wipe the volume.
set -e

# Read role passwords from mounted Docker secrets
AUTHELIA_PW=$(cat /run/secrets/authelia_db_password)
POSTGREST_PW=$(cat /run/secrets/postgrest_db_password)
PREDICT_PW=$(cat /run/secrets/predict_db_password)

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  -- PostgREST: reads/writes the api schema only (no DELETE grants; void model instead)
  CREATE ROLE postgrest_user LOGIN PASSWORD '$POSTGREST_PW';

  -- Bun predict service: reads trips + milestones, inserts into predictions
  CREATE ROLE predict_user LOGIN PASSWORD '$PREDICT_PW';

  -- Authelia: owns its own database
  CREATE ROLE authelia_user LOGIN PASSWORD '$AUTHELIA_PW';
  CREATE DATABASE authelia OWNER authelia_user;
  GRANT ALL PRIVILEGES ON DATABASE authelia TO authelia_user;
EOSQL

echo "00-roles.sh: roles + authelia DB created"
