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

---
Task ID: R4 (webDevReview round 4)
Agent: Z.ai Code (autonomous review & feature round)
Task: QA + subject detail drawer w/ what-if planner + header/notification/keyboard UX + styling polish

Work Log / Current status assessment:
- QA: app healthy at start of round (server up, 0 console/page errors, scheduler syncing demo data every ~15 min, no regressions). No user-visible bugs found → proceeded to feature work per backlog.

Completed modifications:
1. SUBJECT DETAIL DRAWER (flagship new feature — fulfills the dashboard's existing promise "Tap a subject for details and what-if planning", which previously just jumped tabs):
   - New src/components/erp/subject-drawer.tsx using shadcn Sheet (right side, full-width on mobile, max-w-lg on desktop).
   - Status-colored gradient header band (emerald/amber/red blur accent): code chip, StatusChip, name, last-updated, big AnimatedNumber %, MiniBar.
   - 4-stat grid: Present / Missed / Total / To-reach (or ✓ On target).
   - WHAT-IF PLANNER: Attend|Skip mode toggle (remounts state), slider 0–40 + keyboard-accessible (arrow keys verified), reset button.
     Projections: attend → (present+n)/(total+n); skip → present/(total+n). Shows projected %, ±pts delta chip, projected status panel, plus shortcut buttons "Reach {target}% → attend N" (sets slider to classesToReachTarget) and "Max skips (M) — still {target}%".
   - Per-subject Attendance trend (pure-SVG MiniAreaChart, last ≤30 snapshots, first→last labels).
   - Weekly classes for the subject from /api/timetable — grouped by day, TODAY FIRST ordering, today highlighted, per-day time chips, {n}/week badge.
   - Footer honesty note: recalculated from ERP mirror, never writes to ERP.
   - Wired into BOTH DashboardTab subject rows (whole row opens drawer) and AttendanceTab cards (new "Details · trend · weekly classes" button; inline WhatIfSlider kept for quick planning).
2. HEADER: live "next class" chip (lg+): ongoing class shows pulsing emerald dot + "CS-302 · ends in X min", upcoming shows "in X min"; tooltip with full name + time range; auto-hides when no classes remain today. Uses qk.timetable + dashboard subjects.
3. NOTIFICATION CENTER: filter tabs All/Unread/Alerts with live counts (Alerts = warning+critical), per-filter empty states ("You're all caught up ✓" / "No alerts — everything looks good"). Mark-all-read retained.
4. KEYBOARD SHORTCUTS (page.tsx): 1–4 switch tabs, S = Sync Now (guarded while syncing), T = theme toggle, ? toggles shortcuts help Dialog (also button in footer). Ignored while typing in inputs/textareas/selects/contentEditable and with modifier keys. Tab triggers now show tiny kbd number hints.
5. STYLING polish (mandatory): .kbd + .kbd-hint keycap styles (mono, 2px bottom border, theme-aware via color-mix); .erp-pulse-dot keyframe for the ongoing-class dot; drawer header pr fix so the close button never overlaps the % on mobile; all animations respect prefers-reduced-motion.

Verification results:
- bun run lint: clean (fixed 1 error: setState-in-effect removed — planner resets via key={s.id} remount instead; 1 unused directive removed).
- agent-browser E2E: drawer opens from dashboard rows AND attendance cards; "Reach 75% → attend 15" produced exactly (27+15)/(41+15)=75.00% (+9.15 pts); skip n=3 → 27/44=61.36% (−4.49 pts); slider arrow-key interaction works.
- Shortcuts verified: 1/2/3/4 tab switching, ? dialog, T dark-mode toggle, S sync. Notification filters: All 10 / Unread 8 / Alerts 4 all correct.
- Next-class chip live-verified ("CS-302 in 67 min" counting down). Drawer weekly classes ordered today-first (Fri first, highlighted).
- Desktop light + dark, 390×844 mobile (drawer full-width) all screenshot-verified; 0 console errors, 0 page errors.

Unresolved issues / risks & next-phase recommendations:
1. Live ERP scrape parser still generic (needs one real student login to fine-tune) — demo mode covers everything meanwhile. TOP priority if credentials arrive.
2. Drawer trend reads from /api/history snapshots; in live mode history accrues honestly (no backfill), so the trend panel may be empty on day one — expected and explained in its empty state.
3. Backlog: per-type notification preferences, weekly digest (email/report), PWA install-prompt UI, "ongoing class" hero strip variant of the header chip, command palette (Ctrl+K).

---
Task ID: R5 (webDevReview round 5)
Agent: Z.ai Code (autonomous review & feature round)
Task: QA + command palette (⌘K) + notification preferences + attendance heatmap + fixes/polish

Work Log / Current status assessment:
- QA found a REAL bug this round: a React hydration mismatch in the header ThemeToggle — the
  aria-label wasn't gated by the `mounted` flag (icon was, label wasn't), so SSR rendered
  "Switch to dark mode" while the hydrated client rendered "Switch to light mode" (visible as a
  "1 Issue" red badge in the Next.js dev overlay). Fixed by gating the label: stable
  "Toggle theme" until mounted. Verified gone after a fresh load (0 console/page errors).

Completed modifications:
1. BUG FIX: ThemeToggle hydration mismatch (src/components/erp/header.tsx) — aria-label now
   `mounted ? (isDark ? "Switch to light mode" : "Switch to dark mode") : "Toggle theme"`.
2. COMMAND PALETTE (⌘K / Ctrl+K) — new src/components/erp/command-palette.tsx (shadcn CommandDialog):
   - Fuzzy subject search with code + live percentage → navigates to Attendance and opens the
     subject detail drawer (event `erp:open-subject`; AttendanceTab stores the CODE and derives the
     SubjectView from data, so the drawer also opens when the event arrives before the query
     resolves — lint-clean, no setState-in-effect).
   - Navigate (Dashboard/Attendance/Reminders/Settings with kbd hints), Sync now (reuses page's
     syncNow mutation), New personal reminder (event `erp:new-reminder` opens the Reminders dialog),
     theme toggle, Simulate ERP change (demo only), Keyboard shortcuts help.
   - Header gained a "Search… ⌘K" trigger button (hidden label on small screens); Ctrl+K toggles.
   - SHORTCUTS dialog now lists ⌘K first.
3. NOTIFICATION PREFERENCES (per-type):
   - src/lib/settings.ts: AppSettings.notifyPrefs (Record<string, boolean>, missing = on),
     NOTIFY_TYPES whitelist (ERP_CHANGE, SYNC_SUCCESS, SYNC_FAILURE, ATTENDANCE_WARNING,
     REMINDER_CHANGE), key-wise merge in updateSettings, isNotifyEnabled helper.
   - engine notify() checks prefs BEFORE creating a notification (future events only — existing
     notifications never retroactively hidden; stated in the UI).
   - PUT /api/settings accepts + sanitizes notifyPrefs (unknown keys dropped).
   - Settings UI: new "Notifications" card — 5 toggles w/ per-type icons (BellOff when muted),
     "n/5 on" badge, dirty-gated Save button, skeleton loading, honest "applies to future events" note.
   - E2E verified: toggled ERP_CHANGE off → save → GET /api/settings shows {"ERP_CHANGE": false} →
     demo evolve applied 6 changes → ERP_CHANGE notification count unchanged (6→6) → re-enabled.
4. ATTENDANCE HISTORY HEATMAP (new card on Attendance tab, src/components/erp/history-heatmap.tsx):
   - GitHub-style 12-week calendar (Mon–Sun rows) built from /api/history overall snapshots
     (last snapshot per local day wins), colored vs target: red <target−10 / amber <target /
     emerald ≥target (two intensities), muted = no data, future cells transparent.
   - Month labels mark the column CONTAINING the 1st of a month (handles mid-week month starts —
     first version missed "Oct"); Mon/Wed/Fri day labels; hover caption (aria-live) with date,
     percentage and present/total; legend with target note; horizontal scroll on tiny screens;
     staggered pop-in animation (prefers-reduced-motion respected); empty state explains honest
     live-mode accrual.
5. CHART LABEL FIX: trend x-axis no longer repeats "2 Oct" when several syncs happen the same day —
   first point of a day shows "d MMM", subsequent same-day points show "HH:mm".
6. STYLING polish (mandatory): .erp-heat-cell staggered entrance keyframes (reduced-motion safe),
   .erp-cmd-trigger hover state for the header search button, sonner --normal-offset raised so
   toasts never cover sticky header actions, BellOff/idle-state styling in the prefs card.

Verification results:
- bun run lint: clean (fixed react-hooks/set-state-in-effect in AttendanceTab via derived state).
- agent-browser fresh session: 0 console errors, 0 page errors; hydration "Issue" badge gone.
- E2E: Ctrl+K opens palette; "web" → CS-304 → drawer opened on Attendance tab; palette
  "New personal reminder" → Reminders tab + create dialog; prefs toggle → save → API-verified →
  engine suppression verified via demo evolve; heatmap Oct label + caption "Fri 2 Oct — 72.13%
  (132/183 classes)" correct; trend axis shows 07:46/07:52/09:58 for same-day syncs.
- Desktop dark + light, 390×844 mobile all screenshot-verified. Sync state healthy (demo mode,
  scheduler running, "Last ERP sync" ticking).

Unresolved issues / risks & next-phase recommendations:
1. Live ERP scrape parser still generic — needs one real student login to fine-tune against the
   actual dashboard HTML (demo mode covers everything meanwhile). TOP priority if credentials arrive.
2. In live mode the heatmap starts sparse (honest accrual); the empty state explains this.
3. Backlog: PWA install-prompt UI, weekly digest report, per-reminder due-date notifications
   (browser Notification API), "ongoing class" hero strip on the dashboard, Ctrl+K recent-actions.

---
Task ID: R6 (webDevReview round 6)
Agent: Z.ai Code (autonomous review & feature round)
Task: QA + weekly digest report + browser due-reminders + PWA install UI + styling polish

Work Log / Current status assessment:
- Read worklog (R1–R5 complete; app feature-rich and stable). QA pass first: fresh agent-browser
  session → all 4 tabs navigate, scheduler syncing demo data ("Last ERP sync" ticking), zero
  console/page errors, no hydration issues. Security spot-check: ERP password field value is empty
  (dots are a placeholder only) and localStorage contains just "theme" — no credential leakage.
  No bugs found → proceeded to backlog features per R5 recommendations.

Completed modifications:
1. WEEKLY DIGEST REPORT (new feature):
   - GET /api/digest?days=7 (1–90 clamp, tolerant of bad params): first→last AttendanceSnapshot
     diffs per subject + "__overall__" → pctStart/pctEnd/deltaPts plus honest attended/held/missed
     derived from snapshot deltas; sync health (total/success/failed from SyncLog); ChangeEvent
     count; reminders created/completed; upcoming ACTIVE reminders (±window).
   - src/components/erp/digest-dialog.tsx: "This week" button on the dashboard Overall attendance
     card opens a Weekly report dialog — hero movement panel, per-subject table (sticky header,
     delta chips, Held column hidden on mobile), 2×2 activity tiles, next-7-days list with source
     badges, Copy summary (clipboard text report) + Download CSV actions, DEMO DATA badge in demo
     mode, honest footnote that totals come from sync-time snapshots (no invented data).
2. BROWSER DUE-REMINDER NOTIFICATIONS (new feature):
   - src/lib/browser-reminders.ts: device-local opt-in (permission + localStorage flag, change
     event), once-per-reminder notified bookkeeping with 7-day prune, test notification helper.
   - src/components/erp/use-due-notifications.ts: mounted on the page — while granted+enabled it
     polls active reminders (30s) and fires a system notification + in-app toast when something
     becomes due (auto-managed ATTENDANCE_WARNING excluded; items >24h overdue never fire).
   - Settings "Browser reminders" card: OFF/ON/BLOCKED/NOT-SUPPORTED badge, permission request
     flow, per-device switch, "Send a test". Reminders tab gained a dismissible opt-in banner.
3. PWA INSTALL UI (completes the R3 manifest work):
   - src/components/erp/install-prompt.ts: module-level beforeinstallprompt capture, appinstalled
     handling, useCanInstall/useIsInstalled/promptInstall, iOS detection.
   - Header install icon-button (only while the browser offers the prompt); Settings "Install the
     app" card covering three states: Install now button → INSTALLED badge → iOS "Add to Home
     Screen" steps → generic fallback instructions.
4. STYLING polish (mandatory):
   - MotionConfig reducedMotion="user" app-wide (every framer animation now respects OS setting).
   - Staggered entrance for the dashboard row-1 grid; .erp-card-accent emerald gradient hairline
     (overall card + digest dialog), reduced-motion aware.
   - Digest dialog: gradient hero, delta chips (▲/▼ emerald/red), sticky table header, theme-aware
     in both light and dark.

Verification results:
- bun run lint: clean (fixed one react-hooks/set-state-in-effect in the notifications hook via
  lazy useState initializers instead of setState-in-effect).
- /api/digest verified with real data: overall 70.18%→72.13% (+1.96 pts), per-subject deltas,
  14 syncs (12 ok/2 failed), 49 changes, 8 reminders created, 4 upcoming; days=abc / days=500 → 200.
- agent-browser E2E: "This week" dialog opens from the dashboard (mobile 390px + desktop 1280px,
  dark + light screenshots); Copy summary → "Report copied to clipboard" toast; Download CSV click
  clean; browser-reminders permission flow exercised end-to-end (headless denies → honest BLOCKED
  badge + guidance shown); "Install now" → prompt fired → "Install dismissed" handled gracefully;
  fresh load: 0 console errors, 0 page errors; dev.log clean.

Unresolved issues / risks & next-phase recommendations:
1. Live ERP scrape parser still generic — needs one real student login to fine-tune against the
   actual dashboard HTML (demo mode covers everything meanwhile). TOP priority if credentials arrive.
2. Browser due-reminders fire only while the app is open (page-level watcher). A service-worker
   push/scheduled-check would cover closed-tab cases — bigger change, worth doing only for a
   deployed build.
3. Backlog: per-subject target overrides, weekly digest as scheduled email/report, command-palette
   recent actions, "add to timetable from drawer" shortcut.
---
Task ID: R7 (webDevReview round 7)
Agent: Z.ai Code (autonomous review & feature round)
Task: QA + per-subject target overrides (flagship) + add-to-timetable from drawer + 3 bug fixes + styling polish

Work Log / Current status assessment:
- Read worklog (R1–R6 done). QA sweep: server healthy, scheduler syncing, all 4 tabs navigate, 0 console/page
  errors → no blocking bugs at start of round → proceeded to backlog work (R6 recommendation #1: per-subject
  target overrides) and found/fixed 3 real issues during feature E2E (below).

Completed modifications:
1. PER-SUBJECT TARGET OVERRIDES (flagship — different papers can require different attendance):
   - Backend: AppSettings.subjectTargets (code → %, missing = global; NO schema change needed — stored in the
     settings KV so overrides survive subject removal/re-add and never collide with sync writes; also avoided
     the known "db:push needs dev-server restart" risk).
   - NEW endpoint PUT /api/subjects/target {code, targetPct|null} — 404 unknown code, clamp 1–100, null resets
     to global, then locally recomputes warnings (no ERP call).
   - views.ts SubjectView now carries effective `targetPct` + `hasCustomTarget`; dashboard/attendance APIs pass
     settings.subjectTargets through.
   - engine recomputeAttendanceWarnings(targetPct, {prevByCode?, subjectTargets?}) — per-subject effective
     target for below/wasBelow/notification text ("vs 70% target (custom)") and the auto-managed warning
     reminder; applySnapshot now takes full settings.
   - UI: SubjectDrawer "Target for this subject" editor (preset chips 60–85% + "Default (global%)" reset +
     saved-confirmation + toasts, invalidates attendance/dashboard/settings); WhatIf planner + header now use
     the subject's effective target ("Reach 85% → attend 18"). New SubjectTargetsCard in Settings (table with
     per-row Select + reset, "n/m custom" badge, sticky header, scroll). CustomTargetChip (amber, ◎ target N%
     · custom) on dashboard rows, attendance cards, drawer header and settings rows. Attendance summary strip
     shows "n custom target(s)" badge. CSV export now exports each subject's OWN target.
2. ADD-TO-TIMETABLE FROM SUBJECT DRAWER (R6 backlog):
   - SubjectTimetable gained an inline "Add" form (day select w/ today marker + start/end time inputs,
     client validation, server-verified) → POST /api/timetable (source=personal) → invalidates timetable +
     dashboard → toast. Empty state now points at the inline form instead of sending users elsewhere.
3. BUG FIXES found by QA during this round:
   a. STALE DRAWER after target change — DashboardTab stored the whole SubjectView object in state, so the
      drawer kept pre-refetch values after invalidation. Fixed: store the CODE and derive the view from fresh
      query data (same pattern AttendanceTab already used).
   b. TREND HISTORY REGRESSION — the demo 14-day backfill stamped its final "today" point at a RANDOM hour
      (9–15h). It ran when overall was 132/183, landing at 09:58 — AFTER all real sync points of the day — so
      /api/history's last point (and the chart header/delta) showed a stale 72.13% instead of the live 68.97%.
      Fixed: final backfill point is stamped at now−60s (code) + one-off SQL cleanup of the artifact rows
      (capturedAt=1790935080000). /api/history last point verified == current overall.
   c. HYDRATION MISMATCH in InstallButton ("1 Issue" badge) — useCanInstall/useIsInstalled initialized state
      from browser-only data (deferredPrompt / localStorage / matchMedia). When beforeinstallprompt fired
      before hydration, SSR HTML ≠ client first render. Fixed: both hooks start false and sync after mount.
   d. MOBILE Overall strip squeeze (390px) — Export CSV button stole flex width, crushing the stats text to
      ~90px. Fixed: button wraps to a full-width row under the ring+text on mobile (w-full sm:w-auto).
4. STYLING polish (mandatory):
   - Trend chart: dashed "target 75%" ReferenceLine (theme-aware var(--muted-foreground), insideTopRight
     label) on both the overall area chart and the per-subject line chart — instantly visible headroom/breach.
   - Sparkline overflow fix via min-w-0 on the CardHeader grid child (long unwrapped titles like "Database
     Management Systems" previously pushed the sparkline column past the card edge — verified −25px inset on
     all 5 cards now).
   - SubjectTargetEditor segmented preset buttons (emerald active state, dashed reset, disabled-while-pending,
     aria-pressed group); subject rows/cards gained the amber custom-target chip; settings table rows with
     hover + sticky header.

Verification results:
- bun run lint: clean. agent-browser: fresh sessions desktop (1280) + mobile (390), light + dark — 0 console
  errors, 0 page errors, hydration "1 Issue" badge GONE after fix.
- API E2E: PUT /api/subjects/target 85 → CS-302 status warning→"At risk" with classesToTarget 18 (math
  verified: ceil((0.85·49−39)/0.15)=18); erp:warn:CS-302 reminder deleted when 70% target made it safe and
  warning text "64.44% vs 70% target (custom). Attend the next 9 classes." correct for CS-304; clamp 150→100;
  404 unknown code; reset→global works. Settings card select→70 verified server-side.
- Drawer E2E: editor reflects changes live after the stale-state fix (GLOBAL→CUSTOM chips, "On track ✓"→"At
  risk ✗"); timetable Add form created Fri 15:00–15:50 for CS-302 (8/week, source=personal verified in DB).
- Trend chart verified: ReferenceLine renders (1 node, "target 75%" label); header "Overall 68.97% · target
  75%" now matches the ring; same-day time labels intact.

Unresolved issues / risks & next-phase recommendations:
1. Live ERP scrape parser still generic — needs one real student login to fine-tune against the actual
   dashboard HTML (demo mode covers everything meanwhile). TOP priority if credentials arrive.
2. Custom targets live in app settings — a future multi-user/deploy story would want them per-account (fine
   for the single-student scope).
3. Backlog: per-subject target in the command palette rows; "target line" per subject on the trend chart when
   a single subject is selected; timetable conflict warnings (overlapping slots); weekly digest email.
