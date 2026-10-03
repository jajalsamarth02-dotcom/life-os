/**
 * Round 73 — class-start readiness: humanizeMins + chipUrgency ladder.
 *
 * Two pure contracts behind the class chips (today-card + header):
 *
 * 1. humanizeMins — raw "in 490 min" reads like a spreadsheet; "1h 15m"
 *    reads like a clock. Under 60 stays "N min" (never "0h 45m"); exact
 *    hours drop the zero minutes; negative/NaN-ish input clamps to 0
 *    (a chip must never read "in -3 min").
 *
 * 2. chipUrgency — ONE urgency ladder both class chips share, so the header
 *    and the today-card can never disagree on how loud to be:
 *    ongoing → "ongoing" (amber, slow pulse) · upcoming ≤ 10 → "imminent"
 *    (amber, FAST pulse — get moving) · upcoming ≤ 90 → "soon" (emerald)
 *    · null state → null (no chip at all). The 90-min calm window itself
 *    stays todayChipClass's job (already pinned in r72); this file pins the
 *    ladder ON TOP of that vocabulary.
 *
 * Run: bun scripts/test-today-r73.ts
 */
import {
  IMMINENT_MIN,
  chipUrgency,
  type TodayLiveClass,
} from "../src/components/erp/today-card";
import { humanizeMins } from "../src/components/erp/shared";

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

const st = (kind: "ongoing" | "upcoming", mins: number): TodayLiveClass => ({
  kind,
  mins,
  cls: { startMin: 660, endMin: 720, subjectCode: "CS101" },
  leftCount: 1,
});

/* ------------------------------------------------------------------ */
/* 1. humanizeMins — clock-like countdowns                              */
/* ------------------------------------------------------------------ */

console.log("humanizeMins:");

check("0 → '0 min'", humanizeMins(0) === "0 min");
check("1 → '1 min'", humanizeMins(1) === "1 min");
check("45 → '45 min'", humanizeMins(45) === "45 min");
check("59 → '59 min' (no 0h prefix under an hour)", humanizeMins(59) === "59 min");
check("60 → '1h' (exact hour drops minutes)", humanizeMins(60) === "1h");
check("61 → '1h 1m'", humanizeMins(61) === "1h 1m");
check("75 → '1h 15m'", humanizeMins(75) === "1h 15m");
check("120 → '2h'", humanizeMins(120) === "2h");
check("143 → '2h 23m'", humanizeMins(143) === "2h 23m");
check("490 → '8h 10m' (the UTC-parent case)", humanizeMins(490) === "8h 10m");
check("negative clamps to 0 (never 'in -3 min')", humanizeMins(-3) === "0 min");
check("fractional floors (90.7 → '1h 30m')", humanizeMins(90.7) === "1h 30m");

/* ------------------------------------------------------------------ */
/* 2. chipUrgency — one ladder for both chips                           */
/* ------------------------------------------------------------------ */

console.log("chipUrgency:");

check("null state → null (no chip)", chipUrgency(null) === null);
check("ongoing → 'ongoing' regardless of mins", chipUrgency(st("ongoing", 30)) === "ongoing");
/* r82 contract update: ongoing ≤15 min left now returns "wrapping" (amber),
   matching the banner/row/chip flip from r78-r80 — 1 min left is a
   transition, not calm. mins > 15 stays "ongoing". */
check("ongoing with 1 min left is 'wrapping' (r82 contract)", chipUrgency(st("ongoing", 1)) === "wrapping");
check(`upcoming at ${IMMINENT_MIN} → 'imminent' (boundary inclusive)`,
  chipUrgency(st("upcoming", IMMINENT_MIN)) === "imminent");
check("upcoming at 1 min → 'imminent'", chipUrgency(st("upcoming", 1)) === "imminent");
check("upcoming at 0 min (start edge) → 'imminent'", chipUrgency(st("upcoming", 0)) === "imminent");
check(`upcoming at ${IMMINENT_MIN + 1} → 'soon' (just outside the gate)`,
  chipUrgency(st("upcoming", IMMINENT_MIN + 1)) === "soon");
check("upcoming at 45 → 'soon'", chipUrgency(st("upcoming", 45)) === "soon");
check("upcoming at 90 → 'soon' (calm-window edge is chip's call, r72)",
  chipUrgency(st("upcoming", 90)) === "soon");
check("upcoming at 490 → 'soon' here (todayChipClass owns the >90 null)",
  chipUrgency(st("upcoming", 490)) === "soon");

/* ------------------------------------------------------------------ */

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
