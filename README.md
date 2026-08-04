# WEDGE//PLAN

Wedge yardage matrix and practice tracker. Offline-first PWA, installs to the
iPhone home screen, optional Supabase sync.

## What it does

Logs every wedge shot against a **club × feel** matrix (60/55/50 × knee/hip/¾/chest),
averages the most recent 50 shots per stock, flags gaps over 9 yards, and tracks
lag putting sets.

## Setup

1. Create the repo, push these files.
2. **Settings → Pages → Source: Deploy from branch → main → / (root)**
3. Wait for the green check, open `https://USER.github.io/wedge-plan/`
4. Safari → Share → **Add to Home Screen**

Runs fully offline from step 3. Supabase is optional.

## Supabase (optional — for cross-device sync)

1. New project at supabase.com
2. SQL Editor → paste and run `wedge-schema.sql`
3. `cp config.example.js config.js`, fill in URL + anon key, set `SYNC_ENABLED: true`
4. **Turn on RLS.** The anon key ships in the client. Without RLS anyone who
   views source can write to your tables.

### Seeding from the old app

Export JSON from the Claude artifact (MATRIX tab → COPY ALL DATA AS JSON), save
as `wedge-export.json`, then:

```
npm i @supabase/supabase-js
export SUPABASE_URL=... SUPABASE_SERVICE_KEY=...
node import-to-supabase.js wedge-export.json
```

Use the **service role** key here, not the anon key, and never commit it.

### Keepalive

`.github/workflows/keepalive.yml` pings Supabase daily so the free tier doesn't
pause after 7 days idle, and commits a `.keepalive` timestamp so GitHub doesn't
disable the scheduled workflow after 60 days of repo inactivity.

Add repo secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`.

## Deploying changes

Bump `CACHE` in `sw.js` every time you change the app, or phones will keep
serving the cached version.

## Data notes

- Shots are never deleted. The rolling 50 is a query, so season-over-season
  history stays intact.
- Track `ball_type` and `surface`. Range balls vs gamer is worth about a yard of
  dispersion, and mats hide fat strikes. You cannot backfill these.
- Watch **SD as a percent of carry**, not max-minus-min. Max-minus-min grows with
  sample size, so it gets worse as you get better.
