## gstack (REQUIRED — global install)

**Before doing ANY work, verify gstack is installed:**

```bash
test -d ~/.claude/skills/gstack/bin && echo "GSTACK_OK" || echo "GSTACK_MISSING"
```

If GSTACK_MISSING: STOP. Do not proceed. Tell the user:

> gstack is required for all AI-assisted work in this repo.
> Install it:
> ```bash
> git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
> cd ~/.claude/skills/gstack && ./setup --team
> ```
> Then restart your AI coding tool.

Do not skip skills, ignore gstack errors, or work around missing gstack.

Using gstack skills: After install, skills like /qa, /ship, /review, /investigate,
and /browse are available. Use /browse for all web browsing.
Use ~/.claude/skills/gstack/... for gstack file paths (the global path).

## Project: Nick's Travel Logger

**What this is.** A personal PWA travel *predictor* (not a logger). Logs airport milestones (In Transit → At Airport → Bags → Security → Off Plane → Bags → In Transit → At Destination) and uses that history to answer *"my flight is 8 PM from LGA with no bags — what time do I need to leave the house?"* Single-user, no public-facing surface.

**Canonical plan:** `implementation_plan.md` in this directory. Read it before making architectural decisions. If your change contradicts it, update the plan or flag the conflict before coding.

**Stack (self-hosted on Nick's Mac Studio Docker + cloudflared):**
- Frontend: vanilla HTML/CSS/JS PWA, no build step, served by a Caddy container.
- Data: `postgres:16` container, exposed as REST by `postgrest`.
- Hostname: `travel.myhometech.app` (cloudflared tunnel route).
- Auth: Cloudflare Access email allowlist at the edge. No in-app auth. Schema has no `user_id`.
- Maps: Mapbox (autocomplete + pins).
- Backups: nightly `pg_dump` cron container.
- Offline: IndexedDB write-ahead log + background sync.

**Explicitly out of scope:** multi-leg trips, multi-user support, push notifications, weather/traffic/flight-status APIs.

**Legacy files kept for reference (do not extend):** `app_script.js`, `travel_logger_scriptable.js`, `shortcut*.json`, `shortcut.bplist`, `task.md`. The Google Apps Script + Sheet backend is being replaced; do not write new code against them.
