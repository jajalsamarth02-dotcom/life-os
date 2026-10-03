/**
 * Unit tests for the Round 61 milestone additions:
 *  - classesToTarget (new pure fn: attended classes needed to reach target)
 *  - computeMilestones (existing pure fn — FIRST unit coverage; hardened
 *    before tonight's possible real 3/4 = 75% crossing)
 * Run: cd /home/z/my-project && bun run scripts/test-milestones-r61.ts
 */
import { classesToTarget, computeMilestones, type HistoryPoint } from "../src/components/erp/milestones";
import type { HistoryResponse } from "../src/components/erp/types";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function point(t: string, present: number, total: number): HistoryPoint {
  return { t, present, total, percentage: total > 0 ? (present / total) * 100 : 0 };
}

/* ---------- classesToTarget ---------- */
{
  check("c2t: already at target → 0", classesToTarget(3, 4, 75) === 0);
  check("c2t: above target → 0", classesToTarget(4, 5, 75) === 0);
  check("c2t: exact boundary 75.0 counts as at target → 0", classesToTarget(6, 8, 75) === 0);
  check("c2t: the REAL tonight case 2/3 → 1", classesToTarget(2, 3, 75) === 1, String(classesToTarget(2, 3, 75)));
  check("c2t: 1/3 → 5 (5/8 = 75%)", classesToTarget(1, 3, 75) === 5, String(classesToTarget(1, 3, 75)));
  check("c2t: 0/1 → 3 (3/4 = 75%)", classesToTarget(0, 1, 75) === 3, String(classesToTarget(0, 1, 75)));
  check("c2t: 50/100 target 75 → 100 (150/200 = 75%; 100/150 is only 66.7%)", classesToTarget(50, 100, 75) === 100, String(classesToTarget(50, 100, 75)));
  check("c2t: no data total=0 → null", classesToTarget(0, 0, 75) === null);
  check("c2t: 100% target unreachable with imperfect record → null", classesToTarget(9, 10, 100) === null);
  check("c2t: 100% target reachable when perfect → 0", classesToTarget(10, 10, 100) === 0);
  check("c2t: target 0 → 0", classesToTarget(0, 5, 0) === 0);
  check("c2t: NaN present → null", classesToTarget(NaN, 5, 75) === null);
  check("c2t: 89/100 target 90 → 9 (98/109 ≈ 89.9→ wait, verify)", (() => {
    const n = classesToTarget(89, 100, 90);
    return n != null && (89 + n) / (100 + n) >= 0.9 - 1e-9 && (n === 0 || (89 + n - 1) / (100 + n - 1) < 0.9 - 1e-9);
  })(), String(classesToTarget(89, 100, 90)));
  check("c2t: minimal-honesty n=1 verified", (() => {
    const n = classesToTarget(2, 3, 75);
    return n === 1 && (2 + 1) / (3 + 1) >= 0.75 - 1e-9 && 2 / 3 < 0.75 - 1e-9;
  })());
}

/* ---------- computeMilestones (first unit coverage) ---------- */
function history(pts: HistoryPoint[]): HistoryResponse {
  return { overall: pts } as HistoryResponse;
}

{
  check("cm: empty/undefined → zeroed stats", (() => {
    const z = computeMilestones(undefined, 75);
    return z.snapshots === 0 && z.best === null && z.streak === 0 && z.daysAtTarget === 0 && z.classStreak === 0;
  })());

  const pts = [
    point("2026-09-28T10:00:00Z", 10, 12), // 83.33
    point("2026-09-28T18:00:00Z", 10, 13), // 76.92 — LAST snapshot of Sep-28 (dedup wins)
    point("2026-09-29T10:00:00Z", 10, 14), // 71.43
    point("2026-09-30T10:00:00Z", 12, 15), // 80.00
    point("2026-10-01T10:00:00Z", 13, 16), // 81.25
  ];
  const s = computeMilestones(history(pts), 75);
  check("cm: best = max percentage snapshot (83.33)", s.best?.percentage != null && Math.abs(s.best.percentage - 83.333) < 0.01, String(s.best?.percentage));
  check("cm: since = earliest snapshot time", s.since === "2026-09-28T10:00:00Z");
  check("cm: daysAtTarget = distinct days whose LAST snapshot ≥ target (2: 28th@76.92, 30th, 1st → 3... careful)", (() => {
    // Day 28 last = 76.92 (≥75 ✓), day 29 last = 71.43 (✗), day 30 = 80 ✓, Oct 1 = 81.25 ✓ → 3
    return s.daysAtTarget === 3;
  })(), String(s.daysAtTarget));
  check("cm: streak = consecutive final days ≥ target walking back (2: Oct-1, Sep-30; Sep-29 breaks)", s.streak === 2, String(s.streak));
  check("cm: classStreak — last pair attended (+1/+1), then a CORRECTION batch (+2 present/+1 total) honestly stops it → 1", s.classStreak === 1, String(s.classStreak));

  const miss = computeMilestones(history([point("2026-10-01T10:00:00Z", 13, 16), point("2026-10-02T10:00:00Z", 13, 18)]), 75);
  check("cm: missed class ends classStreak → 0 (dPresent 0 ≠ dTotal 2)", miss.classStreak === 0, String(miss.classStreak));
  check("cm: real dip below target (13/18 = 72.2%) ends day streak → 0", miss.streak === 0, String(miss.streak));
  check("cm: best still remembers the 81.25% high-water mark", Math.abs((miss.best?.percentage ?? 0) - 81.25) < 0.01, String(miss.best?.percentage));
}

{
  // Correction window: a snapshot where total grows but present doesn't (mixed
  // batch) honestly ends the class streak even though percentage may hold.
  const pts = [
    point("2026-10-01T10:00:00Z", 12, 15),
    point("2026-10-02T10:00:00Z", 12, 16), // a miss
    point("2026-10-03T10:00:00Z", 13, 17), // attended again — but the miss is between
  ];
  const s = computeMilestones(history(pts), 75);
  check("cm: F→attended mixed batch ends classStreak (honest)", s.classStreak === 1, String(s.classStreak));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
