/**
 * Round 68 — one-clock contract for the LAST device-clock surfaces.
 *
 * Task 66 fixed the schedule cards; Task 67 fixed the header chip; this
 * round migrates the final three sites (NextUpStrip's class chip, the
 * brief's CLASSES TODAY filter, the drawer's add-slot default day) to
 * istNow. These tests pin the DAY-DIVERGENCE contract that motivated the
 * change: between 18:30 IST and 24:00 IST the UTC device is still on the
 * PREVIOUS day, so any getDay()-based "today" filter serves the wrong
 * day's classes. istNow must disagree with the device clock in EXACTLY
 * that window and agree everywhere else.
 *
 * Run: bun scripts/test-today-r68.ts
 */
import { istNow } from "../src/components/erp/shared";

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.error(`FAIL  ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

/** The lie window: device getDay() ≠ IST day iff the IST date has already
 *  rolled over (00:00–05:29 IST) while the UTC date has not (18:30–23:59 UTC). */
function diverges(utcMs: number): boolean {
  return istNow(utcMs).day !== new Date(utcMs).getDay();
}

// 1. THE LIE CASE (exact class of bug fixed this round): Sat 03 Oct 2026,
//    19:30 UTC = 01:00 IST Sunday. Device clock says Saturday(6) — a
//    getDay()-filtered "today" list would show FRIDAY... no, Saturday's UTC
//    date — the WRONG day for the student, whose Sunday has begun.
const sunday1am = Date.UTC(2026, 9, 3, 19, 30, 0);
check("19:30 UTC Sat = 01:00 IST Sun → istNow day 0, min 60", istNow(sunday1am).day === 0 && istNow(sunday1am).min === 60);
check("same instant: device says day 6 (the removed lie)", new Date(sunday1am).getDay() === 6);
check("divergence detector flags it", diverges(sunday1am) === true);

// 2. Boundary INSIDE the fold: 05:29 IST still yesterday-in-UTC (23:59 UTC);
//    05:30 IST the days re-agree. Sample both sides.
const justBefore = Date.UTC(2026, 9, 3, 23, 59, 0); // 05:29 IST Sun
const justAfter = Date.UTC(2026, 9, 4, 0, 0, 0); // 05:30 IST Sun
check("05:29 IST → still diverged (UTC Sat vs IST Sun)", diverges(justBefore) === true);
check("05:30 IST → days re-agree (both Sunday)", diverges(justAfter) === false);

// 3. Control cases OUTSIDE the window: mid-day UTC, both clocks agree.
const midDay = Date.UTC(2026, 9, 3, 9, 0, 0); // 14:30 IST Sat
check("14:30 IST Sat → agree (day 6)", diverges(midDay) === false && istNow(midDay).day === 6);
const eveningSameDay = Date.UTC(2026, 9, 3, 13, 0, 0); // 18:30 IST Sat, UTC still Sat
check("18:30 IST Sat (UTC 13:00) → agree (day 6)", diverges(eveningSameDay) === false);

// 4. Sweep: divergence must occur ONLY for UTC instants whose IST time is
//    00:00–05:29 — equivalently UTC 18:30–23:59. Sample hourly across 3 days.
let sweepOk = true;
for (let h = 0; h < 72; h++) {
  const t = Date.UTC(2026, 9, 3, 0, 0, 0) + h * 3_600_000;
  const utcH = new Date(t).getUTCHours();
  const expected = utcH >= 18 || utcH === 23; // 18:00–23:59 UTC window (hour granularity)
  const expectedExact = new Date(t).getUTCMinutes() >= 30 || utcH !== 18 ? utcH >= 18 || (utcH === 18 && new Date(t).getUTCMinutes() >= 30) : false;
  if (diverges(t) !== expectedExact) {
    sweepOk = false;
    console.error(`  sweep mismatch at UTC hour ${utcH}:${new Date(t).getUTCMinutes()}`);
    break;
  }
}
check("72h hourly sweep: divergence exactly in the 18:30–23:59 UTC window", sweepOk);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
