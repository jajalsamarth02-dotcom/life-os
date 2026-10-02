# Worklog — Automatic ERP-Sync Student System

Project: Personal student web app that auto-syncs attendance/academic info from college ERP
(https://erp.gmiu.edu.in — Gyanmanjari Innovative University, Laravel session-based), recalculates
attendance, generates warnings & reminders. Single route `/` with 4 sections: Dashboard, Attendance,
Reminders, Settings.

---
Task ID: 1
Agent: Z.ai Code (main orchestrator)
Task: Project recon, ERP research, DB schema design

Work Log:
- Explored scaffold: Next.js 16 + Prisma 6 (SQLite at db/custom.db), full shadcn/ui set, TanStack Query 5, sonner, framer-motion, next-themes available.
- Researched target ERP: https://erp.gmiu.edu.in/student/dashboard → 302 → /student/login. Reachable from sandbox (~0.5s).
- Login form (Laravel): POST /student/login with `_token` (CSRF in hidden input + meta tag), `email`, `password`, optional `remember`, submit. NO CAPTCHA detected → authorized session-based integration is technically feasible (student's own credentials, server-side only).
- Session cookies: `gyanmanjari_innovative_university_session` (HttpOnly) + `XSRF-TOKEN`.
- Dashboard HTML structure behind login is unknown (no credentials) → live connector must be resilient: login → fetch dashboard/attendance pages → generic HTML table parsing → if structure unrecognized, report PARSE_FAILED honestly instead of inventing data.
- Designed Prisma schema: Setting, ErpConnection (AES-256-GCM encrypted secret), SyncState (singleton), SyncLog, Subject, ChangeEvent, Reminder (ERP source dedup via unique externalId), Notification.

Stage Summary:
- ERP integration strategy: LIVE session-based connector (attempts real sync with user's credentials, honest failure reporting) + DEMO simulator connector (clearly labeled, evolves data over time to demonstrate the full sync pipeline without real credentials). Demo mode ON by default; auto-disables when a real live sync succeeds.
- Core calc: attendance% = present/total×100; classesToReachTarget = ceil((target·total−100·present)/(100−target)); classesCanSkip = floor(100·present/target − total).
- Architecture: connectors → sync engine (change detection → DB update → recalc → notifications) → REST API → single-page UI (4 tabs). Background scheduler via Next.js instrumentation.ts (periodic sync + failure backoff), plus manual [Sync Now].

---
Task ID: 2-b
Agent: full-stack-developer (frontend) + Z.ai Code (integration & verification)
Task: Complete frontend UI (4 tabs) + E2E verification

Work Log:
- Built src/components/erp/: providers.tsx (next-themes + TanStack Query + sonner), types.ts, api.ts (typed fetch layer), shared.tsx (badges, rings, helpers), header.tsx, dashboard-tab.tsx, attendance-tab.tsx, reminders-tab.tsx, settings-tab.tsx.
- Rewrote src/app/page.tsx: sticky header, sync-failure banner w/ Try Again, dismissible demo strip, 4 tabs with framer-motion transitions, sticky footer w/ safe-area inset + mt-auto pattern.
- Theme: emerald primary (safe/connected), amber (warning/demo), red (danger/failure). No blue/indigo. Dark mode via next-themes. Fully responsive (2-col tab grid on mobile, 4-col on desktop).
- Added src/instrumentation.ts + src/lib/sync/scheduler.ts: 60s tick, respects interval/backoff/auto-sync, first startup sync after 8s.

Verification (agent-browser, zero console errors):
- Dashboard renders live data; ring 73.26% → 72.32% evolved via background scheduler + demo time-based simulation (autonomous pipeline confirmed).
- [Sync Now] → toast "Sync complete — 4 changes". Sync history table logs manual/demo runs w/ duration.
- Reminders: grouped Today/Tomorrow, ERP badges + lock icons, auto-managed ATTENDANCE_WARNING items, created personal reminder "Submit project report" (Tomorrow 6 PM) via dialog, delete only on personal items.
- Settings: live ERP connect attempt with fake credentials hit the REAL erp.gmiu.edu.in (CSRF→login POST) and was honestly rejected "ERP redirected back to the login…" (INVALID_CREDENTIALS path verified end-to-end). Credentials NOT stored on auth failure; PARSE_FAILED/AUTH_FAILED do store for retry.
- Simulate ERP change → new ChangeEvent "Java Programming: Present 29→30, Total 37→38 (78.38%→78.95%)" → dashboard updated. Full loop verified.
- Dark mode, mobile viewport (390x844), notification bell w/ unread badge all verified. bun run lint: clean.

Stage Summary:
- App is feature-complete per spec sections 1–15: auto sync + change detection + recalc + warnings + dedup reminders (externalId) + personal reminders + manual Sync Now + honest failure handling + empty states + read-only data principle.
- Known limitation (by design): live scrape parser is generic; real scraping success depends on actual dashboard HTML (needs student credentials once to fine-tune). Demo mode keeps the app fully functional meanwhile.

---
Task ID: R2 (webDevReview round 2)
Agent: Z.ai Code (autonomous review & feature round)
Task: QA assessment + new features (attendance trend history) + styling polish

Work Log / Current status assessment:
- QA pass: app stable, 0 console errors, background scheduler autonomously evolving demo data ("Last ERP sync" ticking). No user-visible bugs found. One transient React hooks-order error appeared only from mid-edit Fast Refresh; verified gone in fresh sessions (0 errors across refetch cycles).

Completed modifications:
1. BACKEND — Attendance trend history:
   - New model AttendanceSnapshot (subjectCode, present, total, source, capturedAt; indexed). db:push applied.
   - src/lib/sync/history.ts: recordSnapshots() after every successful sync (on change or 6h staleness) incl. "__overall__" weighted row; 90-day prune (10% roll); demo-mode 14-day plausible backfill ending exactly at current values (live mode never backfills — honest accrual).
   - Wired into runSync(); GET /api/history returns overall + per-subject series.
   - src/lib/db.ts made self-healing: drops stale global PrismaClient cached by hot-reload when generated schema gains models.
2. FRONTEND — new features:
   - TrendSection (recharts): overall emerald area + dashed per-subject lines, subject toggle chips, 7d/14d/30d range selector, trend delta badge, interactive tooltips.
   - Sparklines (inline SVG) on every subject card header; spring-animated percentage counters (AnimatedNumber) on cards + dashboard ring.
   - Dashboard "Next up" countdown strip (live-ticking, overdue detection, excludes auto-managed warnings).
   - Subject sort dropdown: Lowest attendance first (default) / Highest / Name / Recently updated.
   - CSV export: attendance (code, present/total/absent, %, status, classes needed/can-miss) + reminders (title, source, type, due, status, description) — client-side blob download.
3. STYLING polish (mandatory):
   - Ambient emerald/amber gradient blobs behind content (pointer-events-none, theme-aware).
   - erp-shimmer keyframe: progress bars shimmer while sync.status === "syncing" (respects prefers-reduced-motion).
   - Card hover shadow-lift on dashboard cards; tighter chart axes (auto domain, tickCount=5); fixed sparkline/% chip squeeze with w-24 shrink-0 column.

Verification results:
- bun run lint: clean. agent-browser (fresh session): 0 console errors, 0 page errors.
- /api/history verified: 14 backfilled daily points, 5 subject series, weighted overall.
- Desktop (1280px) + mobile (390px) screenshots verified; countdown strip, sort dropdown, Export CSV buttons, trend chart + sparklines all render and respond.

OPERATIONAL NOTE (important for next rounds):
- The dev server (PID ~6685/6835) is now started manually via `setsid bash -c 'exec bun run dev'` because the original supervisor did not respawn it after I killed the next-server child (needed to clear a stale Prisma client after db:push). It survives across tool calls. If it ever goes down: `cd /home/z/my-project && (setsid nohup bun run dev < /dev/null >> /tmp/devwatch.log 2>&1 &)` and wait ~20s. After ANY future prisma db:push, the self-healing db.ts should make restarts unnecessary.

Unresolved issues / risks & next-phase recommendations:
1. Live scrape parser still generic (needs one real login to fine-tune against actual dashboard HTML) — demo mode covers UX meanwhile. PRIORITY if user provides credentials.
2. Trend chart shows demo-era backfill once live mode activates; acceptable (labeled), but could filter by snapshot.source if desired.
3. Ideas backlog: timetable support ("now" highlight), notification per-type preferences, PWA install + push reminders, weekly attendance email digest.

---
Task ID: R3 (webDevReview round 3)
Agent: Z.ai Code (autonomous review & feature round)
Task: QA + weekly timetable feature + PWA + fixes

Work Log / Current status assessment:
- QA: app healthy (server up, 0 console/page errors), scheduler syncing autonomously. No blocking bugs.

Completed modifications:
1. WEEKLY TIMETABLE (new feature, spec §2 "timetable changed if available" groundwork):
   - Model TimetableSlot (dayOfWeek 0-6, startMin/endMin, subjectCode, source demo|personal). db:push applied.
   - src/lib/timetable.ts: ensureDemoTimetable() seeds a realistic Mon–Sat schedule once (flag-gated, Mon–Fri 4-5 periods + short Saturday); classifySlot() for ongoing/upcoming/done; HHMM helpers.
   - API: GET/POST /api/timetable (validated: day 0-6, HH:MM range, known subject), DELETE /api/timetable/:id. Verified: 26 demo slots seeded, personal slot created via API and via UI dialog.
   - UI: TimetableCard on dashboard — "Today's schedule" with color-coded time chips, LIVE "starts in X min"/"ends in X min" badges (30s tick), ongoing-class hero strip, collapsible Full Week grid (6 columns, today highlighted), Manage dialog (add class form + per-day list with delete + demo badges). Empty state for free days, error state with auto-retry.
2. Dashboard overall card: 7-day trend chip ("▲ 1.96 pts / 7d") computed from /api/history snapshots (green/red by sign).
3. PWA: public/manifest.json + generated icon-192/512 + apple-touch-icon (sharp, emerald graduation-cap design); layout metadata (manifest, icons, appleWebApp, viewport themeColor #10b981, viewportFit cover).
4. BUG FIXES:
   - TimetableCard/ManageDialog: fetchTimetable already returns the slots array — `data?.slots` was always undefined → silent "No classes today". Fixed both occurrences; added explicit error state with retry messaging and faster refetch (60s).
   - db.ts: EXPECTED_MODELS probe list extended (all 10 models) — note: after db:push a dev-server restart is STILL required (bundler caches generated client); documented.

Verification results:
- bun run lint: clean. agent-browser: 0 console errors across desktop + mobile (390px).
- E2E: added "MA-305 Sat 16:00–16:50" via curl POST (source=personal persisted), added "CS-302 Mon 17:00–17:50" through the UI dialog (verified server-side). Full-week grid + today-highlight + live countdowns render correctly.
- Note: automated `select` on the dialog raced with its render in agent-browser (test-harness quirk, not an app bug) — values persisted correctly when set after render.

Unresolved issues / risks & next-phase recommendations:
1. Live ERP timetable scraping: once dashboard HTML is known, upsert TimetableSlot(source="live") inside the live connector; UI already supports the source label.
2. Demo timetable was seeded once; new subjects added later by the simulator are NOT auto-added to the timetable (acceptable; Manage dialog covers it).
3. Backlog: notification per-type preferences, weekly digest, timetable "next class" chip in the header, install-prompt UI for PWA.
