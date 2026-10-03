/**
 * Unit tests for the Round 60 results-summary addition:
 * resultsSummaryText retry lines (Retries still open / Retries recovered).
 * Rule under test: only subjects re-attempted across exams (>1 published
 * mention) get a retry line; a single failed attempt stays described by the
 * Pending line alone. Open retries list first, recovered second; the grade
 * timeline is the ascending attempt grades joined with → (nulls → "—").
 * Run: cd /home/z/my-project && bun run scripts/test-results-r60.ts
 */
import { resultsSummaryText, subjectStories, type ExamLike } from "../src/lib/results-summary";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function exam(partial: Partial<ExamLike> & { typeId: string }): ExamLike {
  return {
    label: partial.label ?? `exam-${partial.typeId}`,
    examKind: "REGULAR",
    semester: null,
    examDateKey: null,
    examDateLabel: null,
    subjects: [],
    offeredCredit: null,
    earnedCredit: null,
    sgpa: null,
    totalOfferedCredit: null,
    totalEarnedCredit: null,
    cgpa: null,
    result: null,
    ...partial,
  };
}

/* ---------- 1. multi-attempt open only (F→F) ---------- */
{
  const exams = [
    exam({
      typeId: "2",
      semester: 2,
      examKind: "REMEDIAL",
      examDateKey: "2026-06",
      examDateLabel: "June-2026",
      cgpa: null,
      result: "Fail",
      subjects: [{ code: "X101", name: "SUBJECT ONE", credit: 4, grade: "F", creditPoint: 0 }],
    }),
    exam({
      typeId: "1",
      semester: 2,
      examDateKey: "2025-05",
      examDateLabel: "May-2025",
      cgpa: 6.0,
      totalOfferedCredit: 24,
      totalEarnedCredit: 20,
      result: "Fail",
      subjects: [{ code: "X101", name: "SUBJECT ONE", credit: 4, grade: "F", creditPoint: 0 }],
    }),
  ];
  const text = resultsSummaryText(exams) ?? "";
  check("r60: open retry line present with timeline", text.includes("Retries still open (1): X101 SUBJECT ONE F→F"), text.split("\n").find((l) => l.startsWith("Retries")));
  check("r60: no recovered line when nothing recovered", !text.includes("Retries recovered"));
  check("r60: open retry also stays in the Pending line", text.includes("Pending (1): X101 SUBJECT ONE"));
  check("r60: retry line sits before the footer", text.indexOf("Retries still open") < text.lastIndexOf("(from the ERP"));
}

/* ---------- 2. multi-attempt recovered (F→C) ---------- */
{
  const exams = [
    exam({
      typeId: "3",
      semester: 3,
      examDateKey: "2025-12",
      examDateLabel: "Dec-2025",
      cgpa: 7.0,
      totalOfferedCredit: 48,
      totalEarnedCredit: 44,
      result: "Pass",
      subjects: [{ code: "X202", name: "SUBJECT TWO", credit: 4, grade: "C", creditPoint: 16 }],
    }),
    exam({
      typeId: "1",
      semester: 2,
      examDateKey: "2025-05",
      examDateLabel: "May-2025",
      cgpa: 5.5,
      totalOfferedCredit: 24,
      totalEarnedCredit: 20,
      result: "Fail",
      subjects: [{ code: "X202", name: "SUBJECT TWO", credit: 4, grade: "F", creditPoint: 0 }],
    }),
  ];
  const text = resultsSummaryText(exams) ?? "";
  check("r60: recovered retry line present", text.includes("Retries recovered (1): X202 SUBJECT TWO F→C"), text.split("\n").find((l) => l.startsWith("Retries")));
  check("r60: recovered retry is NOT in pending", text.includes("No pending backlogs"));
  check("r60: no open-retries line when all recovered", !text.includes("Retries still open"));
}

/* ---------- 3. single-fail pending: pending yes, retries no ---------- */
{
  const exams = [
    exam({
      typeId: "1",
      semester: 4,
      examDateKey: "2026-05",
      examDateLabel: "May-2026",
      cgpa: 5.4,
      totalOfferedCredit: 94,
      totalEarnedCredit: 87,
      result: "Fail",
      subjects: [{ code: "X303", name: "SUBJECT THREE", credit: 2, grade: "F", creditPoint: 0 }],
    }),
  ];
  const text = resultsSummaryText(exams) ?? "";
  check("r60: single fail stays in pending", text.includes("Pending (1): X303 SUBJECT THREE"));
  check("r60: single fail gets NO retry line (attempted once)", !text.includes("Retries"));
}

/* ---------- 4. mixed: open first, recovered second, counts right ---------- */
{
  const exams = [
    exam({
      typeId: "9",
      semester: 2,
      examKind: "REMEDIAL",
      examDateKey: "2026-06",
      examDateLabel: "June-2026",
      result: "Fail",
      subjects: [
        { code: "A1", name: "ALPHA ONE", credit: 5, grade: "F", creditPoint: 0 },
        { code: "B2", name: "BETA TWO", credit: 4, grade: "B", creditPoint: 24 },
      ],
    }),
    exam({
      typeId: "8",
      semester: 3,
      examDateKey: "2025-12",
      examDateLabel: "Dec-2025",
      cgpa: 7.2,
      totalOfferedCredit: 70,
      totalEarnedCredit: 66,
      result: "Pass",
      subjects: [
        { code: "A1", name: "ALPHA ONE", credit: 5, grade: "F", creditPoint: 0 },
        { code: "B2", name: "BETA TWO", credit: 4, grade: "F", creditPoint: 0 },
      ],
    }),
    exam({
      typeId: "7",
      semester: 2,
      examDateKey: "2025-05",
      examDateLabel: "May-2025",
      cgpa: 4.4,
      totalOfferedCredit: 46,
      totalEarnedCredit: 40,
      result: "Fail",
      subjects: [
        { code: "A1", name: "ALPHA ONE", credit: 5, grade: "F", creditPoint: 0 },
        { code: "B2", name: "BETA TWO", credit: 4, grade: "F", creditPoint: 0 },
      ],
    }),
  ];
  const text = resultsSummaryText(exams) ?? "";
  const openIdx = text.indexOf("Retries still open (1): A1 ALPHA ONE F→F→F");
  const recIdx = text.indexOf("Retries recovered (1): B2 BETA TWO F→F→B");
  check("r60: mixed open line exact", openIdx >= 0, text.split("\n").find((l) => l.startsWith("Retries")));
  check("r60: mixed recovered line exact", recIdx >= 0, text.split("\n").find((l) => l.startsWith("Retries")));
  check("r60: open line comes before recovered line", openIdx < recIdx);
  check("r60: re-attempted pass counts as recovered (latest B)", subjectStories(exams).find((s) => s.code === "B2")?.cleared === true);
}

/* ---------- 5. clean record: no retry lines at all ---------- */
{
  const exams = [
    exam({
      typeId: "1",
      semester: 1,
      examDateKey: "2024-12",
      examDateLabel: "Dec-2024",
      cgpa: 8.0,
      totalOfferedCredit: 23,
      totalEarnedCredit: 23,
      result: "Pass",
      subjects: [{ code: "C1", name: "CLEAN ONE", credit: 4, grade: "A", creditPoint: 32 }],
    }),
  ];
  const text = resultsSummaryText(exams) ?? "";
  check("r60: clean record has no retry lines", !text.includes("Retries"));
  check("r60: clean record still ends with the footer", text.endsWith("(from the ERP Final Results page — published exams only)"));
}

/* ---------- 6. null grades print as — in the timeline ---------- */
{
  const exams = [
    exam({
      typeId: "2",
      semester: 2,
      examKind: "REMEDIAL",
      examDateKey: "2026-06",
      examDateLabel: "June-2026",
      result: "Fail",
      subjects: [{ code: "D4", name: "DELTA FOUR", credit: 4, grade: null, creditPoint: 0 }],
    }),
    exam({
      typeId: "1",
      semester: 2,
      examDateKey: "2025-05",
      examDateLabel: "May-2025",
      cgpa: 6.0,
      totalOfferedCredit: 24,
      totalEarnedCredit: 20,
      result: "Pass",
      subjects: [{ code: "D4", name: "DELTA FOUR", credit: 4, grade: null, creditPoint: 0 }],
    }),
  ];
  const text = resultsSummaryText(exams) ?? "";
  check("r60: null grades render as — in the timeline", text.includes("Retries still open (1): D4 DELTA FOUR —→—"), text.split("\n").find((l) => l.startsWith("Retries")));
}

/* ---------- 7. remedial improvement re-attempt (P→B) recovered ---------- */
{
  const exams = [
    exam({
      typeId: "2",
      semester: 1,
      examKind: "REMEDIAL",
      examDateKey: "2026-06",
      examDateLabel: "June-2026",
      sgpa: 6.1,
      result: "Pass",
      subjects: [{ code: "E5", name: "ECHO FIVE", credit: 4, grade: "B", creditPoint: 24 }],
    }),
    exam({
      typeId: "1",
      semester: 1,
      examDateKey: "2024-12",
      examDateLabel: "Dec-2024",
      cgpa: 5.0,
      totalOfferedCredit: 23,
      totalEarnedCredit: 19,
      result: "Pass",
      subjects: [{ code: "E5", name: "ECHO FIVE", credit: 4, grade: "P", creditPoint: 16 }],
    }),
  ];
  const text = resultsSummaryText(exams) ?? "";
  check("r60: remedial improvement shows as recovered P→B", text.includes("Retries recovered (1): E5 ECHO FIVE P→B"), text.split("\n").find((l) => l.startsWith("Retries")));
  check("r60: improvement subject not pending", text.includes("No pending backlogs"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
