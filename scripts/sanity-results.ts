/**
 * READ-ONLY sanity check: run the new results parsers against the real
 * /tmp dumps captured by scripts/dump-result.ts.
 * Run: cd /home/z/my-project && bun run scripts/sanity-results.ts
 */
import { readdirSync, readFileSync } from "fs";
import { parseGmiuResult, parseGmiuResultIndex } from "../src/lib/erp/live";

const baseHtml = readFileSync("/tmp/student-result.html", "utf8");
const index = parseGmiuResultIndex(baseHtml);
console.log("index:", index?.length, "exams", JSON.stringify(index?.map((e) => e.typeId)));

for (const f of readdirSync("/tmp").filter((n) => n.startsWith("result-type-"))) {
  const html = readFileSync(`/tmp/${f}`, "utf8");
  const m = f.match(/result-type-(\d+)-/);
  if (!m || !index) continue;
  const entry = index.find((e) => e.typeId === m[1]);
  if (!entry) continue;
  const r = parseGmiuResult(html, entry);
  if (!r) {
    console.log(`${f}: PARSE NULL`);
    continue;
  }
  console.log(
    [
      `sem=${r.semester}`,
      r.examKind,
      r.examSession,
      `date=${r.examDateLabel}(${r.examDateKey})`,
      `ay=${r.academicYear}`,
      `name=${r.studentName}`,
      `seat=${r.seatNo}`,
      `subjects=${r.subjects.length}`,
      `sgpa=${r.sgpa}`,
      `cgpa=${r.cgpa}`,
      `earned=${r.earnedCredit}/${r.offeredCredit}`,
      `total=${r.totalEarnedCredit}/${r.totalOfferedCredit}`,
      `result=${r.result}`,
      `backlog=[${r.backlogBySem.map((b) => b ?? "-").join(",")}]`,
    ].join(" ")
  );
  const failed = r.subjects.filter((s) => s.creditPoint === 0);
  if (failed.length) console.log("   0-CP:", failed.map((s) => `${s.code} ${s.name.slice(0, 30)} grade=${s.grade}`).join(" | "));
  const first = r.subjects[0];
  console.log(
    `   row0: ${first.code} credit=${first.credit} seeT=${first.seeTheory} seeP=${first.seePractical} cceM=${first.cceMid} cceI=${first.cceInternal} cceV=${first.cceViva} grade=${first.grade} cp=${first.creditPoint}`
  );
}
