/**
 * Round 65 — bubble keyword highlighting + ongoing-class progress bar.
 *
 * smsLineParts splits a brief line into { keyword, rest } for the bubble's
 * STYLED RENDER ONLY — the clipboard/print text stays byte-identical, so
 * the splitter must (a) recognise every keyword the builder emits, and
 * (b) preserve exact characters (rest keeps the original whitespace).
 *
 * classProgress is the elapsed fraction of an ongoing class — null before
 * start / after end / degenerate span, honest 0–100 inside.
 *
 * Run: bun scripts/test-today-r65.ts
 */
import { smsLineParts, buildTodaySms, type TodaySmsInput } from "../src/components/erp/today-card";
import { classProgress } from "../src/components/erp/timetable-card";

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

console.log("— smsLineParts: every keyword the builder emits —");
{
  const cases: Array<[string, string | null]> = [
    ["OVERALL 2/3 (66.67%) vs 75% target - BELOW", "OVERALL"],
    ["NEED 1 more attended class to reach 75%", "NEED"],
    ["CAN SKIP 2 classes and stay above 75%", "CAN SKIP"],
    ["ON TARGET - keep it up", "ON TARGET"],
    ["BUDGET 3 safe skips across subjects", "BUDGET"],
    ["BUDGET 0 - attend everything", "BUDGET"],
    ["CLASSES TODAY 1 left - next 11:00 RESPONSIVE-WEB-MOBILE", "CLASSES TODAY"],
    ["CLASSES TODAY none scheduled", "CLASSES TODAY"],
    ["WORST AMATH-I 40.0% (2/5)", "WORST"],
    ["ALAS 3 pending / 12 tracked (1 overdue, 2 due in 7 days)", "ALAS"],
    ["NEXT Submit project report (RWM) due FRI 09 OCT", "NEXT"],
    ["NOTES 2 private notes on this device", "NOTES"],
    ["SYNCED 07:45 IST - erp.gmiu.edu.in", "SYNCED"],
    // header + non-keyword lines stay plain
    ["ERP SYNC - SAT 03 OCT 2026", null],
    ["", null],
    ["random text line", null],
    // tricky near-misses must NOT match
    ["NEEDY text", null], // no space after keyword
    ["SYNCEDX junk", null],
  ];
  for (const [line, kw] of cases) {
    const p = smsLineParts(line);
    check(
      JSON.stringify(line.slice(0, 34)) + (kw ? ` → ${kw}` : " → plain"),
      kw === null ? p === null : p !== null && p.keyword === kw
    );
  }
}

console.log("— smsLineParts: character preservation (WYSIWYG contract) —");
{
  const line = "CLASSES TODAY 1 left - next 11:00 RWM";
  const p = smsLineParts(line)!;
  check("keyword + rest reassemble to the exact line", p.keyword + p.rest === line);
  check("rest keeps the original leading space", p.rest === " 1 left - next 11:00 RWM");
  const bare = smsLineParts("SYNCED")!;
  check("bare keyword line → empty rest", bare.keyword === "SYNCED" && bare.rest === "");
}

console.log("— classProgress: honest elapsed fraction —");
{
  // 11:00–13:00 class (120 min), seen from 12:00 → exactly 50
  check("midpoint 50%", classProgress(660, 780, 720) === 50);
  check("quarter 25%", classProgress(660, 780, 690) === 25);
  check("three-quarters 75%", classProgress(660, 780, 750) === 75);
  // boundaries are EXCLUSIVE: not started / just ended are null
  check("null at the start minute", classProgress(660, 780, 660) === null);
  check("null before start", classProgress(660, 780, 600) === null);
  check("null at the end minute", classProgress(660, 780, 780) === null);
  check("null after end", classProgress(660, 780, 800) === null);
  // degenerate / corrupt spans
  check("null when end <= start", classProgress(600, 600, 630) === null);
  check("null when end < start", classProgress(700, 600, 630) === null);
  // honest non-round value: 30 of 230 → 13.04…
  const p = classProgress(660, 890, 690)!;
  check("non-round value honest", Math.abs(p - (30 / 230) * 100) < 1e-9, String(p));
}

console.log("— live cross-check: builder output + splitter agree —");
{
  // Build a real brief and confirm EVERY known line splits losslessly.
  const input: TodaySmsInput = {
    now: Date.UTC(2026, 9, 3, 2, 15), // 07:45 IST
    overall: { present: 2, total: 3, absent: 1, percentage: 66.67, status: "warning", classesToTarget: 1, canSkip: 0 },
    target: 75,
    subjects: [],
    warningSubjects: 0,
    alaPending: 3,
    alaTotal: 12,
    alaOverdue: 1,
    alaDueWeek: 2,
    nextDue: null,
    notedCount: 2,
    lastSyncAt: Date.UTC(2026, 9, 3, 2, 0),
    todayClasses: [{ startMin: 660, endMin: 780, subjectCode: "RWM" }],
  };
  const text = buildTodaySms(input);
  const lines = text.split("\n");
  const expectedKeywords = ["OVERALL", "NEED", "BUDGET", "CLASSES TODAY", "ALAS", "NOTES", "SYNCED"];
  const got: string[] = [];
  for (const ln of lines) {
    const p = smsLineParts(ln);
    if (p) {
      got.push(p.keyword);
      check(`lossless: ${p.keyword}`, p.keyword + p.rest === ln);
    } else {
      check(`plain: ${ln.slice(0, 24)}`, ln.startsWith("ERP SYNC") || ln.startsWith("WORST") || ln.startsWith("NEXT"));
    }
  }
  check(
    "every expected keyword present in order",
    JSON.stringify(got) === JSON.stringify(expectedKeywords),
    got.join(",")
  );
  // no line lost characters overall
  check("joined render equals original text", lines.join("\n") === text);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
