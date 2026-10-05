/**
 * r98 — weekProgress: the Full-week grid's aggregate over the ATTENDING
 * week, in the CALENDAR (Monday-first) frame — deliberately NOT the rolling
 * +7 wrap of the "next up this week" family (the r95 audit: two different
 * honest questions; this one answers "how much of this calendar week is
 * over?", the family answers "when is the next one from NOW?").
 * Pinned here:
 *   • Monday-first index math: Mon=0 … Sun=6 — Sunday is the week's LAST
 *     day (a naive Sunday-first mistake would flip the Sat/Sun relation)
 *   • done = earlier calendar day, OR today with endMin <= nowMin (the
 *     same inclusive boundary todayLiveClass speaks)
 *   • the live Saturday case: Mon/Wed/Sat done, Sunday still ahead
 *   • boundaries: exact end minute counts done; exact start does not
 *   • pct rounding (1 of 3 → 33), allDone only at 100%
 *   • honesty: null/undefined/empty → null (the caller passes
 *     batch.attending — dimmed alternatives/duplicates never count)
 * Fixtures: 2026-10-03 is a Saturday; IST = UTC + 5:30.
 */
import { weekProgress } from "../src/components/erp/timetable-card";
import type { TimetableSlotRow } from "../src/components/erp/types";

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

/** IST wall-clock → epoch on a given 2026-10 date (IST = UTC+5:30). */
const ist = (octDay: number, h: number, m: number) => {
  const utcMin = h * 60 + m - 330;
  return Date.UTC(2026, 9, octDay, Math.floor(utcMin / 60), utcMin % 60, 0);
};
const slot = (
  id: string,
  dayOfWeek: number,
  startMin: number,
  endMin: number
): TimetableSlotRow => ({ id, dayOfWeek, startMin, endMin, subjectCode: "X", source: "fixture" });

const mon = slot("m", 1, 11 * 60, 12 * 60); // Mon 11:00–12:00
const wed = slot("w", 3, 10 * 60, 11 * 60); // Wed 10:00–11:00
const sat = slot("s", 6, 11 * 60, 13 * 60); // Sat 11:00–13:00
const sun = slot("u", 0, 9 * 60, 10 * 60);  // Sun 09:00–10:00
const week = [mon, wed, sat, sun];

const eq = (
  r: ReturnType<typeof weekProgress>,
  done: number,
  total: number,
  left: number,
  pct: number,
  allDone: boolean
) => !!r && r.done === done && r.total === total && r.left === left && r.pct === pct && r.allDone === allDone;

/* ── the live Saturday cases ────────────────────────────────────────── */
{
  const r = weekProgress(week, ist(3, 16, 0)); // Sat 16:00 — today's class long over
  check("Sat 16:00 → 3 of 4 done, Sunday ahead", eq(r, 3, 4, 1, 75, false), JSON.stringify(r));
  const r2 = weekProgress(week, ist(3, 10, 30)); // before today's 11:00
  check("Sat 10:30 → Sat not yet done", eq(r2, 2, 4, 2, 50, false), JSON.stringify(r2));
  const r3 = weekProgress(week, ist(3, 13, 0)); // exact end minute
  check("Sat 13:00 exact end → inclusive boundary counts done", eq(r3, 3, 4, 1, 75, false), JSON.stringify(r3));
}

/* ── Sunday is the week's LAST day (Mon-first frame) ────────────────── */
{
  const r = weekProgress(week, ist(4, 10, 0)); // Sun 10:00 — sun just ended
  check("Sun 10:00 → all 4 done, week complete", eq(r, 4, 4, 0, 100, true), JSON.stringify(r));
  const r2 = weekProgress(week, ist(4, 8, 30)); // Sun 08:30 — before sun's class
  check("Sun 08:30 → 3 of 4 (Sun still ahead in-frame)", eq(r2, 3, 4, 1, 75, false), JSON.stringify(r2));
  const r3 = weekProgress([sun], ist(3, 16, 0)); // from Saturday, Sunday-only week
  check("Sat → Sunday-only week is entirely ahead", eq(r3, 0, 1, 1, 0, false), JSON.stringify(r3));
}

/* ── the fresh-week cases ───────────────────────────────────────────── */
{
  const r = weekProgress(week, ist(5, 8, 0)); // Mon 08:00 — week just started
  check("Mon 08:00 → 0 of 4", eq(r, 0, 4, 4, 0, false), JSON.stringify(r));
  const r2 = weekProgress(week, ist(5, 12, 0)); // Mon 12:00 — exact end
  check("Mon 12:00 → 1 of 4 done", eq(r2, 1, 4, 3, 25, false), JSON.stringify(r2));
}

/* ── rounding + honesty gates ───────────────────────────────────────── */
{
  const r = weekProgress([mon, wed, sun], ist(5, 12, 0)); // 1 of 3 done
  check("1 of 3 → pct rounds to 33", eq(r, 1, 3, 2, 33, false), JSON.stringify(r));
  check("null week → null", weekProgress(null, ist(3, 16, 0)) === null);
  check("undefined week → null", weekProgress(undefined, ist(3, 16, 0)) === null);
  check("empty week → null", weekProgress([], ist(3, 16, 0)) === null);
}

console.log(`r98 weekProgress: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
