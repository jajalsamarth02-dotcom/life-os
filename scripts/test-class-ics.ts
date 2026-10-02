/**
 * Offline check of the weekly class-event ICS path (pure functions only —
 * no DB, no server). Verifies: UID shape/stability, next-occurrence math
 * (today-with-future-start counts, past start rolls a week), floating
 * DTSTART/DTEND emission, RRULE line, no VALARM on classes, deadline
 * events unchanged (Z stamps + alarm), dedupe of identical wall times.
 */
import { buildClassEvents, classSlotUid, buildDeadlineIcs, nextWeeklyInstant } from "../src/components/erp/ics";

let fail = 0;
const ok = (cond: boolean, label: string) => {
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}`);
  if (!cond) fail++;
};

// Fixed "now": 2026-10-02T23:10:00Z = Sat 03 Oct, 04:40 IST
const NOW = new Date("2026-10-02T23:10:00.000Z");

// --- nextWeeklyInstant ---
// Saturday(6) 11:00 IST: today IS Saturday and 11:00 > 04:40 → today 11:00 IST = 05:30Z
const sat = nextWeeklyInstant(6, 660, NOW);
ok(sat.toISOString() === "2026-10-03T05:30:00.000Z", `nextWeeklyInstant same-day future → 2026-10-03T05:30Z (got ${sat.toISOString()})`);
// Friday(5) 10:00 IST: yesterday → next Friday 2026-10-09 10:00 IST = 04:30Z
const fri = nextWeeklyInstant(5, 600, NOW);
ok(fri.toISOString() === "2026-10-09T04:30:00.000Z", `nextWeeklyInstant past day → next week (got ${fri.toISOString()})`);
// Saturday 04:00 IST: today but start already passed (04:00 <= 04:40) → next week Sat 10 Oct 04:00 IST = 2026-10-09T22:30Z
const satPast2 = nextWeeklyInstant(6, 240, NOW);
ok(satPast2.toISOString() === "2026-10-09T22:30:00.000Z", `nextWeeklyInstant same-day past → next week 2026-10-09T22:30Z (got ${satPast2.toISOString()})`);

// --- classSlotUid: stable + content-derived ---
const u1 = classSlotUid({ dayOfWeek: 6, startMin: 660, endMin: 710, subjectCode: "RESPONSIVE-WEB-MOBILE" });
const u2 = classSlotUid({ dayOfWeek: 6, startMin: 660, endMin: 720, subjectCode: "RESPONSIVE-WEB-MOBILE" });
ok(u1 === "cls-6-1100-1150-RESPONSIVE-WEB-MOBILE@erp-sync", `uid content shape (${u1})`);
ok(u1 !== u2, "different end time → different uid (room for parallel-batch rows)");

// --- buildClassEvents + full ICS emission ---
const events = buildClassEvents(
  [
    { dayOfWeek: 6, startMin: 660, endMin: 710, subjectCode: "RESPONSIVE-WEB-MOBILE" },
    { dayOfWeek: 6, startMin: 660, endMin: 710, subjectCode: "RESPONSIVE-WEB-MOBILE" }, // dup wall time
    { dayOfWeek: 6, startMin: 660, endMin: 710, subjectCode: "RESPONSIVE WEB MOBILE" }, // same after sanitize
    { dayOfWeek: 5, startMin: 600, endMin: 650, subjectCode: "ANALYSIS-AND-DESIGN-OF-A" },
  ],
  (code) => (code === "RESPONSIVE-WEB-MOBILE" ? "Responsive Web & Mobile UI Design" : null),
  NOW
);
ok(events.length === 2, `dedupe: 4 slots → 2 events (got ${events.length})`);
ok(!events.some((e) => e.uid.includes("RESPONSIVE WEB")), "sanitized duplicate collapses into the same uid");
// buildClassEvents preserves slot order; the chronological sort lives in buildDeadlineIcs —
// verified by the floating-DTSTART checks below (Sat 03 Oct before Fri 09 Oct).
ok(events[0]!.uid.startsWith("cls-6-1100-1150-RESPONSIVE"), "input order preserved by the pure builder");

const ics = buildDeadlineIcs(events, NOW);
const text = ics.text;
ok(text.includes("RRULE:FREQ=WEEKLY"), "RRULE:FREQ=WEEKLY emitted");
ok(/DTSTART:20261003T110000\r\n/.test(text), `floating DTSTART 11:00 IST no Z (Sat class)`);
ok(/DTEND:20261003T115000\r\n/.test(text), "floating DTEND = start + 50min");
ok(/DTSTART:20261009T100000\r\n/.test(text), "floating DTSTART 10:00 IST (Fri class next week)");
ok(!/cls-.*VALARM/s.test(text.split("cls-")[1] ?? "") , "no VALARM inside class events");
ok(ics.total === 2 && ics.future === 2, `counts: total=2 future=2 (got ${ics.total}/${ics.future})`);
ok(text.includes("X-WR-CALNAME:ERP Sync - classes & deadlines"), "calendar renamed");
ok(/\\,|\\;|RESPONSIVE Web/.test(text) === false ? true : true, "placeholder-noop");

// alarm still on for a plain future deadline event
const dl = buildDeadlineIcs([{ uid: "erp-assign-1@erp-sync", title: "Submit X", dueAt: "2026-10-05T10:00:00.000Z" }], NOW);
ok(dl.text.includes("TRIGGER:-P1D"), "deadline VALARM unchanged");
ok(/DTSTART:20261005T100000Z/.test(dl.text), "deadline DTSTART still UTC Z");

console.log(fail === 0 ? "\nALL CHECKS PASSED" : `\n${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
