/**
 * r91 — daysAheadThisWeek + daysAheadLabel: the distance qualifier for the
 * "next up this week" family (r90's nextUpcomingThisWeek consumed by the
 * header chip AND the strip's done line). Pinned here:
 *   • cyclic distance — the SAME +7 wrap the selection uses (Sat→Mon = 2,
 *     Sun→Mon = 1, Sat→Fri = 6)
 *   • exhaustive 7×7 sweep: every (today, day) pair resolves to the true
 *     cyclic distance
 *   • display twin: 0 → "today", 1 → "tomorrow", else "in Nd"
 * Fixtures: 2026-10-03 is a Saturday; IST = UTC + 5:30.
 */
import { daysAheadThisWeek, daysAheadLabel } from "../src/components/erp/today-card";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}`);
  }
}

/** IST wall-clock → epoch on a given 2026-10 date (IST = UTC+5:30). */
const ist = (octDay: number, h: number, m: number) => {
  const utcMin = h * 60 + m - 330;
  return Date.UTC(2026, 9, octDay, Math.floor(utcMin / 60), utcMin % 60, 0);
};
/** Weekday index → 2026-10 date (Oct 3 = Saturday = 6). */
const octDayFor = (d: number) => 3 + ((d - 6 + 7) % 7);

/* ── the live r90/r91 case: Saturday 16:00 IST, next class Monday ── */
const sat = ist(3, 16, 0);
check("Sat→Mon = 2", daysAheadThisWeek(1, sat) === 2);
check("Sat→today = 0", daysAheadThisWeek(6, sat) === 0);
check("Sat→Fri = 6 (the day before, next cycle)", daysAheadThisWeek(5, sat) === 6);
check("Sat→Sun = 1 (tomorrow)", daysAheadThisWeek(0, sat) === 1);

/* ── Sunday 18:00 IST → Monday = 1 ── */
const sun = ist(4, 18, 0);
check("Sun→Mon = 1", daysAheadThisWeek(1, sun) === 1);

/* ── exhaustive 7×7 sweep: distance = (day − today + 7) % 7 ── */
let sweepOk = true;
for (let today = 0; today < 7 && sweepOk; today++) {
  const epoch = ist(octDayFor(today), 12, 0);
  for (let day = 0; day < 7; day++) {
    const want = (day - today + 7) % 7;
    if (daysAheadThisWeek(day, epoch) !== want) {
      sweepOk = false;
      console.error(`FAIL: sweep today=${today} day=${day} → want ${want}`);
      failed++;
      break;
    }
  }
}
if (sweepOk) passed++;
check("7×7 cyclic sweep", sweepOk);

/* ── display twin ── */
check("label 0 → today", daysAheadLabel(0) === "today");
check("label 1 → tomorrow", daysAheadLabel(1) === "tomorrow");
check("label 2 → in 2d", daysAheadLabel(2) === "in 2d");
check("label 6 → in 6d", daysAheadLabel(6) === "in 6d");

console.log(`r91 daysAhead: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
