# secrets/

Everything in this directory is gitignored (see root `.gitignore` — `secrets/*` except this README + `.gitkeep`).

**Never paste any of these values into a chat window, a commit message, an issue, or any AI assistant input.** They live on disk only. The bootstrap script (`scripts/bootstrap.sh`) enforces `chmod 0600` on every file here.

## Files to create before first `docker compose up`

Run `scripts/bootstrap.sh` — it will prompt you to create any missing file and verify permissions. Or create them manually with the commands below.

### `secrets/pg_password.txt`
Postgres superuser password for the main `travel` database.

```bash
openssl rand -base64 48 | tr -d '\n' > secrets/pg_password.txt
chmod 0600 secrets/pg_password.txt
```

### `secrets/authelia_db_password.txt`
Postgres password for the `authelia_user` role that owns Authelia's session storage DB.

```bash
openssl rand -base64 48 | tr -d '\n' > secrets/authelia_db_password.txt
chmod 0600 secrets/authelia_db_password.txt
```

### `secrets/postgrest_db_password.txt`
Postgres password for the `postgrest_user` role (low-privilege, reads/writes only the `api` schema views).

```bash
openssl rand -base64 48 | tr -d '\n' > secrets/postgrest_db_password.txt
chmod 0600 secrets/postgrest_db_password.txt
```

### `secrets/predict_db_password.txt`
Postgres password for the `predict_user` role (reads trips + milestones, inserts into `predictions`).

```bash
openssl rand -base64 48 | tr -d '\n' > secrets/predict_db_password.txt
chmod 0600 secrets/predict_db_password.txt
```

### `secrets/authelia_session.txt`
64-char random string, used by Authelia to sign session cookies.

```bash
openssl rand -hex 64 > secrets/authelia_session.txt
chmod 0600 secrets/authelia_session.txt
```

### `secrets/authelia_storage.txt`
Encryption key for Authelia's storage-at-rest (min 20 chars).

```bash
openssl rand -hex 64 > secrets/authelia_storage.txt
chmod 0600 secrets/authelia_storage.txt
```

### `secrets/mapbox_token.txt`
Your public Mapbox access token (starts with `pk.`). URL-restricted to `travel.myhometech.app` + `localhost:8090`.

```bash
# Paste directly into a new file in your editor, then:
chmod 0600 secrets/mapbox_token.txt
```

### `secrets/b2_key_id.txt`
Backblaze B2 application key ID (short alphanumeric).

```bash
# Paste directly into a new file in your editor, then:
chmod 0600 secrets/b2_key_id.txt
```

### `secrets/b2_application_key.txt`
Backblaze B2 application key (longer secret).

```bash
# Paste directly into a new file in your editor, then:
chmod 0600 secrets/b2_application_key.txt
```

### `authelia/users.yml`
Authelia user credentials. Copy the template, then generate an Argon2id hash for your password.

```bash
cp authelia/users.yml.example authelia/users.yml

# Generate your password hash (you'll be prompted for the password):
docker run --rm -it authelia/authelia:4.38 authelia crypto hash generate argon2 -- --random.length 72

# Paste the resulting $argon2id$... string into authelia/users.yml
# (keep your chosen password in your password manager — there is no recovery)
chmod 0600 authelia/users.yml
```

## Verifying permissions

```bash
ls -l secrets/ authelia/users.yml
# Every file should show: -rw------- (0600)
```

## Notes

- All of these files are mounted into containers via Docker Compose `secrets:` blocks (exposed at `/run/secrets/<name>` inside the container) or via bind mounts with read-only flags.
- Rotating a secret: generate a new value, update the file, run `docker compose up -d --force-recreate <service>`.
- If you lose the authelia password: delete `authelia/db.sqlite3` (if present) and `authelia/users.yml`, then re-generate the hash. Sessions will be invalidated but data is safe.
