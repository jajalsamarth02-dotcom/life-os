/**
 * Round 75 — the "just ended" bridge (isJustEnded).
 *
 * Between a class's endMin and the next 15-min auto-sync there is an honest
 * gap: the class IS over, but the attendance record does not show it yet.
 * The timetable row bridges that gap with an amber "just ended" badge
 * (in-flight language) instead of the flat dimmed "done". This file pins
 * the window arithmetic:
 *
 *   - window = JUST_ENDED_WINDOW_MIN (15) — deliberately ONE auto-sync
 *     cadence, so the badge can never outlive the data that replaces it;
 *   - inclusive at both ends: the exact endMin minute (now == endMin) and
 *     the exact 15th minute after both count; the 16th does not;
 *   - future times (negative distance) are NOT "just ended" — that's the
 *     upcoming/ongoing vocabulary's job.
 *
 * Run: bun scripts/test-today-r75.ts
 */
import { JUST_ENDED_WINDOW_MIN, isJustEnded } from "../src/components/erp/timetable-card";

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

const END = 720; // 12:00 IST class end

console.log("isJustEnded (window = " + JUST_ENDED_WINDOW_MIN + " min):");

check("window is exactly one sync cadence (15)", JUST_ENDED_WINDOW_MIN === 15);
check("exact end minute → true (now == endMin)", isJustEnded(END, END) === true);
check("1 min after → true", isJustEnded(END, END + 1) === true);
check("14 min after → true", isJustEnded(END, END + 14) === true);
check("15 min after → true (inclusive outer edge)", isJustEnded(END, END + JUST_ENDED_WINDOW_MIN) === true);
check("16 min after → false (sync has had its chance)", isJustEnded(END, END + 16) === false);
check("60 min after → false", isJustEnded(END, END + 60) === false);
check("1 min BEFORE end → false (ongoing's vocabulary)", isJustEnded(END, END - 1) === false);
check("start minute → false", isJustEnded(END, END - 72) === false);
check("far future → false", isJustEnded(END, END - 600) === false);

/* ------------------------------------------------------------------ */

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
