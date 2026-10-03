/**
 * Tests for the /student/result parsers (parseGmiuResultIndex,
 * parseGmiuResult) and the deriveResultsSummary honest-state math.
 * Fixtures mirror the verified 8-table structure of the real pages
 * (captured 2026-10-03 by scripts/dump-result.ts).
 * Run: cd /home/z/my-project && bun run scripts/test-parse-results.ts
 */
import { parseGmiuResult, parseGmiuResultIndex } from "../src/lib/erp/live";
import { deriveResultsSummary, examPassed, gradeTier, byExamDateDesc } from "../src/lib/results-summary";
import type { ErpResultExam, ErpResultIndexEntry } from "../src/lib/erp/types";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL: ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const indexHtml = `
<html><body>
<select class="form-control" name="type" id="type" required>
  <option value="">Select</option>
  <option value="370" >UNDER GRADUATION COMPUTER ENGINEERING SEMESTER - 1 REGULAR WINTER - 2024</option>
  <option value="790" >UNDER GRADUATION COMPUTER ENGINEERING SEMESTER - 3 REGULAR WINTER - 2025</option>
</select>
</body></html>`;

const emptyIndexHtml = `
<select name="type" id="type" required>
  <option value="">Select</option>
</select>`;

function examPage(opts: {
  semester: string;
  yearOfExam: string;
  academicYear: string;
  name: string;
  enrollment: string;
  seat: string;
  /** 11-cell subject rows (raw cell text). */
  subjects: string[];
  /** backlog data cells (Sem1..8). */
  backlog: string[];
  /** 11-cell summary row. */
  summary: string[];
}): string {
  const t = (rows: string[][], tag: "th" | "td" = "td") =>
    `<table class="display table table-striped">${rows
      .map(
        (r) =>
          `<tr class="text-center">${r.map((c) => `<${tag}> ${c} </${tag}>`).join("")}</tr>`
      )
      .join("")}</table>`;
  const subjectTable =
    `<table class="display table table-striped">` +
    `<tr class="text-center"><th rowspan=2>Subject Code</th><th rowspan=2>Subject Name</th><th rowspan=2>Subject Credit</th><th rowspan=2>ESE Absent</th><th colspan=2 class="border">SEE</th><th colspan=3 class="border">CCE</th><th rowspan=2>Subject Grade</th><th rowspan=2>Credit Point</th></tr>` +
    `<tr class="text-center"><th class="border">T</th><th class="border">P</th><th class="border">M</th><th class="border">I</th><th class="border">V</th></tr>` +
    opts.subjects.map((r) => `<tr class="text-center fw-bold">${r.split("|").map((c) => `<td> ${c} </td>`).join("")}</tr>`).join("") +
    `</table>`;
  return [
    t([["Academic Year", "Semester", "Year of Examination"], [opts.academicYear, opts.semester, opts.yearOfExam]]),
    t([["Institute Name", "Program Name", "Branch Name"], ["GIT", "Under Graduation", "B.tech CSE"]]),
    t([["Student Name", "Enrollment No.", "Seat No."], [opts.name, opts.enrollment, opts.seat]]),
    subjectTable,
    t([["Backlog", "Sem 1", "Sem 2", "Sem 3", "Sem 4", "Sem 5", "Sem 6", "Sem 7", "Sem 8"], opts.backlog]),
    t([["Offered Credit", "Earned Credit", "Offered Credit Point", "Earned Credit Point", "SGPA", "Total Offered Credit", "Total Earned Credit", "Total Offered Credit Point", "Total Earned Credit Point", "CGPA", "Result"], opts.summary]),
    t([["Type", "Status", "Action"], ["Re-Check", "Not Applied", "Date Expired"]]),
    t([["T : Theory", "P : Practical"]]),
  ].join("\n");
}

const entry370: ErpResultIndexEntry = {
  typeId: "370",
  label: "UNDER GRADUATION COMPUTER ENGINEERING SEMESTER - 1 REGULAR WINTER - 2024",
};
const entry618: ErpResultIndexEntry = {
  typeId: "618",
  label: "UNDER GRADUATION COMPUTER ENGINEERING SEMESTER - 1 REMEDIAL SUMMER - 2025",
};

// Mirrors the real Sem-1 REGULAR page: 4 failures, SGPA 1.739, backlog Sem1=4
const page370 = examPage({
  semester: "1",
  yearOfExam: "December-2024",
  academicYear: "2024-2025",
  name: "JAJAL SAMARTH DHARMENDRABHAI",
  enrollment: "240905040034",
  seat: "BET1W24013499",
  subjects: [
    "BETCE10201|WORDPRESS (CONTENT MANAGEMENT SYSTEM)|2|-|-|O|-|B|A|A|16",
    "BETCE11301|OBJECT ORIENTED PROGRAMMING - I|5|-|F|A+|P|A+|A+|F|0",
    "BETXX10201|MATHAMATICS-I|4|-|F|-|P|B|B+|F|0",
  ],
  backlog: ["4", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A"],
  summary: ["23", "6", "230", "40", "1.739", "23", "6", "230", "40", "1.739", "Fail"],
});

// Mirrors the real Sem-1 REMEDIAL page: the 4 failed subjects, all cleared
const page618 = examPage({
  semester: "1",
  yearOfExam: "May-2025",
  academicYear: "2025-2026",
  name: "JAJAL SAMARTH DHARMENDRABHAI",
  enrollment: "240905040034",
  seat: "BET1S25120521",
  subjects: [
    "BETCE11301|OBJECT ORIENTED PROGRAMMING - I|5|-|C|A+|P|A+|A+|B|30",
    "BETEE10301|BASIC ELECTRICAL AND ELECTRONICS ENGINEERING|4|-|P|B+|P|B|B|C|20",
    "BETME10301|ENGINEERING GRAPHICS|4|-|P|C|B|C|B|C|20",
    "BETXX10201|MATHAMATICS-I|4|-|C|-|P|B|B+|C|20",
  ],
  backlog: ["0", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A"],
  summary: ["23", "23", "230", "130", "5.652", "23", "23", "230", "130", "5.652", "Pass"],
});

/* ------------------------------------------------------------------ */
/* Index parser                                                        */
/* ------------------------------------------------------------------ */

const idx = parseGmiuResultIndex(indexHtml);
check("index: found", idx !== null);
check("index: 2 options", idx?.length === 2, JSON.stringify(idx));
check("index: first id", idx?.[0]?.typeId === "370");
check("index: label trimmed", idx?.[0]?.label.startsWith("UNDER GRADUATION") === true);
check("index: skips empty value option", idx?.every((e) => e.typeId !== "") === true);

const emptyIdx = parseGmiuResultIndex(emptyIndexHtml);
check("index: empty picker → []", emptyIdx !== null && emptyIdx.length === 0);

check("index: garbage → null", parseGmiuResultIndex("<html><body>login</body></html>") === null);
check("index: no picker → null", parseGmiuResultIndex("<select name=\"semester\"><option>1</option></select>") === null);

/* ------------------------------------------------------------------ */
/* Exam parser                                                         */
/* ------------------------------------------------------------------ */

const r370 = parseGmiuResult(page370, entry370);
check("370: parsed", r370 !== null);
check("370: kind", r370?.examKind === "REGULAR");
check("370: semester 1", r370?.semester === 1);
check("370: session", r370?.examSession === "WINTER 2024");
check("370: dateKey", r370?.examDateKey === "2024-12");
check("370: dateLabel", r370?.examDateLabel === "December-2024");
check("370: academicYear", r370?.academicYear === "2024-2025");
check("370: name", r370?.studentName === "JAJAL SAMARTH DHARMENDRABHAI");
check("370: enrollment", r370?.enrollment === "240905040034");
check("370: seat", r370?.seatNo === "BET1W24013499");
check("370: 3 subjects", r370?.subjects.length === 3);
check("370: sgpa", r370?.sgpa === 1.739);
check("370: cgpa", r370?.cgpa === 1.739);
check("370: offered/earned", r370?.offeredCredit === 23 && r370?.earnedCredit === 6);
check("370: totals", r370?.totalOfferedCredit === 23 && r370?.totalEarnedCredit === 6);
check("370: verdict", r370?.result === "Fail");
check("370: backlog Sem1=4 rest N/A", JSON.stringify(r370?.backlogBySem) === "[4,null,null,null,null,null,null,null]", JSON.stringify(r370?.backlogBySem));

const s0 = r370?.subjects[0];
check("370 row0: code", s0?.code === "BETCE10201");
check("370 row0: credit", s0?.credit === 2);
check("370 row0: eseAbsent false", s0?.eseAbsent === false);
check("370 row0: seeTheory null", s0?.seeTheory === null);
check("370 row0: seePractical O", s0?.seePractical === "O");
check("370 row0: cceMid null", s0?.cceMid === null);
check("370 row0: cceInternal B", s0?.cceInternal === "B");
check("370 row0: cceViva A", s0?.cceViva === "A");
check("370 row0: grade A", s0?.grade === "A");
check("370 row0: cp 16", s0?.creditPoint === 16);
check("370 row1: fail F cp 0", r370?.subjects[1]?.grade === "F" && r370?.subjects[1]?.creditPoint === 0);
check("370 row1: eseAbsent false when dash", r370?.subjects[1]?.eseAbsent === false);

const r618 = parseGmiuResult(page618, entry618);
check("618: parsed", r618 !== null);
check("618: kind REMEDIAL", r618?.examKind === "REMEDIAL");
check("618: session SUMMER 2025", r618?.examSession === "SUMMER 2025");
check("618: verdict Pass", r618?.result === "Pass");
check("618: OOP-I cleared cp 30", r618?.subjects[0]?.creditPoint === 30);
check("618: eseAbsent true on AB", (() => {
  const withAbs = parseGmiuResult(
    examPage({
      semester: "2", yearOfExam: "May-2025", academicYear: "2025-2026",
      name: "N", enrollment: "E", seat: "S",
      subjects: ["BETXX10001|ABSENT SUBJECT|3|AB|F|-|P|-|-|F|0"],
      backlog: ["1", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A"],
      summary: ["10", "0", "100", "0", "0", "10", "0", "100", "0", "0", "Fail"],
    }),
    { typeId: "1", label: "X SEMESTER - 2 REGULAR SUMMER - 2025" }
  );
  return withAbs?.subjects[0]?.eseAbsent === true && withAbs?.subjects[0]?.grade === "F";
})());

check("exam: missing tables → null", parseGmiuResult("<table><tr><td>x</td></tr></table>", entry370) === null);
check("exam: garbage → null", parseGmiuResult("login page", entry370) === null);

// a malformed subject row (wrong cell count) is skipped, others still parse
const mixedRows = examPage({
  semester: "2", yearOfExam: "May-2025", academicYear: "2025-2026",
  name: "N", enrollment: "E", seat: "S",
  subjects: [
    "HEADER-ROW|NOT A COURSE|x|-|-|-|-|-|-|-|0",
    "BETXX10002|GOOD SUBJECT|3|-|C|-|P|B|B|C|15",
  ],
  backlog: ["0", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A"],
  summary: ["10", "3", "100", "15", "5", "10", "3", "100", "15", "5", "Pass"],
});
const rmixed = parseGmiuResult(mixedRows, { typeId: "2", label: "Y SEMESTER - 2 REGULAR SUMMER - 2025" });
check("exam: non-code row skipped", rmixed?.subjects.length === 1 && rmixed.subjects[0]?.code === "BETXX10002");

/* ------------------------------------------------------------------ */
/* Summary math (honest-state)                                         */
/* ------------------------------------------------------------------ */

const mk = (o: Partial<ErpResultExam> & Pick<ErpResultExam, "typeId" | "label">): ErpResultExam => ({
  examKind: "REGULAR",
  semester: null,
  examSession: null,
  examDateKey: null,
  examDateLabel: null,
  academicYear: null,
  studentName: null,
  enrollment: null,
  seatNo: null,
  subjects: [],
  backlogBySem: [],
  offeredCredit: null,
  earnedCredit: null,
  sgpa: null,
  totalOfferedCredit: null,
  totalEarnedCredit: null,
  cgpa: null,
  result: null,
  ...o,
});

const s370 = r370 as ErpResultExam;
const s618 = r618 as ErpResultExam;
const sem2Regular = mk({
  typeId: "467",
  label: "U SEMESTER - 2 REGULAR SUMMER - 2025",
  semester: 2,
  examDateKey: "2025-05",
  sgpa: 3.478,
  cgpa: 4.565,
  totalEarnedCredit: 37,
  totalOfferedCredit: 46,
  result: "Fail",
  subjects: [
    { code: "BETCE12302", name: "OBJECT-ORIENTED PROGRAMMING - II", credit: 5, grade: "F", creditPoint: 0, eseAbsent: false, seeTheory: "F", seePractical: "A+", cceMid: "P", cceInternal: "A+", cceViva: "B" },
    { code: "BETXX10206", name: "SUSTAINABLE DEVELOPMENT", credit: 4, grade: "F", creditPoint: 0, eseAbsent: false, seeTheory: "F", seePractical: "A", cceMid: "P", cceInternal: "A+", cceViva: "A" },
  ],
});
const sem2RemedialLater = mk({
  typeId: "1430",
  label: "U SEMESTER - 2 REMEDIAL SUMMER - 2026",
  examKind: "REMEDIAL",
  semester: 2,
  examDateKey: "2026-06",
  sgpa: 4.521,
  result: "Fail",
  subjects: [
    // OOP-II retried and still failing; Sustainable cleared
    { code: "BETCE12302", name: "OBJECT-ORIENTED PROGRAMMING - II", credit: 5, grade: "F", creditPoint: 0, eseAbsent: false, seeTheory: "F", seePractical: "A+", cceMid: "P", cceInternal: "A+", cceViva: "B" },
    { code: "BETXX10206", name: "SUSTAINABLE DEVELOPMENT", credit: 4, grade: "B", creditPoint: 24, eseAbsent: false, seeTheory: "C", seePractical: "A", cceMid: "P", cceInternal: "A+", cceViva: "A" },
  ],
});
const sem3Regular = mk({
  typeId: "790",
  label: "U SEMESTER - 3 REGULAR WINTER - 2025",
  semester: 3,
  examDateKey: "2025-12",
  sgpa: 6.416,
  cgpa: 5.542,
  totalEarnedCredit: 65,
  totalOfferedCredit: 70,
  result: "Pass",
  subjects: [{ code: "BETCE13303", name: "DATA STRUCTURE", credit: 5, grade: "C", creditPoint: 25, eseAbsent: false, seeTheory: "P", seePractical: "A+", cceMid: "P", cceInternal: "B", cceViva: "C" }],
});

const summary = deriveResultsSummary([s370, s618, sem2Regular, sem2RemedialLater, sem3Regular]);

check("summary: latestRegular = sem3 (2025-12)", summary.latestRegular?.typeId === "790");
check("summary: cgpa from latest regular", summary.cgpa === 5.542);
check("summary: career credits", summary.creditsEarned === 65 && summary.creditsOffered === 70);
check("summary: pending = OOP-II only (latest-mention-wins)", summary.pending.length === 1 && summary.pending[0]?.code === "BETCE12302", JSON.stringify(summary.pending.map((p) => p.code)));
check("summary: pending provenance = latest exam", summary.pending[0]?.examLabel.includes("REMEDIAL SUMMER - 2026") === true);
check("summary: regular series S1,S2,S3", JSON.stringify(summary.regularSeries.map((p) => p.semester)) === "[1,2,3]", JSON.stringify(summary.regularSeries));
check("summary: regular series values", summary.regularSeries[0]?.sgpa === 1.739 && summary.regularSeries[2]?.sgpa === 6.416);
check("summary: regular series pass flags", summary.regularSeries[0]?.passed === false && summary.regularSeries[2]?.passed === true);
check("summary: remedial series S1,S2", JSON.stringify(summary.remedialSeries.map((p) => p.semester)) === "[1,2]");
check("summary: hasRecord", summary.hasRecord === true);

check("summary: empty exams", deriveResultsSummary([]).hasRecord === false && deriveResultsSummary([]).pending.length === 0);

// cleared-later wins over earlier failure (Sem-1 subjects: failed 370, cleared 618)
const cleared = deriveResultsSummary([s370, s618]);
check("summary: all Sem-1 subjects cleared by remedial", cleared.pending.length === 0, JSON.stringify(cleared.pending.map((p) => p.code)));

// latest-mention wins even when the later exam is null-dated (sorts last)
const nullDated = mk({
  typeId: "999",
  label: "U SEMESTER - 1 REGULAR",
  semester: 1,
  examDateKey: null,
  result: "Fail",
  subjects: [{ code: "BETCE11301", name: "OOP-I", credit: 5, grade: "F", creditPoint: 0, eseAbsent: false, seeTheory: null, seePractical: null, cceMid: null, cceInternal: null, cceViva: null }],
});
const withNullDated = deriveResultsSummary([s618, nullDated]);
check("summary: null-dated exam treated as OLDEST", withNullDated.pending.length === 0, JSON.stringify(withNullDated.pending));

/* ------------------------------------------------------------------ */
/* Sorting + helpers                                                   */
/* ------------------------------------------------------------------ */

check("sort: date desc", byExamDateDesc(
  { typeId: "a", label: "", examKind: "REGULAR", semester: 1, examDateKey: "2025-01", subjects: [], offeredCredit: null, earnedCredit: null, sgpa: null, totalOfferedCredit: null, totalEarnedCredit: null, cgpa: null, result: null },
  { typeId: "b", label: "", examKind: "REGULAR", semester: 1, examDateKey: "2024-01", subjects: [], offeredCredit: null, earnedCredit: null, sgpa: null, totalOfferedCredit: null, totalEarnedCredit: null, cgpa: null, result: null }
) < 0);
check("sort: null date last", byExamDateDesc(
  { typeId: "a", label: "", examKind: "REGULAR", semester: 1, examDateKey: "2024-01", subjects: [], offeredCredit: null, earnedCredit: null, sgpa: null, totalOfferedCredit: null, totalEarnedCredit: null, cgpa: null, result: null },
  { typeId: "b", label: "", examKind: "REGULAR", semester: 1, examDateKey: null, subjects: [], offeredCredit: null, earnedCredit: null, sgpa: null, totalOfferedCredit: null, totalEarnedCredit: null, cgpa: null, result: null }
) < 0);

check("examPassed: Pass", examPassed("Pass") === true);
check("examPassed: Fail", examPassed("Fail") === false);
check("examPassed: null", examPassed(null) === false);

check("gradeTier: O top", gradeTier("O") === "top" && gradeTier("A+") === "top");
check("gradeTier: A/B+ good", gradeTier("A") === "good" && gradeTier("B+") === "good");
check("gradeTier: B/C ok", gradeTier("B") === "ok" && gradeTier("C") === "ok");
check("gradeTier: P weak", gradeTier("P") === "weak");
check("gradeTier: F fail", gradeTier("F") === "fail" && gradeTier("AB") === "fail");
check("gradeTier: null muted", gradeTier(null) === "muted");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
