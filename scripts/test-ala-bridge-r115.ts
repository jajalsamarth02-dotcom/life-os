/**
 * r115 — pinned tests for src/lib/ala-bridge.ts
 * Run: bun scripts/test-ala-bridge-r115.ts
 */
import {
  normalizeCourseName,
  bridgeMatch,
  alaBridge,
  alaBridgeCounts,
  bridgeChipText,
  bridgeTitle,
  bridgeSummaryLine,
  type BridgeSubject,
} from "../src/lib/ala-bridge";

let pass = 0;
let fail = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL ${label}\n  expected: ${e}\n  actual:   ${a}`);
  }
}

const SUBJECTS: BridgeSubject[] = [
  { code: "ANALYSIS-AND-DESIGN-OF-A", name: "ANALYSIS AND DESIGN OF ALGORITHM" },
  { code: "HOD-LECTURE", name: "HOD LECTURE" },
  { code: "ARTIFICIAL-INTELLIGENCE", name: "ARTIFICIAL INTELLIGENCE" },
  { code: "COMPUTER-NETWORKS", name: "COMPUTER NETWORKS" },
  { code: "ADVANCED-MOBILE-APPLICAT", name: "ADVANCED MOBILE APPLICATION DEVELOPMENT" },
  { code: "SOFTWARE-ENGINEERING", name: "SOFTWARE ENGINEERING" },
  { code: "RESPONSIVE-WEB-MOBILE", name: "RESPONSIVE WEB & MOBILE UI DESIGN" },
];

// ---------- normalizeCourseName ----------
eq(normalizeCourseName("ARTIFICIAL INTELLIGENCE"), "ARTIFICIAL INTELLIGENCE", "norm: exact already");
eq(normalizeCourseName("Artificial  Intelligence"), "ARTIFICIAL INTELLIGENCE", "norm: case + double space");
eq(normalizeCourseName("Responsive Web & Mobile UI Design"), "RESPONSIVE WEB AND MOBILE UI DESIGN", "norm: ampersand → AND");
eq(normalizeCourseName("  COMPUTER   NETWORKS "), "COMPUTER NETWORKS", "norm: outer trim + inner collapse");
eq(normalizeCourseName(""), null, "norm: empty → null");
eq(normalizeCourseName("   "), null, "norm: blank → null");
eq(normalizeCourseName(null), null, "norm: null → null");
eq(normalizeCourseName(undefined), null, "norm: undefined → null");
eq(normalizeCourseName("A & B"), "A AND B", "norm: & always spaced");

// ---------- bridgeMatch ----------
eq(bridgeMatch("ARTIFICIAL INTELLIGENCE", SUBJECTS)?.code, "ARTIFICIAL-INTELLIGENCE", "match: exact name");
eq(bridgeMatch("RESPONSIVE WEB & MOBILE UI DESIGN", SUBJECTS)?.code, "RESPONSIVE-WEB-MOBILE", "match: ampersand name matches & subject");
eq(bridgeMatch("RESPONSIVE WEB AND MOBILE UI DESIGN", SUBJECTS)?.code, "RESPONSIVE-WEB-MOBILE", "match: spelled-out AND matches & subject");
eq(bridgeMatch("artificial intelligence", SUBJECTS)?.code, "ARTIFICIAL-INTELLIGENCE", "match: lowercase course name");
eq(bridgeMatch("ADVANCED WEB DEVELOPMENT", SUBJECTS), null, "match: orphan course → null");
eq(bridgeMatch("ARTIFICIAL", SUBJECTS), null, "match: substring must NEVER match");
eq(bridgeMatch("ARTIFICIAL INTELLIGENC", SUBJECTS), null, "match: near-miss must NEVER match");
eq(bridgeMatch("AI", SUBJECTS), null, "match: initial must NEVER match");
eq(bridgeMatch("ANALYSIS AND DESIGN OF ALGORITHMS", SUBJECTS), null, "match: plural trailing S is a DIFFERENT name");
eq(bridgeMatch(null, SUBJECTS), null, "match: null name → null");
eq(bridgeMatch("", SUBJECTS), null, "match: empty name → null");
eq(bridgeMatch("SOFTWARE ENGINEERING", []), null, "match: empty registry → null");

// ---------- alaBridge ----------
eq(alaBridge("SOFTWARE ENGINEERING", SUBJECTS), { kind: "live", subject: { code: "SOFTWARE-ENGINEERING", name: "SOFTWARE ENGINEERING" } }, "bridge: live");
eq(alaBridge("ADVANCED WEB DEVELOPMENT", SUBJECTS), { kind: "orphan", subject: null }, "bridge: orphan (known name, no live subject)");
eq(alaBridge(null, SUBJECTS), { kind: "unlabeled", subject: null }, "bridge: unlabeled (no name)");
eq(alaBridge("  ", SUBJECTS), { kind: "unlabeled", subject: null }, "bridge: blank name → unlabeled");

// ---------- alaBridgeCounts ----------
eq(
  alaBridgeCounts([
    { kind: "live", subject: null },
    { kind: "live", subject: null },
    { kind: "orphan", subject: null },
    { kind: "unlabeled", subject: null },
  ]),
  { live: 2, orphan: 1, unlabeled: 1, total: 4 },
  "counts: mixed"
);
eq(alaBridgeCounts([]), { live: 0, orphan: 0, unlabeled: 0, total: 0 }, "counts: empty");

// ---------- bridgeChipText ----------
eq(bridgeChipText({ kind: "live", subject: { code: "COMPUTER-NETWORKS", name: "COMPUTER NETWORKS" } }), "COMPUTER-NETWORKS", "chip: live → subject code");
eq(bridgeChipText({ kind: "orphan", subject: null }), "Not in attendance", "chip: orphan copy pinned");
eq(bridgeChipText({ kind: "unlabeled", subject: null }), "Unlabeled course", "chip: unlabeled copy pinned");
eq(bridgeChipText({ kind: "live", subject: null }), "Unlabeled course", "chip: malformed live falls through (defensive)");

// ---------- bridgeTitle ----------
eq(
  bridgeTitle({ kind: "live", subject: { code: "AI-X", name: "ARTIFICIAL INTELLIGENCE" } }, "ARTIFICIAL INTELLIGENCE"),
  "Same course as attendance subject AI-X — this term's classes are counted there.",
  "title: live pinned"
);
eq(
  bridgeTitle({ kind: "orphan", subject: null }, "ADVANCED WEB DEVELOPMENT"),
  "ADVANCED WEB DEVELOPMENT isn't part of this term's attendance — the ERP's ALA page still lists its work.",
  "title: orphan pinned"
);
eq(bridgeTitle({ kind: "orphan", subject: null }, null), "This course isn't part of this term's attendance — the ERP's ALA page still lists its work.", "title: orphan null name fallback");
eq(
  bridgeTitle({ kind: "unlabeled", subject: null }, null),
  "The ERP hasn't labeled this ALA course, so it can't be linked to attendance.",
  "title: unlabeled pinned"
);

// ---------- bridgeSummaryLine ----------
eq(bridgeSummaryLine({ live: 6, orphan: 1, unlabeled: 0, total: 7 }), "6 of 7 ALA courses match this term's attendance · 1 not in attendance", "summary: live+orphan");
eq(bridgeSummaryLine({ live: 7, orphan: 0, unlabeled: 0, total: 7 }), "7 of 7 ALA courses match this term's attendance", "summary: all live (no orphan tail)");
eq(bridgeSummaryLine({ live: 0, orphan: 3, unlabeled: 0, total: 3 }), "0 of 3 ALA courses match this term's attendance · 3 not in attendance", "summary: zero live is still sayable");
eq(bridgeSummaryLine({ live: 0, orphan: 0, unlabeled: 4, total: 4 }), null, "summary: only unlabeled → null (cannot judge)");
eq(bridgeSummaryLine({ live: 0, orphan: 0, unlabeled: 0, total: 0 }), null, "summary: empty wall → null");

// ---------- LIVE REGRESSION (the real ERP data shapes from Oct 5) ----------
const COURSE_NAMES: Record<string, string> = {
  BETCE15324: "RESPONSIVE WEB & MOBILE UI DESIGN",
  BETCE15314: "ARTIFICIAL INTELLIGENCE",
  BETCE15316: "ADVANCED WEB DEVELOPMENT",
  BETCE15313: "ANALYSIS AND DESIGN OF ALGORITHM",
  BETCE15317: "ADVANCED MOBILE APPLICATION DEVELOPMENT",
  BETCE15322: "SOFTWARE ENGINEERING",
  BETCE15315: "COMPUTER NETWORKS",
};
const liveResults = Object.entries(COURSE_NAMES).map(([code, name]) => ({
  code,
  bridge: alaBridge(name, SUBJECTS),
}));
const liveCount = alaBridgeCounts(liveResults.map((r) => r.bridge));
eq(liveCount, { live: 6, orphan: 1, unlabeled: 0, total: 7 }, "LIVE: 6 of 7 map, ADVANCED WEB DEVELOPMENT orphaned");
eq(liveResults.find((r) => r.code === "BETCE15316")?.bridge.kind, "orphan", "LIVE: BETCE15316 is the orphan");
eq(liveResults.find((r) => r.code === "BETCE15324")?.bridge.subject?.code, "RESPONSIVE-WEB-MOBILE", "LIVE: RWMD maps to RESPONSIVE-WEB-MOBILE");
eq(liveResults.find((r) => r.code === "BETCE15313")?.bridge.subject?.code, "ANALYSIS-AND-DESIGN-OF-A", "LIVE: ALGO maps to truncated code");

console.log(`\nala-bridge r115: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
