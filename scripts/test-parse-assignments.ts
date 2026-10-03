/** Offline validation of parseGmiuAssignments against the saved ERP page. */
import { parseGmiuAssignments, isSubmissionComplete } from "../src/lib/erp/live";

const html = await Bun.file("/home/z/my-project/scripts/out-assignment.html").text();

for (const sem of [5, 4, null]) {
  const rows = parseGmiuAssignments(html, sem);
  console.log(`sem=${sem}: ${rows?.length ?? "null"} rows`);
  if (rows && sem === 5) {
    const byCourse: Record<string, number> = {};
    for (const r of rows) byCourse[r.courseCode] = (byCourse[r.courseCode] ?? 0) + 1;
    console.log("  by course:", JSON.stringify(byCourse));
    console.log("  first:", JSON.stringify(rows[0]));
    console.log("  last :", JSON.stringify(rows[rows.length - 1]));
    const submitted = rows.filter((r) => isSubmissionComplete(r.submissionStatus, r.approvalStatus));
    console.log(`  submitted (complete): ${submitted.length}/${rows.length}`);
    if (submitted[0]) console.log("  sample submitted:", JSON.stringify(submitted[0]));
    const ids = new Set(rows.map((r) => r.externalId));
    console.log("  unique externalIds:", ids.size === rows.length ? "YES" : `NO (${ids.size})`);
  }
}
// sanity on the completion heuristics
console.log(
  "heuristics:",
  isSubmissionComplete("Pending") === false,
  isSubmissionComplete("Submitted") === true,
  isSubmissionComplete("Submitted", "Rejected") === false,
  isSubmissionComplete("Not Submitted") === false,
  isSubmissionComplete("") === false
);
