/**
 * r104 — dueFirstReminderRows: the palette's "Your reminders" group order.
 * Pinned here:
 *   • MEMBERSHIP — PERSONAL + ACTIVE + not ATTENDANCE_WARNING only (the
 *     SAME rules as duePersonalCount: badge half and palette group can
 *     never disagree about what a reminder is)
 *   • DUE-FIRST — overdue items lead regardless of dueAt distance; the
 *     oldest overdue does NOT sink (sort is overdue-flag, then time)
 *   • TIME ORDER within each half — soonest dueAt first
 *   • NON-MUTATING — the input array is untouched (pure)
 *   • STABILITY — equal-key rows keep input order (sort comparator never
 *     returns 0 across distinct dueAt)
 * Consumers: command-palette "Your reminders" group → rankedCap; the badge
 * stays on duePersonalCount (r102, already pinned).
 */
import { dueFirstReminderRows, duePersonalCount } from "../src/components/erp/use-app-badge";

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

const now = Date.UTC(2026, 9, 3, 17, 0); // Sat 22:30 IST
const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
const H = 3_600_000;

interface Row {
  id: string;
  source: string;
  status: string;
  type: string;
  dueAt: string;
}
const row = (id: string, dueAt: string, extra?: Partial<Row>): Row => ({
  id,
  source: "PERSONAL",
  status: "ACTIVE",
  type: "OTHER",
  dueAt,
  ...extra,
});

{
  const input = [
    row("future-far", iso(72 * H)), // in 3d
    row("overdue-old", iso(-72 * H)), // 3d overdue
    row("future-soon", iso(5 * H)), // in 5h
    row("overdue-new", iso(-2 * H)), // 2h overdue
    row("done", iso(-1 * H), { status: "DONE" }),
    row("erp", iso(-1 * H), { source: "ERP" }),
    row("auto-warning", iso(-1 * H), { type: "ATTENDANCE_WARNING" }),
    row("dismissed", iso(-1 * H), { status: "DISMISSED" }),
  ];
  const snapshot = input.map((r) => r.id);
  const out = dueFirstReminderRows(input, now);

  check("membership: 4 rows survive (done/erp/warning/dismissed out)", out.length === 4, `got ${out.length}`);
  check(
    "due-first then time: overdue-old, overdue-new, future-soon, future-far (ascending dueAt within each half — the most-neglected leads, same voice as the deadlines group)",
    out.map((r) => r.id).join(",") === "overdue-old,overdue-new,future-soon,future-far",
    out.map((r) => r.id).join(",")
  );
  check("pure: input not mutated", input.map((r) => r.id).join(",") === snapshot.join(","));

  const dueCount = duePersonalCount(input, now);
  check("badge half agrees on membership: 2 due", dueCount === 2, `got ${dueCount}`);
}

{
  const tie = [row("a", iso(3 * H)), row("b", iso(3 * H))];
  check("equal dueAt keep input order", dueFirstReminderRows(tie, now).map((r) => r.id).join(",") === "a,b");
}

console.log(`r104 reminder rows: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
