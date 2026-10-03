/**
 * Offline parser test: runs parseGmiuClassRoutine against the saved
 * /tmp/class-routine.html (captured read-only from the live ERP) and prints
 * the parsed slots for verification. No network, no DB.
 * Run: cd /home/z/my-project && bun run scripts/test-routine-parse.ts
 */
import { readFileSync } from "fs";
import { parseGmiuClassRoutine, deriveSubjectCode } from "../src/lib/erp/live";

const html = readFileSync("/tmp/class-routine.html", "utf8");

// Active Subject rows in the live DB (the attendance-page namespace).
const activeCodes = new Set([
  "ADVANCED-MOBILE-APPLICAT",
  "ANALYSIS-AND-DESIGN-OF-A",
  "ARTIFICIAL-INTELLIGENCE",
  "COMPUTER-NETWORKS",
  "HOD-LECTURE",
  "RESPONSIVE-WEB-MOBILE",
  "SOFTWARE-ENGINEERING",
  "SUMMER-INTERNSHIP",
]);

const out = parseGmiuClassRoutine(html, deriveSubjectCode);
if (!out) {
  console.log("PARSE FAILED — returned null");
  process.exit(1);
}
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
console.log(`slots: ${out.slots.length}, unknownNames: ${JSON.stringify(out.unknownNames)}`);
const byDay = new Map<number, typeof out.slots>();
for (const s of out.slots) {
  if (!byDay.has(s.dayOfWeek)) byDay.set(s.dayOfWeek, []);
  byDay.get(s.dayOfWeek)!.push(s);
}
for (const d of [...byDay.keys()].sort((a, b) => a - b)) {
  const list = byDay.get(d)!.sort((a, b) => a.startMin - b.startMin);
  console.log(`${DAY[d]}: ${list.map((s) => `${s.subjectCode} ${hhmm(s.startMin)}-${hhmm(s.endMin)}`).join(" | ")}`);
}
// sanity: valid days/times AND every code exists in the active Subject namespace
const bad = out.slots.filter(
  (s) => s.dayOfWeek < 0 || s.dayOfWeek > 6 || s.endMin <= s.startMin || !activeCodes.has(s.subjectCode)
);
console.log("rows outside the active Subject namespace or invalid:", bad.length);
if (bad.length > 0) for (const b of bad) console.log("  BAD:", JSON.stringify(b));
