/**
 * r83 — justEndedChip: the today-card chip keeps speaking through the
 * post-class bridge. When todayLiveClass has run dry but the last class
 * ended within JUST_ENDED_WINDOW_MIN, the chip says "Just ended X · N ago"
 * (amber, sync pending) instead of vanishing; outside the window or while
 * any live state (ongoing/upcoming) still speaks, it stays null.
 * Epoch fixtures: Date.UTC(2026, 9, 3, H, M) → IST = UTC + 5:30.
 */
import { justEndedChip, JUST_ENDED_WINDOW_MIN } from "../src/components/erp/today-card";

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

/* In the bridge — the chip speaks. */
const atEnd = justEndedChip([CLS], ist(13, 0));
check("at end minute → speaks, sinceMin 0", !!atEnd && atEnd.sinceMin === 0 && atEnd.cls.subjectCode === "RWM");
const mid = justEndedChip([CLS], ist(13, 7));
check("7 min after end → speaks, sinceMin 7", !!mid && mid.sinceMin === 7);
const atBoundary = justEndedChip([CLS], ist(13, JUST_ENDED_WINDOW_MIN));
check("15 min after end → still speaks (boundary inclusive)", !!atBoundary && atBoundary.sinceMin === 15);

/* Outside the bridge — null. */
check("16 min after end → null (bridge closed)", justEndedChip([CLS], ist(13, 16)) === null);
check("60 min after end → null", justEndedChip([CLS], ist(14, 0)) === null);

/* Precedence — a live state is the day's voice. */
check("while ongoing → null (live class wins)", justEndedChip([CLS], ist(12, 0)) === null);
const two = [CLS, { startMin: 840, endMin: 900, subjectCode: "AI" }]; // +14:00–15:00
check("upcoming later class → null (upcoming wins)", justEndedChip(two, ist(13, 5)) === null);
check("same fixture earlier in the day → ongoing wins", justEndedChip(two, ist(11, 30)) === null);

/* Honest absence without data. */
check("empty list → null", justEndedChip([], ist(13, 5)) === null);
check("no data → null", justEndedChip(undefined, ist(13, 5)) === null);

/* Multi-class day: the LAST end governs. */
const day = [{ startMin: 480, endMin: 540, subjectCode: "CN" }, CLS]; // CN 08:00–09:00, RWM 11:00–13:00
check("last class end governs (not the first)", !!justEndedChip(day, ist(13, 3)));
check("bridge after the EARLY class, before the late one → upcoming wins",
  justEndedChip(day, ist(9, 5)) === null);

console.log(`r83 justEndedChip: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
