/**
 * Round 64 — Milestone stakes on today's schedule (pure function).
 *
 * todayStakes(overall, targetPct) decides whether today's next/ongoing
 * timetable row earns the amber "attend → X%" stakes line: ONLY when
 * attending exactly ONE class reaches/crosses the target. Any other state
 * stays null so the badge is a rare, high-signal fact, never noise.
 *
 * Semantics verified against the data layer: AttendanceView.classesToTarget
 * is classesToReachTarget (src/lib/attendance.ts) = smallest n with
 * (p+n)/(t+n) >= target. The honesty guard re-checks (p+1)/(t+1) >= target,
 * so a corrupt classesToTarget can never produce a lying badge.
 *
 * Run: bun scripts/test-today-r64.ts
 */
import { todayStakes, type TodayStakes } from "../src/components/erp/timetable-card";
import type { AttendanceView } from "../src/components/erp/types";

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.error(`FAIL  ${name}${extra ? " — " + extra : ""}`);
  }
}

function ov(
  present: number,
  total: number,
  classesToTarget: number | null,
  percentage?: number
): AttendanceView {
  return {
    present,
    total,
    absent: Math.max(0, total - present),
    percentage: percentage ?? (total > 0 ? (present / total) * 100 : 0),
    status: total > 0 && present / total >= 0.75 ? "safe" : "warning",
    classesToTarget,
    canSkip: 0,
  };
}

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

console.log("— the REAL Saturday stakes (2/3 @ 75% → 3/4 = 75%) —");
{
  const s = todayStakes(ov(2, 3, 1, 66.67), 75);
  check("badge fires", s !== null);
  check("pctAfter is exactly 75", s !== null && close(s.pctAfter, 75), String(s?.pctAfter));
  check("target echoed", s !== null && s.targetPct === 75);
  check(
    "toFixed renders 75.00",
    s !== null && s.pctAfter.toFixed(2) === "75.00"
  );
}

console.log("— crosses ABOVE the target (5/8 @ 65% → 6/9 = 66.67%) —");
{
  // classesToReachTarget: (0.65*8 - 5)/0.35 = 0.5714 → ceil = 1
  const s = todayStakes(ov(5, 8, 1, 62.5), 65);
  check("badge fires on a crossing class", s !== null);
  check(
    "pctAfter honest at 66.67 (above, not exactly on target)",
    s !== null && close(s.pctAfter, (6 / 9) * 100) && s.pctAfter.toFixed(2) === "66.67",
    String(s?.pctAfter)
  );
}

console.log("— quiet states (badge must stay null, never noise) —");
{
  check("already at target (3/4, need 0)", todayStakes(ov(3, 4, 0), 75) === null);
  check("above target (9/10, need 0)", todayStakes(ov(9, 10, 0), 75) === null);
  check("need > 1 (0/1 @75 → 3)", todayStakes(ov(0, 1, 3), 75) === null);
  check("need > 1 (1/3 @75 → 5)", todayStakes(ov(1, 3, 5), 75) === null);
  check("need > 1 (11/16 @75 → 4)", todayStakes(ov(11, 16, 4, 68.75), 75) === null);
  check("unreachable (null need — 100% target, imperfect record)", todayStakes(ov(2, 3, null), 100) === null);
  check("infinite need also quiet", todayStakes(ov(2, 3, Infinity), 100) === null);
}

console.log("— no-data / corrupt-input honesty —");
{
  check("overall null", todayStakes(null, 75) === null);
  check("overall undefined", todayStakes(undefined, 75) === null);
  check("empty record (total 0)", todayStakes(ov(0, 0, 0), 75) === null);
  check("target missing (NaN)", todayStakes(ov(2, 3, 1), NaN) === null);
  // Corrupt guard: classesToTarget claims 1 but (p+1)/(t+1) does NOT reach.
  check(
    "honesty guard rejects a lying classesToTarget",
    todayStakes(ov(1, 3, 1, 33.33), 75) === null,
    "2/4=50% < 75 must not badge"
  );
  // Boundary exactness: (p+1)/(t+1) === target exactly passes the guard.
  check(
    "exact-boundary guard passes (2/3 → 3/4 @ 75)",
    todayStakes(ov(2, 3, 1), 75) !== null
  );
}

console.log("— shape contract —");
{
  const s: TodayStakes | null = todayStakes(ov(2, 3, 1), 75);
  check("returns pctAfter + targetPct only", s !== null && Object.keys(s).sort().join(",") === "pctAfter,targetPct");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
