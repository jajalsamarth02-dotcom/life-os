/**
 * r108 — the housekeeping nudge ("the noise ledger"). Pinned here:
 *   • buildHousekeepingNudgeSummary — the plan → three numbers + oldest
 *     stale + signature: stale/ghost/recent counts, ghost counting across
 *     MULTIPLE groups (3 groups × 1 ghost = 3), keep rows never counted as
 *     noise, oldest stale = the due-oldest row (the Jul 16 hook), signature
 *     format `${stale}:${ghosts}:${recent}`
 *   • LIVE-SHAPED COMPOSITION — the real dashboard state this round shipped
 *     against: 14 stale + 3 ghosts + 3 recent over a 17-overdue ALA wall →
 *     signature "14:3:3", totalOverdue 17, oldest = the July row
 *   • SIGNATURE SENSITIVITY — sweeping one ghost / one stale row flips the
 *     signature (the nudge must re-arm inside its quiet window); sweeping
 *     NOTHING (same plan) keeps the signature byte-stable
 *   • nudgeDismissalActive — the whole dismissal policy:
 *       no stored      → show   · same sig < 24h    → quiet
 *       same sig ≥ 24h → show   · different sig     → show immediately
 *       corrupt JSON   → show   · non-finite `at`   → show (fail open)
 *   • WARNINGS — attendance-warning rows never reach the nudge numbers
 *     (they ride the same buildHousekeepingPlan exclusion the dialog uses)
 *   • NUDGE_DISMISS_TTL_MS — exactly 24h
 */
import {
  buildHousekeepingNudgeSummary,
  buildHousekeepingPlan,
  nudgeDismissalActive,
  NUDGE_DISMISS_TTL_MS,
  type HygieneReminder,
} from "../src/lib/reminder-hygiene";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

const NOW = Date.UTC(2026, 9, 5, 9, 0, 0); // 14:30 IST, 2026-10-05
const DAY = 86_400_000;

function row(p: Partial<HygieneReminder> & { id: string; title: string }): HygieneReminder {
  return {
    source: "ERP",
    externalId: null,
    type: "ASSIGNMENT",
    subjectCode: null,
    dueAt: new Date(NOW - 30 * DAY).toISOString(),
    status: "ACTIVE",
    ...p,
  };
}

/* ---------- TTL constant ---------- */

check("TTL is exactly 24h", NUDGE_DISMISS_TTL_MS === 24 * 86_400_000, String(NUDGE_DISMISS_TTL_MS));

/* ---------- summary arithmetic on a small hand-built plan ---------- */

{
  const rows: HygieneReminder[] = [
    // stale pair + duplicate ghost pair (same title/subject, due within window)
    row({ id: "a1", title: "AJAX & API Integration Task", subjectCode: "SE", externalId: "erp:assign:479686", dueAt: new Date(NOW - 80 * DAY).toISOString() }),
    row({ id: "a2", title: "AJAX & API Integration Task", subjectCode: "SE", externalId: "erp:assign:406808", dueAt: new Date(NOW - 80 * DAY).toISOString() }),
    row({ id: "b1", title: "Mini Project", subjectCode: "MP", externalId: "erp:assign:479755", dueAt: new Date(NOW - 40 * DAY).toISOString() }),
    row({ id: "b2", title: "Mini Project", subjectCode: "MP", externalId: "erp:assign:406875", dueAt: new Date(NOW - 40 * DAY).toISOString() }),
    // recent miss (1 day overdue — fresh, stays put)
    row({ id: "r1", title: "Fresh ALA", subjectCode: "CN", externalId: "erp:assign:500001", dueAt: new Date(NOW - 1 * DAY).toISOString() }),
    // auto-managed warning — must be invisible to every number
    row({ id: "w1", title: "Attendance below 75%", type: "ATTENDANCE_WARNING", subjectCode: "AI", externalId: "erp:warn:1", dueAt: new Date(NOW - 90 * DAY).toISOString() }),
  ];
  const plan = buildHousekeepingPlan(rows, NOW);
  const s = buildHousekeepingNudgeSummary(plan);

  // a1,a2,b1,b2 are ALL stale (80d/40d overdue); ghosts a2+b2 are excluded
  // from the stale count — pure stale = a1, b1
  check("stale excludes ghosts (pure stale = a1, b1)", s.staleCount === 2, String(s.staleCount));
  check("ghosts = a2 + b2 (keep rows never counted)", s.ghostCount === 2, String(s.ghostCount));
  check("recent = the 1-day miss", s.recentCount === 1, String(s.recentCount));
  check("totalOverdue = pure stale + ghosts + recent = 5 unique rows", s.totalOverdueCount === 5, String(s.totalOverdueCount));
  check("signature format stale:ghosts:recent", s.signature === "2:2:1", s.signature);
  check("oldest stale = a1/a2 due (80d) — ghosts included in the age hook", s.oldestStaleDueMs === NOW - 80 * DAY, String(s.oldestStaleDueMs));
  check("warning row absent from every list", !plan.staleOverdue.some((r) => r.id === "w1") && !plan.recentOverdue.some((r) => r.id === "w1"));
}

/* ---------- the live composition r108 shipped against ---------- */

{
  // The real wall on 2026-10-05: 17 overdue ALA rows = 8 plain stale + 3
  // duplicate keeps (stale) + 3 duplicate ghosts (stale too) + 3 recent.
  // Ghosts since 16 Jul 2026 set the age hook. The dialog's stale section
  // shows 11, its duplicate sections show 3 ghost rows, the pre-checked
  // selection is 14 ids, the sweep toast says "14 swept" — and this summary
  // (11:3:3) agrees with every one of them.
  const rows: HygieneReminder[] = [];
  for (let i = 0; i < 8; i++) {
    rows.push(
      row({
        id: `stale-${i}`,
        title: `Stale task ${i}`,
        subjectCode: "S",
        externalId: `erp:assign:${700000 + i}`,
        dueAt: new Date(Date.UTC(2026, 6, 16) + i * 86_400_000).toISOString(), // 16 Jul onwards
      })
    );
  }
  for (let i = 0; i < 3; i++) {
    rows.push(
      row({
        id: `recent-${i}`,
        title: `Recent task ${i}`,
        subjectCode: "S",
        externalId: `erp:assign:${710000 + i}`,
        dueAt: new Date(NOW - (1 + i) * DAY).toISOString(),
      })
    );
  }
  // the three live duplicate pairs (keep = latest due then newest id)
  rows.push(
    row({ id: "k1", title: "PDO Secure CRUD Challenge", subjectCode: "DBMS", externalId: "erp:assign:479824", dueAt: new Date(NOW - 42 * DAY).toISOString() }),
    row({ id: "g1", title: "PDO Secure CRUD Challenge", subjectCode: "DBMS", externalId: "erp:assign:410784", dueAt: new Date(NOW - 41 * DAY).toISOString() }),
    row({ id: "k2", title: "AJAX & API Integration Task", subjectCode: "SE", externalId: "erp:assign:479686", dueAt: new Date(NOW - 80 * DAY).toISOString() }),
    row({ id: "g2", title: "AJAX & API Integration Task", subjectCode: "SE", externalId: "erp:assign:406808", dueAt: new Date(NOW - 80 * DAY).toISOString() }),
    row({ id: "k3", title: "Mini Project", subjectCode: "MP", externalId: "erp:assign:479755", dueAt: new Date(NOW - 40 * DAY).toISOString() }),
    row({ id: "g3", title: "Mini Project", subjectCode: "MP", externalId: "erp:assign:406875", dueAt: new Date(NOW - 40 * DAY).toISOString() })
  );
  const plan = buildHousekeepingPlan(rows, NOW);
  const s = buildHousekeepingNudgeSummary(plan);

  check("live: 11 pure stale (14 lens stale minus 3 ghosts)", s.staleCount === 11, String(s.staleCount));
  check("live: 3 recent", s.recentCount === 3, String(s.recentCount));
  check("live: 3 ghosts across 3 groups", s.ghostCount === 3, String(s.ghostCount));
  check("live: 17 overdue on the wall", s.totalOverdueCount === 17, String(s.totalOverdueCount));
  check("live: signature 11:3:3", s.signature === "11:3:3", s.signature);
  check("live: oldest stale is the 16 Jul row", s.oldestStaleDueMs === Date.UTC(2026, 6, 16), String(s.oldestStaleDueMs));
  check("live: pre-checked union = stale lens + ghosts = 14 ids", new Set([...plan.staleOverdue.map((r) => r.id), ...plan.duplicateGroups.flatMap((g) => g.ghosts.map((x) => x.id))]).size === 14);
  check("live: nudge visibility rule (stale + ghosts >= 1)", s.staleCount + s.ghostCount >= 1);
}

/* ---------- signature sensitivity (the re-arm contract) ---------- */

{
  const base: HygieneReminder[] = [
    row({ id: "a1", title: "Task A", subjectCode: "SE", externalId: "erp:assign:1", dueAt: new Date(NOW - 80 * DAY).toISOString() }),
    row({ id: "a2", title: "Task A", subjectCode: "SE", externalId: "erp:assign:2", dueAt: new Date(NOW - 80 * DAY).toISOString() }),
    row({ id: "b1", title: "Task B", subjectCode: "CN", externalId: "erp:assign:3", dueAt: new Date(NOW - 90 * DAY).toISOString() }),
  ];
  const before = buildHousekeepingNudgeSummary(buildHousekeepingPlan(base, NOW));
  check("before: signature 2:1:0 (pure stale a1+b1, ghost a2)", before.signature === "2:1:0", before.signature);

  // sweep one ghost (a2 dismissed) → stale 2, ghosts 0
  const swept = base.map((r) => (r.id === "a2" ? { ...r, status: "DISMISSED" } : r));
  const after = buildHousekeepingNudgeSummary(buildHousekeepingPlan(swept, NOW));
  check("sweeping a ghost flips the signature (re-arm)", before.signature !== after.signature, `${before.signature} → ${after.signature}`);
  check("after sweep: stale 2, ghosts 0, recent 0", after.signature === "2:0:0", after.signature);

  // sweep the last stale row too
  const swept2 = swept.map((r) => (r.id === "a1" || r.id === "b1" ? { ...r, status: "DISMISSED" } : r));
  const after2 = buildHousekeepingNudgeSummary(buildHousekeepingPlan(swept2, NOW));
  check("empty wall → signature 0:0:0", after2.signature === "0:0:0", after2.signature);
  check("empty wall → nudge visibility rule goes quiet", after2.staleCount + after2.ghostCount === 0);
  check("empty wall → oldestStale null", after2.oldestStaleDueMs === null);

  // determinism: the same plan twice → byte-stable signature
  const again = buildHousekeepingNudgeSummary(buildHousekeepingPlan(base, NOW));
  check("same plan → same signature (no churn)", again.signature === before.signature);
}

/* ---------- recent-only wall: no stale hook ---------- */

{
  const rows: HygieneReminder[] = [
    row({ id: "r1", title: "Yesterday", subjectCode: "SE", externalId: "erp:assign:9", dueAt: new Date(NOW - 1 * DAY).toISOString() }),
  ];
  const s = buildHousekeepingNudgeSummary(buildHousekeepingPlan(rows, NOW));
  check("recent-only: stale 0, ghosts 0", s.staleCount === 0 && s.ghostCount === 0);
  check("recent-only: nudge stays silent (nothing looks like noise)", s.staleCount + s.ghostCount === 0);
  check("recent-only: oldestStale null", s.oldestStaleDueMs === null);
  check("recent-only: signature 0:0:1", s.signature === "0:0:1", s.signature);
}

/* ---------- nudgeDismissalActive — the policy matrix ---------- */

{
  const sig = "14:3:3";
  const stored = (signature: string, at: number) => JSON.stringify({ signature, at });

  check("no stored dismissal → show", nudgeDismissalActive(null, sig, NOW) === false);
  check("empty string → show", nudgeDismissalActive("", sig, NOW) === false);
  check("same signature, just dismissed → quiet", nudgeDismissalActive(stored(sig, NOW - 1000), sig, NOW) === true);
  check("same signature, 23h59m ago → quiet", nudgeDismissalActive(stored(sig, NOW - (NUDGE_DISMISS_TTL_MS - 60_000)), sig, NOW) === true);
  check("same signature, exactly 24h → show again", nudgeDismissalActive(stored(sig, NOW - NUDGE_DISMISS_TTL_MS), sig, NOW) === false);
  check("same signature, 25h ago → show again", nudgeDismissalActive(stored(sig, NOW - NUDGE_DISMISS_TTL_MS - 3_600_000), sig, NOW) === false);
  check("different signature (noise changed) → show immediately", nudgeDismissalActive(stored("14:2:3", NOW - 1000), sig, NOW) === false);
  check("corrupt JSON → show (fail open)", nudgeDismissalActive("{not json", sig, NOW) === false);
  check("JSON but wrong shape → show", nudgeDismissalActive(JSON.stringify({ sig }), sig, NOW) === false);
  check("missing at → show", nudgeDismissalActive(JSON.stringify({ signature: sig }), sig, NOW) === false);
  check("non-finite at (NaN) → show", nudgeDismissalActive(JSON.stringify({ signature: sig, at: "NaN" }), sig, NOW) === false);
  check("at in the future (clock skew) → still quiet within TTL shape", nudgeDismissalActive(stored(sig, NOW + 60_000), sig, NOW) === true, "nowMs - at is negative < TTL");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
