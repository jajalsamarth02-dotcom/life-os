/**
 * Round 70 — retry-story spotlight gate (matchStoryCode).
 *
 * Retry-story deep-links now carry a subject code: the command palette's
 * per-story commands and the results card's pending-row History buttons all
 * funnel through matchStoryCode before spotlighting a story row. The gate is
 * exact-match against the parsed stories — a code that drifted (case,
 * whitespace, parse change) must return null so the caller falls back to the
 * GENERIC open instead of silently highlighting nothing (or the wrong row).
 * Same honesty contract as the timetable's knownSubjectCode: drift stays
 * visible, never papered over. This file pins that contract.
 *
 * Run: bun scripts/test-results-r70.ts
 */
import { matchStoryCode, subjectStories, type SubjectStory } from "../src/lib/results-summary";

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.error(`FAIL  ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

const STORIES: SubjectStory[] = [
  {
    code: "BCA301",
    name: "Computer Networks",
    credit: 4,
    attempts: [
      { typeId: "t1", semester: 3, kind: "REGULAR", dateKey: "2024-12-01", dateLabel: "Dec 2024", grade: "F", creditPoint: 0 },
      { typeId: "t2", semester: 5, kind: "REMEDIAL", dateKey: "2025-06-01", dateLabel: "Jun 2025", grade: "C", creditPoint: 4 },
    ],
    latestGrade: "C",
    cleared: true,
  },
  {
    code: "BCA-302",
    name: "Operating Systems",
    credit: 4,
    attempts: [
      { typeId: "t3", semester: 5, kind: "REGULAR", dateKey: "2025-12-01", dateLabel: "Dec 2025", grade: "F", creditPoint: 0 },
    ],
    latestGrade: "F",
    cleared: false,
  },
];

// ---- exact-match gate -------------------------------------------------
check("exact code hits its story", matchStoryCode("BCA301", STORIES)?.code === "BCA301");
check("second story hit by its exact code", matchStoryCode("BCA-302", STORIES)?.code === "BCA-302");
check("hit returns the full story object", matchStoryCode("BCA301", STORIES)?.name === "Computer Networks");

// ---- honesty: every drift mode falls back to null ----------------------
check("case drift (bca301) → null, no silent fold", matchStoryCode("bca301", STORIES) === null);
check("whitespace drift → null", matchStoryCode(" BCA301 ", STORIES) === null);
check("unknown code → null (generic fallback)", matchStoryCode("BCA999", STORIES) === null);
check("empty string → null (falsy guard)", matchStoryCode("", STORIES) === null);
check("null code → null (generic open)", matchStoryCode(null, STORIES) === null);
check("undefined code → null", matchStoryCode(undefined, STORIES) === null);

// ---- empty stories list ------------------------------------------------
check("empty stories → null even for a well-formed code", matchStoryCode("BCA301", []) === null);

// ---- integration: subjectStories output feeds the gate unchanged --------
// The stories the card passes to the gate come straight from subjectStories;
// a real parse round-trip must keep codes gate-stable (no trimming/renaming
// between the roll-up and the gate).
const exam = {
  typeId: "exam-s5",
  examKind: "REGULAR" as const,
  semester: 5,
  examDateKey: "2025-12-01",
  examDateLabel: "Dec 2025",
  subjects: [
    { code: "BCA303", name: "Software Engineering", credit: 4, grade: "F", creditPoint: 0 },
    { code: "BCA304", name: "Web Technologies", credit: 3, grade: "A", creditPoint: 9 },
    { code: "BCA304", name: "Web Technologies", credit: 3, grade: "B", creditPoint: 8 },
    { code: "BCA305", name: "Cloud Computing", credit: 2, grade: "A", creditPoint: 9 },
  ],
};
const parsed = subjectStories([exam as never]);
// BCA304 = retry (2 mentions) → story; BCA303 = single F → story (a fail alone
// qualifies by design); BCA305 = single clean pass → NO story.
check("parsed stories: retry + fail subjects only", parsed.length === 2);
check("parsed stories: code round-trips through the gate", matchStoryCode("BCA304", parsed) === parsed.find((s) => s.code === "BCA304"));
check(
  "single-attempt no-fail subject produced no story (nothing to spotlight)",
  matchStoryCode("BCA305", parsed) === null
);
check(
  "fail story is spotlatable and honestly not cleared",
  matchStoryCode("BCA303", parsed)?.cleared === false
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
