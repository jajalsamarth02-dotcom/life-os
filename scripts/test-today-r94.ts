/**
 * r94 — "one names source": DAY_NAMES_SHORT + DAY_NAMES_FULL (shared.tsx)
 * retire six local weekday-array copies, and daysAheadQualifierClass
 * (today-card) makes the qualifier's TONE family math. Pinned here:
 *   • SHORT: length 7, exact values, 0=Sun..6=Sat (istNow's index space)
 *   • FULL: length 7, full names
 *   • SLICE EQUIVALENCE: FULL[i].slice(0, 3) === SHORT[i] for all i —
 *     proves timetable-card's grid headers (formerly DAY_NAMES[d].slice(0,3))
 *     render byte-identical strings after the consolidation
 *   • qualifier tone: d=1 ("tomorrow") lifts to text-muted-foreground;
 *     d=2..6 ("in Nd") and the defensive d=0 stay at /70
 *   • family coherence: daysAheadLabel(1) === "tomorrow" — the label the
 *     lifted rung pairs with
 * No clock input needed: every pin is a pure of its index (or of d).
 */
import { DAY_NAMES_SHORT, DAY_NAMES_FULL } from "../src/components/erp/shared";
import { daysAheadQualifierClass, daysAheadLabel } from "../src/components/erp/today-card";

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

// 1. SHORT — the canonical short labels, istNow's index space (0=Sun..6=Sat)
check("SHORT length 7", DAY_NAMES_SHORT.length === 7);
check(
  "SHORT exact values",
  JSON.stringify([...DAY_NAMES_SHORT]) === JSON.stringify(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]),
);
check("SHORT[0] Sun", DAY_NAMES_SHORT[0] === "Sun");
check("SHORT[1] Mon", DAY_NAMES_SHORT[1] === "Mon");
check("SHORT[6] Sat", DAY_NAMES_SHORT[6] === "Sat");

// 2. FULL — the full names (timetable-card's pick rows, selects, grid titles)
check("FULL length 7", DAY_NAMES_FULL.length === 7);
check("FULL[0] Sunday", DAY_NAMES_FULL[0] === "Sunday");
check("FULL[1] Monday", DAY_NAMES_FULL[1] === "Monday");
check("FULL[6] Saturday", DAY_NAMES_FULL[6] === "Saturday");

// 3. SLICE EQUIVALENCE — the consolidation is value-preserving for every day
for (let i = 0; i < 7; i++) {
  check(`slice equivalence [${i}]`, DAY_NAMES_FULL[i].slice(0, 3) === DAY_NAMES_SHORT[i]);
}

// 4. qualifier tone — the muted ladder's rungs, one source
check("tone d=1 lifted (tomorrow is actionable tonight)", daysAheadQualifierClass(1) === "text-muted-foreground");
for (let d = 2; d <= 6; d++) {
  check(`tone d=${d} quietest rung`, daysAheadQualifierClass(d) === "text-muted-foreground/70");
}
check("tone d=0 defensive quiet (today never reaches these surfaces)", daysAheadQualifierClass(0) === "text-muted-foreground/70");

// 5. family coherence — the label the lifted rung pairs with
check("label d=1 tomorrow", daysAheadLabel(1) === "tomorrow");
check("label d=2 in 2d (today's live case)", daysAheadLabel(2) === "in 2d");

console.log(`r94: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
