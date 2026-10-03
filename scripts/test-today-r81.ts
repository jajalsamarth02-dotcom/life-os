/**
 * r81 — boundary tests for justEndedDrainPct (the depleting just-ended
 * bridge). The bar is the honest inverse of the ongoing emerald fill:
 * 100 the moment the class ends, 0 at the JUST_ENDED_WINDOW_MIN boundary,
 * null outside the window (before the class ends, or after the bridge
 * closes). Mirrors r75's isJustEnded boundary discipline.
 */
import { justEndedDrainPct, JUST_ENDED_WINDOW_MIN } from "../src/components/erp/timetable-card";

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

const END = 780; // 13:00 IST in minutes-of-day

// Outside the window — before the class ends: null (no bar while running).
check("before end → null", justEndedDrainPct(END, END - 5) === null);
// The instant the class ends: full bar.
check("at end (since=0) → 100", justEndedDrainPct(END, END) === 100);
// Mid-window: 7.5 min in → exactly half left.
check("mid-window (since=7.5) → 50", justEndedDrainPct(END, END + 7.5) === 50);
// Inclusive upper boundary (since=15): the bridge's last instant → 0.
check("at boundary (since=15) → 0", justEndedDrainPct(END, END + JUST_ENDED_WINDOW_MIN) === 0);
// Just past the boundary: bridge closed, no bar.
check("past boundary (since=15.5) → null", justEndedDrainPct(END, END + 15.5) === null);
// Far past: still null.
check("far past (since=60) → null", justEndedDrainPct(END, END + 60) === null);
// Monotonic depletion across the window.
const a = justEndedDrainPct(END, END + 2) as number;
const b = justEndedDrainPct(END, END + 8) as number;
const c = justEndedDrainPct(END, END + 14) as number;
check("monotonic decreasing", a > b && b > c);
// Consistency with isJustEnded: the two helpers agree everywhere.
for (let m = END - 3; m <= END + 20; m += 0.5) {
  const inWindow = m - END >= 0 && m - END <= JUST_ENDED_WINDOW_MIN;
  const drain = justEndedDrainPct(END, m);
  check(`consistency @${m - END}min`, inWindow ? drain !== null : drain === null);
}

console.log(`r81 justEndedDrainPct: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
