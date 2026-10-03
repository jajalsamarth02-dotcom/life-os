/**
 * Round 66 — one IST clock for every schedule surface.
 *
 * istNow(now) converts a UTC instant to { day, min } on the IST clock
 * (Asia/Kolkata, UTC+5:30). Before this round the timetable card and week
 * plan used the DEVICE clock (getDay/getHours) while the today-card used
 * IST — on any non-IST device the surfaces disagreed and "ongoing / next /
 * done" states lied. Pinned here with UTC instants so the suite is
 * timezone-independent.
 *
 * Run: bun scripts/test-today-r66.ts
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
    console.error(`FAIL  ${name}${extra ? " — " + extra : ""}`);
  }
}

const SAT = 6;
const SUN = 0;
const MON = 1;

console.log("— the REAL Saturday morning (QA browser is UTC; student is IST) —");
{
  // 2026-10-03 02:30 UTC = 08:00 IST Saturday — the QA-hour state.
  const r = istNow(Date.UTC(2026, 9, 3, 2, 30));
  check("day is Saturday", r.day === SAT, String(r.day));
  check("min is 480 (08:00 IST)", r.min === 480, String(r.min));
}

console.log("— day rollover at the +5:30 boundary —");
{
  // 2026-10-03 18:29 UTC = 23:59 IST Saturday (one minute before rollover)
  const before = istNow(Date.UTC(2026, 9, 3, 18, 29));
  check("23:59 IST still Saturday", before.day === SAT && before.min === 23 * 60 + 59);

  // 2026-10-03 18:30 UTC = 00:00 IST Sunday (rollover)
  const at = istNow(Date.UTC(2026, 9, 3, 18, 30));
  check("00:00 IST rolls to Sunday", at.day === SUN && at.min === 0);

  // 2026-10-04 18:30 UTC = 00:00 IST Monday
  const mon = istNow(Date.UTC(2026, 9, 4, 18, 30));
  check("next rollover is Monday", mon.day === MON && mon.min === 0);
}

console.log("— midnight edge: ICU '24:00' fold —");
{
  // Some ICU builds format 00:07 IST as hour "24". Fold must yield 7, not 1447.
  // 2026-10-03 18:37 UTC = 00:07 IST Sunday.
  const r = istNow(Date.UTC(2026, 9, 3, 18, 37));
  check("00:07 IST → min 7 (never 1447)", r.min === 7 && r.day === SUN, `min=${r.min}`);
}

console.log("— agreement with the today-card's IST clock (surfaces can never disagree) —");
{
  // today-card istParts renders hhmm for the same instant; the two must agree.
  // 2026-10-03 04:13 UTC = 09:43 IST Saturday.
  const r = istNow(Date.UTC(2026, 9, 3, 4, 13));
  const hhmm = `${String(Math.floor(r.min / 60)).padStart(2, "0")}:${String(r.min % 60).padStart(2, "0")}`;
  check("hhmm reconstruction is 09:43", hhmm === "09:43", hhmm);
  check("day still Saturday", r.day === SAT);
}

console.log("— schedule-state consequences (the bug this fixes) —");
{
  // 02:30 UTC browser: OLD code read 02:30 local → class 11:00 IST looked
  // "starts in 510 min" and Saturday classes read "done" late evening UTC.
  // NEW code: 08:00 IST → 11:00 − 08:00 = 180 min.
  const { min } = istNow(Date.UTC(2026, 9, 3, 2, 30));
  check("11:00 class is 180 min away at 08:00 IST", 660 - min === 180, String(660 - min));
  // 14:00 UTC = 19:30 IST Saturday: old code said 19:30 local → class "done" (it IS done at 19:30 IST too) —
  // the real lie was early-UTC-evening: 12:30 UTC = 18:00 IST (class done, old code read 12:30 → ALSO done? no—
  // old code at 12:30 read 12:30 LOCAL min=750 > 780? no, 750 < 780 → "ongoing" — A LIE. IST 18:00 → done. Fixed.)
  const { day, min: m2 } = istNow(Date.UTC(2026, 9, 3, 12, 30));
  check("12:30 UTC = 18:00 IST → class (ends 13:00) honestly done", day === SAT && m2 === 1080 && m2 >= 780);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
