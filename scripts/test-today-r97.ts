/**
 * r97 — the bubble joins the "next up this week" family: smsNextClassLine
 * (the FIFTH pinned pure) + the NEXT CLASS line inside buildTodaySms.
 * Pinned here:
 *   • smsNextClassLine: selection (earliest day, then earliest start),
 *     the daysAheadLabel qualifier, the exact "NEXT CLASS Mon 11:00 CODE
 *     (in 2d)" format
 *   • honesty gates: no synced week → no line; today-only slots → no line
 *     (d=0 excluded, same as every family surface)
 *   • buildTodaySms: the line renders ONLY when the day has nothing left
 *     to say (all done / none scheduled) AND the week is synced; a live
 *     state (upcoming OR ongoing) or an unsynced timetable keeps the
 *     brief byte-stable (r62/r65 pins untouched)
 *   • keyword precedence: "NEXT CLASS" splits before "NEXT"; tone violet
 *     (the family's focus color lands in the bubble)
 *   • GSM-7: the extended brief stays ASCII-only, char count honest
 * Fixtures: 2026-10-03 is a Saturday; IST = UTC + 5:30.
 */
import {
  smsNextClassLine,
  smsLineParts,
  smsKeywordTone,
  smsSegments,
  buildTodaySms,
  SMS_KEYWORDS,
  type TodaySmsInput,
  type TodayClassBrief,
} from "../src/components/erp/today-card";
import type { TimetableSlotRow } from "../src/components/erp/types";

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

/** IST wall-clock → epoch on a given 2026-10 date (IST = UTC+5:30). */
const ist = (octDay: number, h: number, m: number) => {
  const utcMin = h * 60 + m - 330;
  return Date.UTC(2026, 9, octDay, Math.floor(utcMin / 60), utcMin % 60, 0);
};
const slot = (
  id: string,
  dayOfWeek: number,
  startMin: number,
  endMin: number,
  subjectCode: string
): TimetableSlotRow => ({ id, dayOfWeek, startMin, endMin, subjectCode, source: "fixture" });

const sat1600 = ist(3, 16, 0); // Saturday 16:00 IST — today's 11:00–13:00 class long over
const mon = slot("m1", 1, 11 * 60, 12 * 60, "SOFTWARE-ENGINEERING");
const sun = slot("s1", 0, 9 * 60, 10 * 60, "RWM");
const satClass: TodayClassBrief[] = [{ startMin: 11 * 60, endMin: 13 * 60, subjectCode: "RWM" }];

const base: Omit<TodaySmsInput, "now" | "todayClasses" | "weekSlots"> = {
  overall: { present: 2, total: 3, absent: 1, percentage: 66.67, status: "warning", classesToTarget: 1, canSkip: 0 },
  target: 75,
  subjects: [],
  warningSubjects: 0,
  alaPending: 0,
  alaTotal: 0,
  alaOverdue: 0,
  alaDueWeek: 0,
  nextDue: null,
  notedCount: 0,
  lastSyncAt: new Date(ist(3, 15, 30)).toISOString(),
};

/* ── smsNextClassLine: selection + exact format ─────────────────────── */
check("Sat 16:00 → Mon (in 2d)", smsNextClassLine([mon], sat1600) === "NEXT CLASS Mon 11:00 SOFTWARE-ENGINEERING (in 2d)", smsNextClassLine([mon], sat1600) ?? "null");
check("earliest day wins: Sunday (tomorrow) beats Monday", smsNextClassLine([mon, sun], sat1600) === "NEXT CLASS Sun 09:00 RWM (tomorrow)", smsNextClassLine([mon, sun], sat1600) ?? "null");
check("same day → earliest start wins", (() => {
  const a = slot("a", 1, 10 * 60, 11 * 60, "AAA");
  const b = slot("b", 1, 9 * 60, 10 * 60, "BBB");
  return smsNextClassLine([a, b], sat1600) === "NEXT CLASS Mon 09:00 BBB (in 2d)";
})());
check("null week → null", smsNextClassLine(null, sat1600) === null);
check("undefined week → null", smsNextClassLine(undefined, sat1600) === null);
check("empty week → null", smsNextClassLine([], sat1600) === null);
check("today-only slots → null (d=0 excluded)", smsNextClassLine([slot("t", 6, 8 * 60, 9 * 60, "X")], sat1600) === null);
{
  const sun1800 = ist(4, 18, 0); // Sunday 18:00 IST
  check("Sunday → Mon = tomorrow", smsNextClassLine([mon], sun1800) === "NEXT CLASS Mon 11:00 SOFTWARE-ENGINEERING (tomorrow)", smsNextClassLine([mon], sun1800) ?? "null");
}

/* ── buildTodaySms: done day + week → the line lands after CLASSES ──── */
{
  const text = buildTodaySms({ ...base, now: sat1600, todayClasses: satClass, weekSlots: [mon] });
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.startsWith("CLASSES TODAY"));
  check("done day: CLASSES line honest", lines[i] === "CLASSES TODAY done (1 class)", lines[i]);
  check("done day: NEXT CLASS follows immediately", lines[i + 1] === "NEXT CLASS Mon 11:00 SOFTWARE-ENGINEERING (in 2d)", lines[i + 1]);
  check("no duplicate NEXT CLASS", lines.filter((l) => l.startsWith("NEXT CLASS")).length === 1);
}

/* ── the Sunday gift: free day + week → none scheduled + tomorrow ───── */
{
  const sun1000 = ist(4, 10, 0);
  const text = buildTodaySms({ ...base, now: sun1000, todayClasses: [], weekSlots: [mon] });
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.startsWith("CLASSES TODAY"));
  check("free day: none scheduled", lines[i] === "CLASSES TODAY none scheduled", lines[i]);
  check("free day: NEXT CLASS tomorrow", lines[i + 1] === "NEXT CLASS Mon 11:00 SOFTWARE-ENGINEERING (tomorrow)", lines[i + 1]);
}

/* ── live state → the brief stays about TODAY ───────────────────────── */
{
  const sat0800 = ist(3, 8, 0); // before the 11:00 class
  const text = buildTodaySms({ ...base, now: sat0800, todayClasses: satClass, weekSlots: [mon] });
  check("upcoming today → no NEXT CLASS line", !text.includes("NEXT CLASS"), text.split("\n").find((l) => l.startsWith("CLASSES")) ?? "");
}
{
  const sat1130 = ist(3, 11, 30); // inside the class
  const text = buildTodaySms({ ...base, now: sat1130, todayClasses: satClass, weekSlots: [mon] });
  check("ongoing → no NEXT CLASS line", !text.includes("NEXT CLASS"));
}

/* ── unsynced gates ─────────────────────────────────────────────────── */
{
  const text = buildTodaySms({ ...base, now: sat1600, todayClasses: undefined, weekSlots: [mon] });
  check("no todayClasses → no CLASSES/NEXT CLASS at all", !text.includes("CLASSES TODAY") && !text.includes("NEXT CLASS"));
}
{
  const text = buildTodaySms({ ...base, now: sat1600, todayClasses: satClass, weekSlots: undefined });
  check("no weekSlots → done day, no NEXT CLASS line", text.includes("done (1 class)") && !text.includes("NEXT CLASS"));
}
{
  const text = buildTodaySms({ ...base, now: sat1600, todayClasses: [], weekSlots: null });
  check("null weekSlots → free day, no NEXT CLASS line", text.includes("none scheduled") && !text.includes("NEXT CLASS"));
}

/* ── keyword precedence + tone ──────────────────────────────────────── */
{
  const p = smsLineParts("NEXT CLASS Mon 11:00 X (in 2d)");
  check("NEXT CLASS splits as its own keyword", p !== null && p.keyword === "NEXT CLASS", p?.keyword ?? "null");
  check("NEXT CLASS tone violet", p !== null && smsKeywordTone(p.keyword) === "violet");
  const q = smsLineParts("NEXT Submit report (RWM) due FRI 09 OCT");
  check("plain NEXT unchanged", q !== null && q.keyword === "NEXT");
  check("NEXT tone still violet", smsKeywordTone("NEXT") === "violet");
  check("NEXT CLASS listed before NEXT", SMS_KEYWORDS.indexOf("NEXT CLASS") < SMS_KEYWORDS.indexOf("NEXT"));
  check("NEXT CLASS prefix does not shadow NEXT lines", smsLineParts("NEXT foo")?.keyword === "NEXT");
}

/* ── GSM-7 honesty with the new line ────────────────────────────────── */
{
  const text = buildTodaySms({ ...base, now: sat1600, todayClasses: satClass, weekSlots: [mon, sun] });
  check("extended brief stays GSM-7", smsSegments(text).encoding === "GSM-7");
  check("char count includes the new line", smsSegments(text).chars === [...text].length);
}

/* ── ALA NEXT + class NEXT CLASS coexist ────────────────────────────── */
{
  const text = buildTodaySms({
    ...base,
    now: sat1600,
    todayClasses: satClass,
    weekSlots: [mon],
    nextDue: { id: "a1", title: "ALA 3 report", subjectCode: "RWM", subjectName: null, dueAt: new Date(ist(9, 9, 0)).toISOString(), externalId: null },
  });
  const lines = text.split("\n");
  check("both NEXT-ish lines coexist", lines.some((l) => l.startsWith("NEXT CLASS")) && lines.some((l) => l.startsWith("NEXT ") && !l.startsWith("NEXT CLASS")), lines.join(" | "));
}

console.log(`r97 smsNextClassLine: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
