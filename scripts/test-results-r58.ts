/**
 * Unit tests for the Round 58 results-summary additions:
 * careerDeltas, resultsSummaryText.
 * Run: cd /home/z/my-project && bun run scripts/test-results-r58.ts
 */
import {
  careerDeltas,
  resultsSummaryText,
  type ExamLike,
} from "../src/lib/results-summary";

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

/* Fixtures mirror the REAL May-2026 dump (same shape as test-results-features). */
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

const exams: ExamLike[] = [
  exam({
    typeId: "1428",
    label: "SEM 2 REMEDIAL SUMMER 2026",
    examKind: "REMEDIAL",
    semester: 2,
    examDateKey: "2026-06",
    examDateLabel: "June-2026",
    sgpa: 4.521,
    subjects: [
      { code: "BETCE12302", name: "OBJECT-ORIENTED PROGRAMMING - II", credit: 5, grade: "F", creditPoint: 0 },
      { code: "BETXX10206", name: "SUSTAINABLE DEVELOPMENT", credit: 4, grade: "B", creditPoint: 24 },
    ],
  }),
  exam({
    typeId: "1425",
    label: "SEM 4 REGULAR SUMMER 2026",
    semester: 4,
    examDateKey: "2026-05",
    examDateLabel: "May-2026",
    sgpa: 5.166,
    cgpa: 5.446,
    offeredCredit: 24,
    earnedCredit: 22,
    totalOfferedCredit: 94,
    totalEarnedCredit: 87,
    result: "Fail",
    subjects: [
      { code: "BETCE14312", name: "CYBER LAWS AND ETHICS", credit: 2, grade: "F", creditPoint: 0 },
      { code: "BETCE14311", name: "SOFTWARE ENGINEERING", credit: 4, grade: "A", creditPoint: 32 },
    ],
  }),
  exam({
    typeId: "1420",
    label: "SEM 3 REGULAR WINTER 2025",
    semester: 3,
    examDateKey: "2025-12",
    examDateLabel: "Dec-2025",
    sgpa: 6.416,
    cgpa: 5.542,
    totalOfferedCredit: 70,
    result: "Pass",
    subjects: [{ code: "BETCE12302", name: "OBJECT-ORIENTED PROGRAMMING - II", credit: 5, grade: "C", creditPoint: 20 }],
  }),
  exam({
    typeId: "1410",
    label: "SEM 2 REGULAR SUMMER 2025",
    semester: 2,
    examDateKey: "2025-05",
    examDateLabel: "May-2025",
    sgpa: 3.478,
    cgpa: 4.565,
    totalOfferedCredit: 46,
    result: "Fail",
    subjects: [{ code: "BETCE12302", name: "OBJECT-ORIENTED PROGRAMMING - II", credit: 5, grade: "F", creditPoint: 0 }],
  }),
  exam({
    typeId: "1405",
    label: "SEM 1 REGULAR WINTER 2024",
    semester: 1,
    examDateKey: "2024-12",
    examDateLabel: "Dec-2024",
    sgpa: 1.739,
    cgpa: 1.739,
    totalOfferedCredit: 23,
    result: "Fail",
    subjects: [{ code: "BETCE10101", name: "MATHEMATICS-I", credit: 4, grade: "F", creditPoint: 0 }],
  }),
];

/* ---------- careerDeltas ---------- */
{
  const d = careerDeltas(exams);
  check("deltas: baseline (first regular) absent", !d.has("1405"), `keys ${[...d.keys()].join(",")}`);
  check("deltas: remedial exam absent", !d.has("1428"));
  check("deltas: regular count (3 deltas)", d.size === 3, `size ${d.size}`);
  check("deltas: S2 vs S1 → +2.826", d.get("1410") === 2.826, `got ${d.get("1410")}`);
  check("deltas: S3 vs S2 → +0.977", d.get("1420") === 0.977, `got ${d.get("1420")}`);
  check("deltas: S4 vs S3 → -0.096", d.get("1425") === -0.096, `got ${d.get("1425")}`);

  const nullCgpa = careerDeltas([
    exam({ typeId: "1", semester: 1, examDateKey: "2024-12", cgpa: 2.0 }),
    exam({ typeId: "2", semester: 2, examDateKey: "2025-05", cgpa: null }), // skipped — no career line printed
    exam({ typeId: "3", semester: 3, examDateKey: "2026-05", cgpa: 2.5 }),
  ]);
  check("deltas: null-cgpa regular skipped in chain", nullCgpa.size === 1 && nullCgpa.get("3") === 0.5, `got ${JSON.stringify([...nullCgpa])}`);

  const nullDate = careerDeltas([
    exam({ typeId: "9", semester: 2, examDateKey: null, cgpa: 3.0 }),
    exam({ typeId: "8", semester: 1, examDateKey: "2024-12", cgpa: 2.0 }),
  ]);
  check("deltas: null-dated exam sorts last (delta vs it excluded from earlier)", nullDate.get("9") === 1.0 && !nullDate.has("8"), `got ${JSON.stringify([...nullDate])}`);

  check("deltas: single regular → empty map", careerDeltas([exams[4] as ExamLike]).size === 0);
  check("deltas: empty exams → empty map", careerDeltas([]).size === 0);
}

/* ---------- resultsSummaryText ---------- */
{
  const text = resultsSummaryText(exams) ?? "";
  check("text: produced", text.length > 0);
  check("text: CGPA line with career date", text.startsWith("CGPA 5.45 (career, after May-2026)"), text.split("\n")[0]);
  check("text: credits line", text.includes("Credits 87 / 94 earned"));
  check("text: pending count (3 — fixture lacks the S1 remedial that really cleared MATH-I)", text.includes("Pending (3):"), text.split("\n")[2]?.slice(0, 40));
  check(
    "text: pending first is OOP-II with latest attempt",
    text.includes("BETCE12302 OBJECT-ORIENTED PROGRAMMING - II — F, latest attempt 2026-06"),
  );
  check(
    "text: pending second is Cyber Laws",
    text.includes("BETCE14312 CYBER LAWS AND ETHICS — F, latest attempt 2026-05"),
  );
  check(
    "text: pending includes fixture-only MATH-I (latest-mention-wins honest)",
    text.includes("BETCE10101 MATHEMATICS-I — F, latest attempt 2024-12"),
  );
  check("text: SGPA series with pass/fail flags", text.includes("SGPA: S1 1.74 (F) · S2 3.48 (F) · S3 6.42 (P) · S4 5.17 (F)"), text.split("\n")[3]);
  check("text: remedial line", text.includes("Remedial: ↺S2 4.52"));
  check(
    "text: retry line — OOP-II re-attempted F→C→F, still open",
    text.includes("Retries still open (1): BETCE12302 OBJECT-ORIENTED PROGRAMMING - II F→C→F"),
    text.split("\n")[5],
  );
  check("text: no recovered-retries line in this fixture", !text.includes("Retries recovered"));
  check("text: honest provenance footer", text.endsWith("(from the ERP Final Results page — published exams only)"));
  const lines = text.split("\n");
  check("text: exactly 7 lines (6 + the OOP-II retry line)", lines.length === 7, `got ${lines.length}`);

  check("text: empty exams → null", resultsSummaryText([]) === null);
  check("text: remedial-only → null", resultsSummaryText([exams[0] as ExamLike]) === null);

  const clean = resultsSummaryText([
    exam({
      typeId: "1",
      semester: 1,
      examDateKey: "2024-12",
      examDateLabel: "Dec-2024",
      cgpa: 8.0,
      totalOfferedCredit: 23,
      totalEarnedCredit: 23,
      result: "Pass",
    }),
  ]);
  check("text: clean record says no pending", (clean ?? "").includes("No pending backlogs"));
  check("text: clean record omits SGPA line when no sgpa", !(clean ?? "").includes("SGPA:"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
