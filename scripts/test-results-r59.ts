/**
 * Unit tests for the Round 59 results-summary addition: subjectStories.
 * Run: cd /home/z/my-project && bun run scripts/test-results-r59.ts
 */
import { subjectStories, type ExamLike } from "../src/lib/results-summary";

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

/* Real-shaped fixture: OOP-II cleared at S3 then re-failed; MATH-I cleared by S1 remedial;
   one always-clean subject; one single-attempt clean subject. */
const exams: ExamLike[] = [
  exam({
    typeId: "1428", examKind: "REMEDIAL", semester: 2, examDateKey: "2026-06", examDateLabel: "June-2026",
    subjects: [
      { code: "BETCE12302", name: "OBJECT-ORIENTED PROGRAMMING - II", credit: 5, grade: "F", creditPoint: 0 },
    ],
  }),
  exam({
    typeId: "1427", examKind: "REMEDIAL", semester: 1, examDateKey: "2026-06", examDateLabel: "June-2026",
    subjects: [
      { code: "BETCE10101", name: "MATHEMATICS-I", credit: 4, grade: "C", creditPoint: 12 },
    ],
  }),
  exam({
    typeId: "1425", semester: 4, examDateKey: "2026-05", examDateLabel: "May-2026",
    subjects: [
      { code: "BETCE14312", name: "CYBER LAWS AND ETHICS", credit: 2, grade: "F", creditPoint: 0 },
      { code: "BETCE14311", name: "SOFTWARE ENGINEERING", credit: 4, grade: "A", creditPoint: 32 },
    ],
  }),
  exam({
    typeId: "1420", semester: 3, examDateKey: "2025-12", examDateLabel: "Dec-2025",
    subjects: [
      { code: "BETCE12302", name: "OBJECT-ORIENTED PROGRAMMING - II", credit: 5, grade: "C", creditPoint: 20 },
    ],
  }),
  exam({
    typeId: "1410", semester: 2, examDateKey: "2025-05", examDateLabel: "May-2025",
    subjects: [
      { code: "BETCE12302", name: "OBJECT-ORIENTED PROGRAMMING - II", credit: 5, grade: "F", creditPoint: 0 },
    ],
  }),
  exam({
    typeId: "1405", semester: 1, examDateKey: "2024-12", examDateLabel: "Dec-2024",
    subjects: [
      { code: "BETCE10101", name: "MATHEMATICS-I", credit: 4, grade: "F", creditPoint: 0 },
      { code: "BETCE10102", name: "APPLIED PHYSICS", credit: 4, grade: "O", creditPoint: 40 },
    ],
  }),
];

{
  const stories = subjectStories(exams);
  const codes = stories.map((s) => s.code);

  check("stories: 3 subjects qualify (OOP-II, MATH-I, Cyber)", stories.length === 3, codes.join(","));
  check("stories: clean single-attempt subjects excluded", !codes.includes("BETCE10102") && !codes.includes("BETCE14311"));
  check("stories: not-cleared first, most-attempts next (OOP-II 3 tries before Cyber 1)", codes[0] === "BETCE12302" && codes[1] === "BETCE14312", codes.join(","));
  check("stories: cleared-but-bumpy MATH-I last", codes[2] === "BETCE10101");

  const oop = stories.find((s) => s.code === "BETCE12302")!;
  check("stories: OOP-II 3 attempts", oop.attempts.length === 3, String(oop.attempts.length));
  check("stories: OOP-II timeline ASCENDING F→C→F", oop.attempts.map((a) => a.grade).join("") === "FCF", oop.attempts.map((a) => a.grade).join(""));
  check("stories: OOP-II dates ascend 2025-05→2025-12→2026-06", oop.attempts.map((a) => a.dateKey).join(",") === "2025-05,2025-12,2026-06");
  check("stories: OOP-II not cleared (latest cp=0)", oop.cleared === false);
  check("stories: OOP-II latest grade F", oop.latestGrade === "F");

  const math = stories.find((s) => s.code === "BETCE10101")!;
  check("stories: MATH-I 2 attempts F→C ascending", math.attempts.map((a) => a.grade).join("") === "FC");
  check("stories: MATH-I cleared by latest mention", math.cleared === true);
  check("stories: MATH-I kind recorded (remedial last)", math.attempts[1]?.kind === "REMEDIAL");

  const cyber = stories.find((s) => s.code === "BETCE14312")!;
  check("stories: Cyber single-attempt fail still qualifies", cyber.attempts.length === 1 && cyber.cleared === false);

  const tie = subjectStories([
    exam({ typeId: "1", examDateKey: "2026-05", subjects: [{ code: "AAA1", name: "A", credit: 2, grade: "B", creditPoint: 12 }] }),
    exam({ typeId: "2", examDateKey: "2026-05", subjects: [{ code: "ZZZ9", name: "Z", credit: 2, grade: "F", creditPoint: 0 }] }),
    exam({ typeId: "3", examDateKey: "2026-05", subjects: [{ code: "MMM5", name: "M", credit: 2, grade: "F", creditPoint: 0 }] }),
  ]);
  check("stories: tie-break by code asc", tie.map((s) => s.code).join(",") === "MMM5,ZZZ9", tie.map((s) => s.code).join(","));

  check("stories: empty exams → empty", subjectStories([]).length === 0);
  check("stories: no fails/retries → empty", subjectStories([exam({ typeId: "9", examDateKey: "2026-05", subjects: [{ code: "X1", name: "X", credit: 2, grade: "A", creditPoint: 32 }] })]).length === 0);

  const singleSubj = subjectStories([exams[5] as ExamLike]);
  check("stories: single exam with F still tells the story", singleSubj.length === 1 && singleSubj[0]?.code === "BETCE10101");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
