# Deploying the GMIU Attendance Dashboard

This guide covers deploying to **Vercel** (zero-config, verified with a clean
production build) and self-hosting with the bundled standalone output.

---

## 1. What this app needs at runtime

| Need | How it is satisfied | Files |
|---|---|---|
| Database | Prisma + SQLite via `DATABASE_URL` | `prisma/schema.prisma`, `db/custom.db` |
| Secrets at rest | `APP_ENCRYPTION_KEY` env **or** `db/encryption.key` file (env wins) | `src/lib/crypto.ts` |
| Background sync | In-process 60s tick on long-lived servers; **Vercel Cron** on serverless | `src/instrumentation.ts`, `/api/cron/sync` |
| ERP credentials | Entered in the app's Settings tab, stored AES-256-GCM-encrypted in the DB | — |

Everything else (dashboard, attendance, ALA wall, archive, reminders, PWA
manifest) is standard Next.js App Router and deploys as-is.

---

## 2. Vercel, step by step

1. **Push the repo to GitHub/GitLab/Bitbucket.**
2. **Import into Vercel** — the included `vercel.json` pins the Next.js
   framework preset; `npm run build` runs `prisma generate && next build`
   automatically (the `postinstall` hook also generates the Prisma client).
3. **Set environment variables** (Project → Settings → Environment Variables):

   | Variable | Value | Required? |
   |---|---|---|
   | `DATABASE_URL` | `file:/tmp/custom.db` | **Yes** — the deployed filesystem is read-only outside `/tmp` |
   | `APP_ENCRYPTION_KEY` | `openssl rand -hex 32` | **Yes** — the `db/encryption.key` file cannot carry your secret to Vercel |
   | `CRON_SECRET` | `openssl rand -hex 24` | Needed only for cron-driven sync |

4. **First boot seeds the database.** The app creates its tables on demand
   (Prisma `db push` schema) — but the SQLite file starts EMPTY on a fresh
   instance. Open the app, go to **Settings**, enter the ERP login, and press
   **Sync Now**. Data appears immediately.
5. **(Optional) Cron sync** — copy the `crons` block from
   `vercel.crons.example.json` into your `vercel.json`:

   ```json
   "crons": [{ "path": "/api/cron/sync", "schedule": "*/15 * * * *" }]
   ```

   Vercel Cron then calls `/api/cron/sync` with your `CRON_SECRET` as a Bearer
   token and the engine's own lock prevents overlapping runs.
   **Plan note:** Vercel's Hobby plan allows cron jobs only once per day — use
   `"0 3 * * *"` there (the app stays correct; data just refreshes less often).
   Pro supports 15-minute cadence. No cron at all still works: the dashboard
   has a **Sync Now** button (POST `/api/sync`).

### The honest serverless trade-off (read this)

SQLite is a **file** database. On Vercel each serverless instance has its own
ephemeral `/tmp`, so with `DATABASE_URL=file:/tmp/custom.db`:

- ✅ Reads, the dashboard, reminders, the archive shelf, ALA wall — all work.
- ✅ A warm instance keeps its data and stays fresh via cron + Sync Now.
- ⚠️ A cold instance starts from an **empty** database (one Sync Now or cron
  hit re-syncs everything — snapshots rebuild from the ERP, but local-only
  data such as ALA notes, personal reminders, target overrides are **not**
  re-creatable).
- ⚠️ Multiple concurrent instances do not share data.

**This is a live, stateful, single-user dashboard.** For the full experience
(the 15-minute scheduler tick, durable snapshots, guaranteed ALA-note
persistence), deploy on a host with a **persistent disk and a long-lived
process** — a $5 VPS, Railway, Render, or Fly.io — using the self-host path
below, or keep using it exactly as it runs today.

---

## 3. Self-hosting (standalone output)

```bash
npm install          # runs prisma generate via postinstall
npm run build        # prisma generate + next build + standalone assembly
npm run start        # serves .next/standalone/server.js
```

Set `DATABASE_URL` to a path on a real disk (e.g. `file:../db/custom.db`
relative to `prisma/`, or an absolute path) and either provide
`db/encryption.key` or `APP_ENCRYPTION_KEY`. The in-process scheduler runs by
itself on any long-lived server — no cron needed.

The build script is VERCEL-aware: on Vercel (`VERCEL=1`) it skips the
standalone assembly step entirely; locally it assembles
`.next/standalone/.next/static` + `public/` per the Next.js standalone recipe
(cross-platform, no shell `cp` dependency — works on Windows too).

---

## 4. Verified checks (2026-10-05, Vercel-compat pass)

- `next build` production build: **PASS, twice** (31 API routes + page shell
  compiled, zero errors; second build after the r116 crypto hardening).
- Standalone production server **booted and exercised**: `/` 200,
  `/api/dashboard` serving LIVE data, `/api/history?scope=archive` live —
  the bundled SQLite + key files work from the traced bundle.
- `tsc --noEmit`: **0 errors in `src/`**.
- `eslint .`: **0 errors** (13 warnings = the app's documented post-mount
  hydration pattern, kept as signal via `react-hooks/set-state-in-effect: warn`).
- Test battery (48 pinned rule books): **0 failed**.
- `outputFileTracingIncludes` pins `db/**` into every serverless bundle —
  verified on disk: `.next/standalone/db/custom.db` + `encryption.key` exist.
- `/api/cron/sync` rejects unauthenticated calls with **503** and wrong
  secrets with **503** (no open sync trigger).
- r116 crypto hardening (same pass): `decryptSecret` now tries every key
  candidate (env → file → documented fallback) instead of only the priority
  key, and the key is pinned in `.env` as `APP_ENCRYPTION_KEY` — the
  third recurrence of the "key changed?" sync-failure class
  (r100 → r105 → 13:28:45 UTC incident) is closed with pinned tests
  (`scripts/test-crypto-multik-r116.ts`, 7/7) including a live regression
  on the real stored credential.
