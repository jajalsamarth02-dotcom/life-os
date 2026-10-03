/**
 * r102 — the palette's "Add a class to your calendar" group + the badge's
 * second half. Pinned here:
 *   • upcomingClassSlots DEDUP — exact duplicate rows (ERP parallel-batch
 *     artifacts, e.g. COMPUTER-NETWORKS twice at Wed 13:45) collapse to ONE
 *     via the same classSlotUid identity buildClassEvents uses
 *   • PARALLEL classes kept — two DIFFERENT subjects sharing a wall time
 *     both survive (they are genuinely both on the routine)
 *   • INVALID slots dropped — dayOfWeek 7, endMin <= startMin (the same
 *     rules buildSingleClassIcs enforces downstream: a slot the palette
 *     shows is always exportable)
 *   • NEXT-OCCURRENCE ORDER — from Sat 22:00 IST the Monday class leads,
 *     Saturday trails; today-counts-only-if-still-ahead (Mon 11:00 sharp
 *     → next Monday, the r101 fixture family)
 *   • LIMIT — slice AFTER the sort (the soonest N survive, not the first N
 *     in raw row order)
 *   • IDENTITY — every kept slot's classSlotUid matches what
 *     buildSingleClassIcs emits (display ⇒ export contract)
 *   • duePersonalCount — PERSONAL + ACTIVE + due only; DONE/DISMISSED,
 *     ERP-source rows (the ALA half's territory — no double counting) and
 *     ATTENDANCE_WARNING excluded; future-dated not counted; no 24h cap
 *     (a 3-day-old untouched reminder stays on the badge until handled)
 */
import {
  buildSingleClassIcs,
  classSlotUid,
  upcomingClassSlots,
  type ClassSlotInput,
} from "../src/components/erp/ics";
import { duePersonalCount } from "../src/components/erp/use-app-badge";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

/** IST wall → Date (IST = UTC+5:30, no DST). Oct 2026: Oct 3 = Saturday. */
function ist(day: number, h: number, m: number): Date {
  return new Date(Date.UTC(2026, 9, day, h - 5, m - 30));
}

function slot(day: number, start: number, end: number, code: string): ClassSlotInput {
  return { dayOfWeek: day, startMin: start, endMin: end, subjectCode: code };
}

/* ---- upcomingClassSlots: dedup + validity ---- */
{
  const raw = [
    slot(3, 825, 945, "COMPUTER-NETWORKS"), // Wed 13:45
    slot(3, 825, 945, "COMPUTER-NETWORKS"), // exact duplicate row
    slot(3, 825, 945, "ARTIFICIAL-INTELLIGENCE"), // parallel, different subject
    slot(7, 600, 660, "GHOST-CLASS"), // invalid day
    slot(1, 900, 900, "ZERO-LENGTH"), // end <= start
    slot(1, 660, 720, "SOFTWARE-ENGINEERING"),
  ];
  const out = upcomingClassSlots(raw, ist(3, 22, 0));
  check("dedup: 6 raw rows → 3 unique classes", out.length === 3, `got ${out.length}`);
  check("parallel-different kept", out.some((s) => s.subjectCode === "ARTIFICIAL-INTELLIGENCE"));
  check("duplicate collapsed to one", out.filter((s) => s.subjectCode === "COMPUTER-NETWORKS").length === 1);
  check("invalid day dropped", !out.some((s) => s.subjectCode === "GHOST-CLASS"));
  check("zero-length dropped", !out.some((s) => s.subjectCode === "ZERO-LENGTH"));
}

/* ---- upcomingClassSlots: next-occurrence order from Sat 22:00 IST ---- */
{
  const raw = [
    slot(6, 660, 720, "SAT-CLASS"), // Sat 11:00 → Oct 10
    slot(1, 660, 720, "MON-CLASS"), // Mon 11:00 → Oct 5
    slot(3, 660, 720, "WED-CLASS"), // Wed 11:00 → Oct 7
    slot(1, 600, 660, "MON-EARLY"), // Mon 10:00 → Oct 5, earlier that day
  ];
  const out = upcomingClassSlots(raw, ist(3, 22, 0));
  check(
    "order: Mon-Early, Mon, Wed, Sat",
    out.map((s) => s.subjectCode).join(",") === "MON-EARLY,MON-CLASS,WED-CLASS,SAT-CLASS",
    out.map((s) => s.subjectCode).join(",")
  );

  // Monday 11:00 SHARP with a Mon 11:00 class → rolls to NEXT Monday (r101 rule)
  const sharp = upcomingClassSlots([slot(1, 660, 720, "MON-CLASS")], ist(5, 11, 0));
  check("today-counts-only-if-ahead: sharp start rolls a week", sharp.length === 1);
}

/* ---- upcomingClassSlots: limit after sort ---- */
{
  const raw = [
    slot(6, 660, 720, "SAT-CLASS"),
    slot(1, 660, 720, "MON-CLASS"),
    slot(2, 660, 720, "TUE-CLASS"),
    slot(3, 660, 720, "WED-CLASS"),
  ];
  const out = upcomingClassSlots(raw, ist(3, 22, 0), 2);
  check("limit=2 keeps the SOONEST two", out.map((s) => s.subjectCode).join(",") === "MON-CLASS,TUE-CLASS", out.map((s) => s.subjectCode).join(","));
}

/* ---- identity: every displayed slot exports with the SAME uid ---- */
{
  const raw = [slot(1, 660, 720, "SOFTWARE-ENGINEERING"), slot(3, 825, 945, "COMPUTER-NETWORKS")];
  const shown = upcomingClassSlots(raw, ist(3, 22, 0));
  let allMatch = true;
  for (const s of shown) {
    const res = buildSingleClassIcs(s, "Test Name", ist(3, 22, 0));
    if (!res || !res.text.includes(`UID:${classSlotUid(s)}`)) allMatch = false;
  }
  check("display ⇒ export: shown slot's uid lands in its .ics", allMatch);
}

/* ---- duePersonalCount ---- */
{
  const now = ist(3, 22, 0).getTime();
  const rows = [
    { source: "PERSONAL", status: "ACTIVE", type: "OTHER", dueAt: new Date(now - 3_600_000).toISOString() }, // due 1h ago ✓
    { source: "PERSONAL", status: "ACTIVE", type: "OTHER", dueAt: new Date(now - 72 * 3_600_000).toISOString() }, // 3d overdue — STILL counted (no cap)
    { source: "PERSONAL", status: "DONE", type: "OTHER", dueAt: new Date(now - 3_600_000).toISOString() }, // done ✗
    { source: "PERSONAL", status: "DISMISSED", type: "OTHER", dueAt: new Date(now - 3_600_000).toISOString() }, // dismissed ✗
    { source: "ERP", status: "ACTIVE", type: "ASSIGNMENT", dueAt: new Date(now - 3_600_000).toISOString() }, // ERP ✗ (ALA half owns it)
    { source: "PERSONAL", status: "ACTIVE", type: "ATTENDANCE_WARNING", dueAt: new Date(now - 3_600_000).toISOString() }, // auto warning ✗
    { source: "PERSONAL", status: "ACTIVE", type: "OTHER", dueAt: new Date(now + 3_600_000).toISOString() }, // future ✗
  ];
  const n = duePersonalCount(rows, now);
  check("badge half: 2 due personal reminders (no 24h cap, no double count)", n === 2, `got ${n}`);
  check("badge half: empty input → 0", duePersonalCount([], now) === 0);
}

console.log(`r102 palette+badge: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
