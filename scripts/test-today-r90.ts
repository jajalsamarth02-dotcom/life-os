/**
 * r90 — nextUpcomingThisWeek promoted to an exported pure (today-card) and
 * consumed by BOTH the header chip (r87's inline 3-liner replaced, behavior
 * identical) and the deadline strip's done state (no more "nothing left
 * today" dead end when the week still has a next class). Pinned here:
 *   • week-wrap safety — Sat→Mon (the live r87 case) and Sun→Mon
 *   • strictly-later-this-week semantics — today (d=0) excluded
 *   • earliest day wins over earlier start on a later day; same day →
 *     earliest start
 *   • honest null edges (empty / null / only-today)
 * Fixtures: Date.UTC(2026, 9, 3) = Saturday 2026-10-03; IST = UTC + 5:30.
 */
import { nextUpcomingThisWeek } from "../src/components/erp/today-card";
import type { TimetableSlotRow } from "../src/components/erp/types";

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

const slot = (day: number, startMin: number, code: string): TimetableSlotRow => ({
  id: `${day}-${startMin}-${code}`,
  dayOfWeek: day,
  startMin,
  endMin: startMin + 60,
  subjectCode: code,
  source: "routine",
});

/** IST wall-clock → epoch on a given 2026-10 date (IST = UTC+5:30). */
const ist = (octDay: number, h: number, m: number) => {
  const utcMin = h * 60 + m - 330;
  return Date.UTC(2026, 9, octDay, Math.floor(utcMin / 60), utcMin % 60, 0);
};

/* ── Saturday 2026-10-03, 16:00 IST — today done, next class Mon 11:00 ── */
const sat = ist(3, 16, 0);
const satMon = nextUpcomingThisWeek([slot(1, 660, "SE")], sat);
check("Sat→Mon wrap: found", satMon?.subjectCode === "SE");
check("Sat→Mon wrap: dayOfWeek 1", satMon?.dayOfWeek === 1);
check("Sat→Mon wrap: startMin 11:00", satMon?.startMin === 660);

/* ── today (d=0) excluded — strictly later this week ── */
check(
  "today slot (d=0) skipped, Monday wins",
  nextUpcomingThisWeek([slot(6, 900, "TODAY"), slot(1, 660, "SE")], sat)?.subjectCode === "SE"
);
check("only-today → null (caller guard territory)", nextUpcomingThisWeek([slot(6, 900, "TODAY")], sat) === null);

/* ── ordering: earliest DAY beats earlier start on a later day ── */
const mixed = [slot(3, 480, "WED-EARLY"), slot(1, 900, "MON-LATE"), slot(2, 480, "TUE")];
check("earliest day wins (Mon over Tue/Wed)", nextUpcomingThisWeek(mixed, sat)?.subjectCode === "MON-LATE");
const sameDay = [slot(1, 900, "MON-LATE"), slot(1, 660, "MON-EARLY")];
check("same day → earliest start wins", nextUpcomingThisWeek(sameDay, sat)?.subjectCode === "MON-EARLY");

/* ── Sunday 2026-10-04, 18:00 IST → Monday is d=1 ── */
const sunMon = nextUpcomingThisWeek([slot(1, 660, "SE")], ist(4, 18, 0));
check("Sun→Mon: d=1 found", sunMon?.dayOfWeek === 1);

/* ── honest null edges ── */
check("empty list → null", nextUpcomingThisWeek([], sat) === null);
check("null list → null", nextUpcomingThisWeek(null, sat) === null);
check("undefined list → null", nextUpcomingThisWeek(undefined, sat) === null);

/* ── exhaustive wrap sweep: for every today 0..6, a slot on EVERY day
      must resolve to the earliest strictly-future day in cyclic order ── */
for (let today = 0; today < 7; today++) {
  // Sunday-based IST instants: noon IST on a synthetic day (weekday derived
  // by scanning — instead, pin via the same +7 math the pure uses).
  // istNow needs a real date; 2026-10-03 is a Saturday (6). Walk back from it.
  const octDayFor = (d: number) => 3 + ((d - 6 + 7) % 7);
  const epoch = ist(octDayFor(today), 12, 0);
  const all7 = Array.from({ length: 7 }, (_, day) => slot(day, 600 + day, `D${day}`));
  const got = nextUpcomingThisWeek(all7, epoch);
  const want = [1, 2, 3, 4, 5, 6, 0].map((k) => (today + k) % 7)[0];
  check(`wrap sweep today=${today}: next is day ${want}`, got?.dayOfWeek === want);
}

console.log(`r90 nextUpcomingThisWeek: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
