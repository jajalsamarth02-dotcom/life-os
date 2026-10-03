/**
 * r82 — the chip-urgency ladder completes the five-state lifecycle: the
 * header + today-card chips now distinguish "ongoing" (emerald, live) from
 * "wrapping" (amber, ≤ JUST_ENDED_WINDOW_MIN left) — the SAME flip the
 * banner badge (r78), row badge (r79) and week-grid chip (r80) already
 * speak. ONE threshold (JUST_ENDED_WINDOW_MIN, home moved to today-card),
 * every surface in agreement.
 */
import {
  chipUrgency,
  IMMINENT_MIN,
  JUST_ENDED_WINDOW_MIN,
  type TodayLiveClass,
} from "../src/components/erp/today-card";
import { JUST_ENDED_WINDOW_MIN as JEW_FROM_TIMETABLE } from "../src/components/erp/timetable-card";

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
function st(kind: "ongoing" | "upcoming", mins: number): TodayLiveClass {
  return {
    kind,
    cls: { id: "x", dayOfWeek: 6, startMin: 660, endMin: 780, subjectCode: "RWM", source: "erp" } as never,
    mins,
    leftCount: 1,
  };
}

/* 0. Threshold plumbing — the constant keeps ONE value across both modules. */
check("JUST_ENDED_WINDOW_MIN is 15", JUST_ENDED_WINDOW_MIN === 15);
check("timetable-card re-export agrees", JEW_FROM_TIMETABLE === JUST_ENDED_WINDOW_MIN);

/* 1. The wrapping boundary — inclusive at 15, calm above it. */
check("ongoing at 15 min left → 'wrapping' (boundary inclusive)",
  chipUrgency(st("ongoing", JUST_ENDED_WINDOW_MIN)) === "wrapping");
check("ongoing at 16 min left → 'ongoing' (just outside the gate)",
  chipUrgency(st("ongoing", JUST_ENDED_WINDOW_MIN + 1)) === "ongoing");
check("ongoing at 120 min left → 'ongoing' (calm live)",
  chipUrgency(st("ongoing", 120)) === "ongoing");
check("ongoing at 0 min left (end edge) → 'wrapping'",
  chipUrgency(st("ongoing", 0)) === "wrapping");

/* 2. The upcoming ladder is UNCHANGED by r82. */
check(`upcoming at ${IMMINENT_MIN} → 'imminent' (boundary inclusive)`,
  chipUrgency(st("upcoming", IMMINENT_MIN)) === "imminent");
check(`upcoming at ${IMMINENT_MIN + 1} → 'soon'`,
  chipUrgency(st("upcoming", IMMINENT_MIN + 1)) === "soon");
check("upcoming at 90 → 'soon'", chipUrgency(st("upcoming", 90)) === "soon");

/* 3. Null state unchanged. */
check("null state → null", chipUrgency(null) === null);

console.log(`r82 chipUrgency wrapping boundary: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
