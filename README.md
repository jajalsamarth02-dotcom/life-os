# GMIU Attendance Dashboard

A live, read-only student attendance dashboard for **Gyanmanjari Innovative
University** — automatic ERP sync, honest math, zero-judgment reminders.

Built with **Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 ·
shadcn/ui · Prisma (SQLite) · TanStack Query**.

## Highlights

- **Auto-sync** from the university ERP (attendance, timetable, ALA/assignments,
  exam deadlines) with snapshot history and a 90-day retention window
- **Honest attendance math** — status chips, recovery plans and what-if
  simulators that never round in your favor; early-term sample-size context
  (r113) that sizes the sample without touching the numbers
- **Term-rollover archive** (r114) — pre-rollover subjects stay reachable,
  read-only, one toggle away
- **ALA bridge** (r115) — the ERP's ALA course ids are bridged to live
  subjects by exact name match; one tap from an assignment group to its
  subject's attendance drawer
- **Reminders** — ERP deadlines + personal reminders, private notes/priorities,
  .ics export, WhatsApp/ntfy digests
- **PWA-ready** — installable, offline-aware (renders from the last synced cache)

## Getting started

```bash
cp .env.example .env      # then edit DATABASE_URL / APP_ENCRYPTION_KEY
npm install               # runs prisma generate (postinstall)
npm run db:push           # create the SQLite schema
npm run dev               # http://localhost:3000
```

Enter the ERP login in **Settings → ERP connection** and press **Sync Now**.

## Deployment

- **Vercel**: see [DEPLOY.md](./DEPLOY.md) — verified with a clean production
  build; cron-driven sync via `/api/cron/sync` (`CRON_SECRET`-protected).
- **Self-host / VPS**: `npm run build && npm run start` (standalone output,
  in-process scheduler, persistent disk).

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Dev server on :3000 |
| `npm run build` | `prisma generate` + production build (+ standalone assembly off Vercel) |
| `npm run start` | Serve the standalone production build |
| `npm run lint` | ESLint |
| `npm run test` | Pinned rule-book test battery (47 files) |
| `npm run db:push` | Apply `prisma/schema.prisma` to the SQLite file |

## Project conventions (from the work log)

- **Honesty contracts** — every "lens"/note module (`term-pulse.ts`,
  `term-archive.ts`, `ala-bridge.ts`) is read-only: it never computes a
  percentage or status, never guesses an association, and renders nothing
  when it has nothing true to say.
- **Exact matching only** — ALA-course ↔ subject association is exact
  normalized-name equality; fuzzy/substring/initial guesses are test-pinned
  as forbidden.
- Secrets live in `APP_ENCRYPTION_KEY` (env) with `db/encryption.key` as the
  file fallback; ERP credentials are AES-256-GCM encrypted at rest.
