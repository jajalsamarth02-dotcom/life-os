/**
 * Offline tests for the parallel-batch pick math (src/lib/batch-picks.ts).
 * Pure functions only — no DB, no server. Run: bun scripts/test-batch-picks.ts
 *
 * Fixture mirrors the real routine's parallel shape (Round 54):
 *   Mon 08:25-09:45  RESPONSIVE-WEB-MOBILE + SOFTWARE-ENGINEERING   (2 options)
 *   Wed 13:45-15:45  ARTIFICIAL-INTELLIGENCE + COMPUTER-NETWORKS ×2  (2 options, one duplicated batch)
 *   Fri 11:00-13:00  ANALYSIS-AND-DESIGN-OF-A + ARTIFICIAL-INTELLIGENCE + COMPUTER-NETWORKS (3 options)
 *   Sat 11:00-13:00  RESPONSIVE-WEB-MOBILE ×2  (same class, two batches — NOT a cell)
 */
import {
  applyBatchPicks,
  parallelCellKey,
  parallelCells,
  parseBatchPicks,
  validatePicks,
} from "../src/lib/batch-picks";

interface Row {
  id: string;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  subjectCode: string;
}

const AI = "ARTIFICIAL-INTELLIGENCE";
const ADA = "ANALYSIS-AND-DESIGN-OF-A";
const CN = "COMPUTER-NETWORKS";
const RWM = "RESPONSIVE-WEB-MOBILE";
const SE = "SOFTWARE-ENGINEERING";

const slots: Row[] = [
  { id: "m1", dayOfWeek: 1, startMin: 660, endMin: 720, subjectCode: SE },
  { id: "m2", dayOfWeek: 1, startMin: 825, endMin: 945, subjectCode: RWM },
  { id: "m3", dayOfWeek: 1, startMin: 825, endMin: 945, subjectCode: SE },
  { id: "w1", dayOfWeek: 3, startMin: 825, endMin: 945, subjectCode: AI },
  { id: "w2", dayOfWeek: 3, startMin: 825, endMin: 945, subjectCode: CN },
  { id: "w3", dayOfWeek: 3, startMin: 825, endMin: 945, subjectCode: CN },
  { id: "f1", dayOfWeek: 5, startMin: 660, endMin: 780, subjectCode: ADA },
  { id: "f2", dayOfWeek: 5, startMin: 660, endMin: 780, subjectCode: AI },
  { id: "f3", dayOfWeek: 5, startMin: 660, endMin: 780, subjectCode: CN },
  { id: "s1", dayOfWeek: 6, startMin: 660, endMin: 780, subjectCode: RWM },
  { id: "s2", dayOfWeek: 6, startMin: 660, endMin: 780, subjectCode: RWM },
];

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function codes(rows: { subjectCode: string }[]): string {
  return rows.map((r) => r.subjectCode).sort().join("|");
}

console.log("— parallelCells —");
const cells = parallelCells(slots);
check("3 cells found (Mon 825, Wed 825, Fri 660)", cells.length === 3, `got ${cells.length}`);
check(
  "cell keys are content-derived",
  cells.map((c) => c.key).join(",") === "1-825-945,3-825-945,5-660-780",
  cells.map((c) => c.key).join(",")
);
const mon = cells[0];
check("Mon cell has 2 distinct sorted options", mon.options.join("|") === [RWM, SE].sort().join("|"), mon.options.join("|"));
const wed = cells[1];
check("Wed duplicate CN batch collapsed to ONE option", wed.options.join("|") === [AI, CN].sort().join("|"), wed.options.join("|"));
check("Wed cell has one representative row per option", wed.rows.length === 2, `got ${wed.rows.length}`);
check("Sat same-code pair is NOT a cell", !cells.some((c) => c.key === "6-660-780"));
check("cellKey format", parallelCellKey({ dayOfWeek: 3, startMin: 825, endMin: 945, subjectCode: CN }) === "3-825-945");
check("cells sorted by day then time", cells.every((c, i) => i === 0 || cells[i - 1].dayOfWeek * 10000 + cells[i - 1].startMin <= c.dayOfWeek * 10000 + c.startMin));

console.log("— applyBatchPicks (no picks) —");
const none = applyBatchPicks(slots, {});
check("same-code duplicates ALWAYS collapse (11 rows → 9 attending)", none.attending.length === 9, `got ${none.attending.length}`);
check("one RWM remains on Sat", codes(none.attending.filter((r) => r.dayOfWeek === 6)) === RWM);
check("nothing excluded without picks", none.excluded.length === 0);
check("all 3 cells unresolved", none.unresolvedCells.length === 3);
check("no cell resolved", none.resolvedCells.length === 0);
check("input order preserved", none.attending.map((r) => r.id).join(",") === "m1,m2,m3,w1,w2,f1,f2,f3,s1");

console.log("— applyBatchPicks (with picks) —");
const picked = applyBatchPicks(slots, { "3-825-945": CN, "1-825-945": SE, "5-660-780": AI });
check("pick removes only the cross-code alternative rows (4 excluded: RWM Mon, AI Wed, ADA+CN Fri)", picked.excluded.length === 4, `got ${picked.excluded.length}`);
check("Wed keeps exactly one CN row", codes(picked.attending.filter((r) => r.dayOfWeek === 3 && r.startMin === 825)) === CN);
check("Mon keeps SE, drops RWM", codes(picked.attending.filter((r) => r.dayOfWeek === 1 && r.startMin === 825)) === SE);
check("Fri keeps AI, drops ADA+CN", codes(picked.attending.filter((r) => r.dayOfWeek === 5)) === AI);
check("all cells resolved", picked.resolvedCells.length === 3 && picked.unresolvedCells.length === 0);
check("same-code collapse still applies with picks", picked.attending.length === 11 - 2 - 4, `got ${picked.attending.length}`);
check(
  "excluded rows are exactly the alternatives",
  codes(picked.excluded) === [ADA, AI, CN, RWM].sort().join("|"),
  codes(picked.excluded)
);
check("Sat untouched by picks", codes(picked.attending.filter((r) => r.dayOfWeek === 6)) === RWM);

console.log("— parseBatchPicks —");
check("valid JSON parses", Object.keys(parseBatchPicks('{"3-825-945":"CN"}')).length === 1);
check("garbage → empty", Object.keys(parseBatchPicks("not-json{")).length === 0);
check("null/undefined → empty", Object.keys(parseBatchPicks(null)).length === 0 && Object.keys(parseBatchPicks(undefined)).length === 0);
check("arrays rejected", Object.keys(parseBatchPicks('["a","b"]')).length === 0);
check("non-string values dropped", Object.keys(parseBatchPicks('{"k":5,"j":"CN"}')).join(",") === "j");
check("empty-string values dropped", Object.keys(parseBatchPicks('{"k":""}')).length === 0);
check("overlong values dropped", Object.keys(parseBatchPicks(`{"k":"${"x".repeat(121)}"}`)).length === 0);

console.log("— validatePicks (resync safety) —");
check("valid pick survives", validatePicks({ "3-825-945": CN }, slots)["3-825-945"] === CN);
check("wrong code dropped", !("3-825-945" in validatePicks({ "3-825-945": ADA }, slots)));
check("stale key (class moved) dropped", !("2-825-945" in validatePicks({ "2-825-945": CN }, slots)));
check("pick on a non-cell (same-code only) window dropped", !("6-660-780" in validatePicks({ "6-660-780": RWM }, slots)));
check("pick survives a resync that keeps wall times (new row ids)", validatePicks({ "3-825-945": CN }, slots.map((s) => ({ ...s, id: `new-${s.id}` })))["3-825-945"] === CN);
check("pick drops when the resync removes one option", (() => {
  const merged = slots.filter((s) => !(s.dayOfWeek === 3 && s.subjectCode === AI));
  return !("3-825-945" in validatePicks({ "3-825-945": AI }, merged));
})());
check("clearing unknown key is a safe no-op shape", Object.keys(validatePicks({}, slots)).length === 0);

console.log("— multi-cell independence —");
const partial = applyBatchPicks(slots, { "5-660-780": CN });
check("only Fri resolved; Mon+Wed still count every option", partial.resolvedCells.length === 1 && partial.unresolvedCells.length === 2);
check("Wed unresolved keeps BOTH AI and CN (one CN row)", codes(partial.attending.filter((r) => r.dayOfWeek === 3 && r.startMin === 825)) === [AI, CN].sort().join("|"));
check("Fri trims to CN", codes(partial.attending.filter((r) => r.dayOfWeek === 5)) === CN);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
