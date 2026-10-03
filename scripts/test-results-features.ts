/**
 * Unit tests for the Round 57 results-summary additions:
 * attemptHistory, cgpaProgression, projectCgpa.
 * Run: cd /home/z/my-project && bun run scripts/test-results-features.ts
 */
import {
  attemptHistory,
  cgpaProgression,
  projectCgpa,
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

/* Fixtures mirror the REAL May-2026 dump: 6 exams, career totals per regular. */
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

/* ---------- attemptHistory ---------- */
{
  const h = attemptHistory(exams, "BETCE12302");
  check("history: 3 mentions across exams", h.length === 3, `got ${h.length}`);
  check("history: latest first (2026-06)", h[0]?.dateKey === "2026-06", `got ${h[0]?.dateKey}`);
  check("history: second is S3 (2025-12)", h[1]?.dateKey === "2025-12");
  check("history: oldest is S2-reg (2025-05)", h[2]?.dateKey === "2025-05");
  check("history: kind recorded", h[0]?.kind === "REMEDIAL" && h[1]?.kind === "REGULAR");
  check("history: grades follow", h[0]?.grade === "F" && h[1]?.grade === "C");

  const cleared = attemptHistory(exams, "BETCE10101");
  check("history: cleared subject still lists its mention", cleared.length === 1 && cleared[0]?.grade === "F");

  check("history: unknown code → empty", attemptHistory(exams, "NOPE123").length === 0);
  check("history: empty exams → empty", attemptHistory([], "BETCE12302").length === 0);
}

/* ---------- cgpaProgression ---------- */
{
  const prog = cgpaProgression(exams);
  check("progression: regular-only (4 points)", prog.length === 4, `got ${prog.length}`);
  check(
    "progression: ascending by date",
    JSON.stringify(prog.map((p) => p.dateKey)) === JSON.stringify(["2024-12", "2025-05", "2025-12", "2026-05"]),
    JSON.stringify(prog.map((p) => p.dateKey)),
  );
  check(
    "progression: printed CGPA values",
    prog[0]?.cgpa === 1.739 && prog[1]?.cgpa === 4.565 && prog[2]?.cgpa === 5.542 && prog[3]?.cgpa === 5.446,
  );
  check("progression: carries career offered credits", prog[3]?.creditsOffered === 94);

  const withNull = cgpaProgression([
    exam({ typeId: "1", semester: 1, examDateKey: "2024-12", cgpa: 2.0 }),
    exam({ typeId: "2", semester: 2, examDateKey: "2025-05", cgpa: null, examKind: "REMEDIAL" }),
    exam({ typeId: "3", semester: 2, examDateKey: null, cgpa: 3.0 }), // null date → last, never assumed newer
  ]);
  check("progression: null-cgpa exam skipped", withNull.length === 2, `got ${withNull.length}`);
  check("progression: null-dated exam sorts last", withNull[1]?.dateKey === null && withNull[0]?.dateKey === "2024-12", `got ${JSON.stringify(withNull)}`);
}

/* ---------- projectCgpa ---------- */
{
  // Real ground truth: 5.446 × 94 base; +S5 at 7.0 × 24 cr → 5.762
  const p1 = projectCgpa(5.446, 94, 7.0, 24);
  check("projection: known math → 5.762", p1 === 5.762, `got ${p1}`);
  const p2 = projectCgpa(5.446, 94, 5.446, 24);
  check("projection: same SGPA drifts toward it (5.446)", p2 === 5.446, `got ${p2}`);
  check("projection: drop scenario negative delta", (projectCgpa(5.446, 94, 4.0, 24) ?? 0) < 5.446);
  check("projection: null base → null", projectCgpa(null, 94, 7, 24) === null);
  check("projection: null offered → null", projectCgpa(5.446, null, 7, 24) === null);
  check("projection: zero credits → null", projectCgpa(5.446, 94, 7, 0) === null);
  check("projection: negative credits → null", projectCgpa(5.446, 94, 7, -3) === null);
  check("projection: null sgpa → null", projectCgpa(5.446, 94, null, 24) === null);
  const p3 = projectCgpa(5.446, 94, 10, 24);
  check("projection: perfect semester → 6.372", p3 === 6.372, `got ${p3}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
