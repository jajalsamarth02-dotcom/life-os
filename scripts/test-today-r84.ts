/**
 * r84 — the today-card bridge chip drains visibly: justEndedChip now also
 * returns drainPct — the same depleting amber math as the timetable's
 * justEndedDrainPct (r81), computed inline over the SAME pinned constant
 * (today-card cannot import timetable-card without cycling — so the test
 * suite is the pin: every in-window minute must agree EXACTLY across both
 * implementations). 100 at the end minute → 0 at the window boundary
 * (inclusive), bridge closed (null) outside. Epoch fixtures:
 * Date.UTC(2026, 9, ...) → IST = UTC + 5:30.
 */
import { justEndedChip, JUST_ENDED_WINDOW_MIN } from "../src/components/erp/today-card";
import { justEndedDrainPct } from "../src/components/erp/timetable-card";

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
const CLS = { startMin: 660, endMin: 780, subjectCode: "RWM" }; // 11:00–13:00 IST
/** IST wall-clock → epoch (IST = UTC+5:30). */
const ist = (h: number, m: number) => {
  const utcMin = h * 60 + m - 330;
  return Date.UTC(2026, 9, 3, Math.floor(utcMin / 60), utcMin % 60, 0);
};

/* Boundary — the same contract as r81's justEndedDrainPct. */
const atEnd = justEndedChip([CLS], ist(13, 0));
check("at end minute → speaks, drainPct 100", !!atEnd && atEnd.drainPct === 100);
const mid = justEndedChip([CLS], ist(13, 7));
check("7 min in → drainPct = 8/15 of the window", !!mid && mid.drainPct === ((JUST_ENDED_WINDOW_MIN - 7) / JUST_ENDED_WINDOW_MIN) * 100);
const atBoundary = justEndedChip([CLS], ist(13, JUST_ENDED_WINDOW_MIN));
check("15 min in → drainPct 0 (boundary inclusive, still speaks)", !!atBoundary && atBoundary.drainPct === 0);
check("16 min → null (bridge closed, no drain)", justEndedChip([CLS], ist(13, 16)) === null);

/* CROSS-FILE PIN — chip math ≡ timetable math at every in-window minute.
   This is the cycle-safe guarantee: the two implementations can never
   drift apart without this suite going red. */
let agreement = 0;
let monotonic = true;
let prev = Infinity;
for (let m = 0; m <= JUST_ENDED_WINDOW_MIN; m++) {
  const chip = justEndedChip([CLS], ist(13, m));
  const tt = justEndedDrainPct(780, 780 + m);
  if (chip !== null && tt !== null && chip.drainPct === tt) agreement++;
  if (chip === null || chip.drainPct > prev) monotonic = false;
  if (chip !== null) prev = chip.drainPct;
}
check(`all ${JUST_ENDED_WINDOW_MIN + 1} in-window minutes agree with justEndedDrainPct`, agreement === JUST_ENDED_WINDOW_MIN + 1);
check("drain is strictly depleting across the window (monotonic)", monotonic);

/* Honest absence — the drain never fires where the chip doesn't speak. */
check("while ongoing → null (no drain while the class runs)", justEndedChip([CLS], ist(12, 30)) === null);
check("empty list → null", justEndedChip([], ist(13, 5)) === null);
check("no data → null", justEndedChip(undefined, ist(13, 5)) === null);
check("two-class day: last end governs the drain", (() => {
  const day = [{ startMin: 480, endMin: 540, subjectCode: "CN" }, CLS];
  const r = justEndedChip(day, ist(13, 5));
  return !!r && r.cls.subjectCode === "RWM" && r.drainPct === ((JUST_ENDED_WINDOW_MIN - 5) / JUST_ENDED_WINDOW_MIN) * 100;
})());

console.log(`r84 justEndedChip drain: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
