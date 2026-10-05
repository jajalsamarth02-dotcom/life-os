/**
 * r107 — reminder-hygiene: the ONE housekeeping rulebook (dead ghosts and
 * duplicate ERP rows). Pinned here:
 *   • normalizeTitle — case/punctuation/whitespace fingerprints collide
 *     ("ALA -1" ≡ "ala 1"); unicode letters survive
 *   • numericErpId — erp:assign:479686 → 479686; foreign prefixes, non-
 *     numeric tails and null all refuse
 *   • THE LIVE INCIDENT TRIO — the exact duplicate pairs found in the real
 *     DB on 2026-10-05: AJAX & API Integration Task (479686 + 406808, same
 *     due), Mini Project (479755 + 406875, same due), PDO Secure CRUD
 *     Challenge (479824 due 08-24 + 410784 due 08-25) → three groups; keep
 *     = latest due then highest id (PDO keeps the LATER deadline 410784)
 *   • GROUPING BOUNDARIES — different subjects never group; due dates more
 *     than DUPLICATE_DUE_WINDOW_MS apart never group; DONE/DISMISSED rows
 *     are invisible; PERSONAL rows never group (source purity); three rows
 *     in one bucket form ONE group with two ghosts
 *   • STALE BOUNDARY — exactly STALE_OVERDUE_MS overdue is stale; 1ms less
 *     is recent; future rows belong to neither; attendance warnings are
 *     excluded everywhere
 *   • nextAssignmentStatus — the engine guard matrix: DISMISSED + not
 *     completed stays DISMISSED (the resurrection bug this round closed);
 *     completed always mirrors DONE; plain rows mirror ACTIVE
 *   • DETERMINISM — the same input twice yields byte-identical keep/ghost
 *     picks (the dialog must never shuffle between reloads)
 */
import {
  buildHousekeepingPlan,
  DUPLICATE_DUE_WINDOW_MS,
  findDuplicateGroups,
  nextAssignmentStatus,
  normalizeTitle,
  numericErpId,
  STALE_OVERDUE_MS,
  type HygieneReminder,
} from "../src/lib/reminder-hygiene";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

const NOW = Date.UTC(2026, 9, 5, 9, 0, 0); // 14:30 IST, 2026-10-05

function row(p: Partial<HygieneReminder> & { id: string; title: string }): HygieneReminder {
  return {
    source: "ERP",
    externalId: null,
    type: "ASSIGNMENT",
    subjectCode: null,
    dueAt: new Date(NOW - 30 * 86_400_000).toISOString(),
    status: "ACTIVE",
    ...p,
  };
}

/* ---------- 1. normalizeTitle ---------- */

check("lowercase + punctuation stripped", normalizeTitle("ALA -1") === "ala 1");
check("whitespace collapses", normalizeTitle("ALA   -   1") === "ala 1");
check("case collides", normalizeTitle("Mini Project") === normalizeTitle("mini PROJECT"));
check("unicode letters survive", normalizeTitle("Résumé v2") === "résumé v2");
check("digits survive", normalizeTitle("ALA-2026 #3") === "ala 2026 3");
check("empty stays empty", normalizeTitle("   ") === "");

/* ---------- 2. numericErpId ---------- */

check("assignment id parses", numericErpId("erp:assign:479686") === 479686);
check("warn id parses", numericErpId("erp:warn:123") === 123);
check("foreign prefix refuses", numericErpId("ext:assign:479686") === null);
check("non-numeric tail refuses", numericErpId("erp:assign:ADVANCED") === null);
check("null refuses", numericErpId(null) === null);
check("empty refuses", numericErpId("") === null);

/* ---------- 3. the live incident trio ---------- */

// Exact rows as found in the DB (titles, ids, due dates, subjects).
const ajaxNew = row({
  id: "t39wd8py",
  title: "AJAX & API Integration Task",
  externalId: "erp:assign:479686",
  subjectCode: "BETCE15316",
  dueAt: "2026-08-24T12:00:00.000Z",
});
const ajaxOld = row({
  id: "sws2k2oa",
  title: "AJAX & API Integration Task",
  externalId: "erp:assign:406808",
  subjectCode: "BETCE15316",
  dueAt: "2026-08-24T12:00:00.000Z",
});
const miniNew = row({
  id: "36lvet31",
  title: "Mini Project",
  externalId: "erp:assign:479755",
  subjectCode: "BETCE15316",
  dueAt: "2026-08-24T12:00:00.000Z",
});
const miniOld = row({
  id: "dqrgvqmo",
  title: "Mini Project",
  externalId: "erp:assign:406875",
  subjectCode: "BETCE15316",
  dueAt: "2026-08-24T12:00:00.000Z",
});
const pdoNew = row({
  id: "kixijx9j",
  title: "PDO Secure CRUD Challenge",
  externalId: "erp:assign:479824",
  subjectCode: "BETCE15316",
  dueAt: "2026-08-24T12:00:00.000Z",
});
const pdoOld = row({
  id: "c0994cr6",
  title: "PDO Secure CRUD Challenge",
  externalId: "erp:assign:410784",
  subjectCode: "BETCE15316",
  dueAt: "2026-08-25T12:00:00.000Z",
});

{
  const groups = findDuplicateGroups([ajaxNew, ajaxOld, miniNew, miniOld, pdoNew, pdoOld]);
  check("the incident trio yields exactly 3 groups", groups.length === 3, `got ${groups.length}`);
  const byKeep = new Map(groups.map((g) => [g.keep.id, g]));
  check("AJAX keep = the newer id (same due)", byKeep.has("t39wd8py"));
  check("AJAX ghost = 406808 row", byKeep.get("t39wd8py")?.ghosts[0]?.id === "sws2k2oa");
  check("Mini Project keep = the newer id", byKeep.has("36lvet31"));
  check("PDO keep = the LATER deadline (410784)", byKeep.has("c0994cr6"), JSON.stringify(groups.map((g) => g.keep.id)));
  check("PDO ghost = 479824 row", byKeep.get("c0994cr6")?.ghosts[0]?.id === "kixijx9j");
  // determinism
  const again = findDuplicateGroups([ajaxNew, ajaxOld, miniNew, miniOld, pdoNew, pdoOld]);
  check(
    "deterministic keep picks across runs",
    JSON.stringify(again.map((g) => g.keep.id)) === JSON.stringify(groups.map((g) => g.keep.id))
  );
}

/* ---------- 4. grouping boundaries ---------- */

{
  const otherSubject = row({
    id: "aaa",
    title: "Mini Project",
    externalId: "erp:assign:1",
    subjectCode: "BETCE15315",
    dueAt: "2026-08-24T12:00:00.000Z",
  });
  check("different subject never groups", findDuplicateGroups([miniNew, otherSubject]).length === 0);
}
{
  const farRow = row({
    id: "bbb",
    title: "Mini Project",
    externalId: "erp:assign:2",
    subjectCode: "BETCE15316",
    dueAt: "2026-08-24T12:00:00.000Z",
  });
  const beyond = row({ ...farRow, id: "ccc", externalId: "erp:assign:3", dueAt: "2026-08-28T12:00:00.000Z" });
  check("4 days apart never groups", findDuplicateGroups([farRow, beyond]).length === 0);
  const within = row({ ...farRow, id: "ddd", externalId: "erp:assign:4", dueAt: "2026-08-26T12:00:00.000Z" });
  check("2 days apart groups", findDuplicateGroups([farRow, within]).length === 1);
  check(
    "window constant is 3 days",
    DUPLICATE_DUE_WINDOW_MS === 3 * 86_400_000
  );
}
{
  const doneRow = row({ id: "eee", title: "Mini Project", externalId: "erp:assign:5", status: "DONE", dueAt: "2026-08-24T12:00:00.000Z" });
  check("DONE rows are invisible to grouping", findDuplicateGroups([miniNew, doneRow]).length === 0);
  const dismissedRow = row({ id: "fff", title: "Mini Project", externalId: "erp:assign:6", status: "DISMISSED", dueAt: "2026-08-24T12:00:00.000Z" });
  check("DISMISSED rows are invisible to grouping", findDuplicateGroups([miniNew, dismissedRow]).length === 0);
}
{
  const personal = row({ id: "ggg", title: "Mini Project", source: "PERSONAL", externalId: null, dueAt: "2026-08-24T12:00:00.000Z" });
  check("personal rows never group with ERP", findDuplicateGroups([miniNew, personal]).length === 0);
  check("two personal rows never group", findDuplicateGroups([personal, row({ ...personal, id: "hhh" })]).length === 0);
}
{
  const third = row({ id: "iii", title: "Mini Project", externalId: "erp:assign:9", subjectCode: "BETCE15316", dueAt: "2026-08-25T12:00:00.000Z" });
  const g = findDuplicateGroups([miniNew, miniOld, third]);
  check("three same rows form ONE group", g.length === 1);
  check("keep = the LATEST deadline row (iii, 08-25)", g[0].keep.id === "iii" && g[0].ghosts.length === 2);
  check(
    "ghosts ordered deterministically",
    g[0].ghosts[0].id === "36lvet31" && g[0].ghosts[1].id === "dqrgvqmo",
    JSON.stringify(g[0].ghosts.map((x) => x.id))
  );
}
{
  const warn = row({ id: "jjj", type: "ATTENDANCE_WARNING", title: "Attendance below target — X", externalId: "erp:warn:X" });
  const warn2 = row({ ...warn, id: "kkk", externalId: "erp:warn:Y" });
  check("attendance warnings never group", findDuplicateGroups([warn, warn2]).length === 0);
}
{
  // exam-type rows group too (ghosts are not assignment-exclusive)
  const exam1 = row({ id: "lll", type: "EXAM", title: "Mid Term", externalId: "erp:exam:1", dueAt: "2026-08-24T12:00:00.000Z" });
  const exam2 = row({ id: "mmm", type: "EXAM", title: "MID TERM", externalId: "erp:exam:2", dueAt: "2026-08-24T12:00:00.000Z" });
  check("non-assignment types group by the same rule", findDuplicateGroups([exam1, exam2]).length === 1);
}

/* ---------- 5. buildHousekeepingPlan / stale boundary ---------- */

{
  const stale = row({ id: "s1", title: "Old ghost", dueAt: new Date(NOW - (STALE_OVERDUE_MS + 86_400_000)).toISOString() });
  const recent = row({ id: "s2", title: "Yesterday miss", dueAt: new Date(NOW - 86_400_000).toISOString() });
  const future = row({ id: "s3", title: "Upcoming", dueAt: new Date(NOW + 7 * 86_400_000).toISOString() });
  const exact = row({ id: "s4", title: "Exact boundary", dueAt: new Date(NOW - STALE_OVERDUE_MS).toISOString() });
  const justInside = row({ id: "s5", title: "Just inside", dueAt: new Date(NOW - STALE_OVERDUE_MS + 1).toISOString() });
  const warn = row({ id: "s6", type: "ATTENDANCE_WARNING", title: "Warning", dueAt: new Date(NOW - 90 * 86_400_000).toISOString() });
  const plan = buildHousekeepingPlan([stale, recent, future, exact, justInside, warn], NOW);
  check("stale bucket holds >14d overdue", plan.staleOverdue.map((r) => r.id).join(",") === "s1,s4", plan.staleOverdue.map((r) => r.id).join(","));
  check("exactly 14d is stale (>= boundary)", plan.staleOverdue.some((r) => r.id === "s4"));
  check("1ms inside 14d is recent", plan.recentOverdue.some((r) => r.id === "s5"));
  check("recent holds the fresh miss", plan.recentOverdue.map((r) => r.id).join(",") === "s5,s2");
  check("future rows in neither bucket", !plan.staleOverdue.some((r) => r.id === "s3") && !plan.recentOverdue.some((r) => r.id === "s3"));
  check("warnings excluded from the plan", !plan.staleOverdue.some((r) => r.id === "s6") && !plan.recentOverdue.some((r) => r.id === "s6"));
  check("plan sorts overdue oldest-first", plan.staleOverdue[0].id === "s1" && plan.recentOverdue[0].id === "s5");
}
{
  const clean = buildHousekeepingPlan([], NOW);
  check("empty list → empty plan", clean.staleOverdue.length === 0 && clean.recentOverdue.length === 0 && clean.duplicateGroups.length === 0);
}

/* ---------- 6. nextAssignmentStatus (engine guard) ---------- */

check("completed always mirrors DONE", nextAssignmentStatus("ACTIVE", true) === "DONE");
check("completed even from DISMISSED mirrors DONE", nextAssignmentStatus("DISMISSED", true) === "DONE");
check("plain row mirrors ACTIVE", nextAssignmentStatus("ACTIVE", false) === "ACTIVE");
check("the resurrection bug: DISMISSED + not completed stays DISMISSED", nextAssignmentStatus("DISMISSED", false) === "DISMISSED");
check("DONE + not completed goes ACTIVE (still mirrored)", nextAssignmentStatus("DONE", false) === "ACTIVE");

/* ---------- summary ---------- */

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
