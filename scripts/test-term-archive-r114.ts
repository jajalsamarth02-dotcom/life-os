/**
 * r114 — the ARCHIVE SHELF rulebook (term-archive), pinned rule by rule.
 * Consumer: the attendance tab's trend/heatmap archive toggle.
 *
 * Pinned here:
 *   • AVAILABILITY — a payload is "available" only with ≥1 archived subject
 *     point; undefined/null/empty all render NO toggle (an archive button
 *     that opens an empty drawer is a lie).
 *   • SPAN — first→last archived point, whole days inclusive; single-point
 *     records are 1 day, not 0; null without data. The recorded overall
 *     series alone (no subject points) does NOT make an archive.
 *   • PEAK — max RECORDED overall percentage; never interpolated; null when
 *     the overall series is empty even if subject points exist.
 *   • COUNT — subjects with ≥1 point (empty series don't count).
 *   • SUBTITLE — the byte-pinned sentence; singular/plural grammar; null on
 *     empty payloads.
 *   • THE HONESTY CONTRACT — every export is a read-only reader; the module
 *     surface contains no projection/recovery/status vocabulary.
 */
import {
  archiveAvailable,
  archiveSpan,
  archivePeak,
  archiveSubjectCount,
  archiveSubtitle,
} from "../src/lib/term-archive";
import type { HistoryResponse } from "../src/components/erp/types";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`FAIL: ${name}${extra ? ` — ${extra}` : ""}`);
  }
}
function eq(name: string, got: unknown, want: unknown) {
  check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

function resp(partial: Partial<HistoryResponse>): HistoryResponse {
  return {
    overall: partial.overall ?? [],
    subjects: partial.subjects ?? {},
    subjectsMeta: partial.subjectsMeta ?? [],
  };
}

/* The real r114 situation, replayed: 6 removed subjects, a month of points,
   the recorded overall spanning BOTH eras (the archive surface only ever
   receives the pre-cut series — pinned by the API contract, mirrored here). */
const LIVE: HistoryResponse = {
  overall: [
    { t: "2026-09-01T04:00:00.000Z", percentage: 81, present: 81, total: 100 },
    { t: "2026-09-20T04:00:00.000Z", percentage: 86.4, present: 105, total: 121 },
    { t: "2026-10-02T11:00:00.000Z", percentage: 84.1, present: 106, total: 126 },
  ],
  subjects: {
    "DBMS-301": [
      { t: "2026-09-01T04:00:00.000Z", percentage: 80, present: 16, total: 20 },
      { t: "2026-10-02T11:00:00.000Z", percentage: 85, present: 17, total: 20 },
    ],
    "CS-302": [{ t: "2026-09-14T04:00:00.000Z", percentage: 90, present: 9, total: 10 }],
    "MA-305": [],
  },
  subjectsMeta: [
    { code: "DBMS-301", name: "DATABASE MANAGEMENT SYSTEMS" },
    { code: "CS-302", name: "OPERATING SYSTEMS" },
    { code: "MA-305", name: "MATHEMATICS-III" },
  ],
};

/* 1 — availability */
eq("available live", archiveAvailable(LIVE), true);
eq("available undefined", archiveAvailable(undefined), false);
eq("available null", archiveAvailable(null), false);
eq("available empty subjects", archiveAvailable(resp({ subjects: { X: [] } })), false);
eq(
  "availability ignores the recorded overall alone",
  archiveAvailable(resp({ overall: [{ t: "2026-09-01T00:00:00.000Z", percentage: 80, present: 8, total: 10 }] })),
  false
);

/* 2 — span (inclusive whole days) */
const span = archiveSpan(LIVE);
eq("span from", span?.from, "2026-09-01T04:00:00.000Z");
eq("span to", span?.to, "2026-10-02T11:00:00.000Z");
eq("span days inclusive", span?.days, 32); // Sep 1 → Oct 2 inclusive
eq("span null on undefined", archiveSpan(undefined), null);
eq(
  "span single point is one day",
  archiveSpan(resp({ subjects: { X: [{ t: "2026-09-01T00:00:00.000Z", percentage: 50, present: 1, total: 2 }] } }))?.days,
  1
);
eq(
  "span ignores empty series",
  archiveSpan(resp({ subjects: { X: [], Y: [] } })),
  null
);

/* 3 — peak (recorded only) */
eq("peak live", archivePeak(LIVE), 86.4);
eq("peak empty overall", archivePeak(resp({ subjects: LIVE.subjects })), null);
eq("peak undefined", archivePeak(undefined), null);
eq(
  "peak is exact max, not interpolation",
  archivePeak(resp({ overall: [
    { t: "2026-09-01T00:00:00.000Z", percentage: 70, present: 7, total: 10 },
    { t: "2026-09-02T00:00:00.000Z", percentage: 100, present: 2, total: 2 },
  ] })),
  100
);

/* 4 — subject count (non-empty series only) */
eq("count live (MA-305 empty)", archiveSubjectCount(LIVE), 2);
eq("count undefined", archiveSubjectCount(undefined), 0);
eq("count empty", archiveSubjectCount(resp({})), 0);

/* 5 — subtitle (byte-pinned voice) */
eq(
  "subtitle live",
  archiveSubtitle(LIVE),
  "2 subjects across 32 days before the term rollover · peaked at 86.40%"
);
eq(
  "subtitle singular grammar",
  archiveSubtitle(resp({
    subjects: { X: [{ t: "2026-09-01T00:00:00.000Z", percentage: 50, present: 1, total: 2 }] },
  })),
  "1 subject across 1 day before the term rollover"
);
eq("subtitle null on empty", archiveSubtitle(resp({})), null);
eq("subtitle null on undefined", archiveSubtitle(undefined), null);

/* 6 — THE HONESTY CONTRACT: the module is a read-only reader */
import * as ta from "../src/lib/term-archive";
const exported = Object.keys(ta);
eqObj6: {
  check(
    "exports are exactly the five readers",
    exported.length === 5 &&
      ["archiveAvailable", "archiveSpan", "archivePeak", "archiveSubjectCount", "archiveSubtitle"].every((k) =>
        exported.includes(k)
      ),
    `got ${JSON.stringify(exported)}`
  );
}
check(
  "no projection/recovery/status vocabulary on the module surface",
  !exported.some((k) => /project|recover|status|whatif|pace|eta/i.test(k)),
  `got ${JSON.stringify(exported)}`
);
check(
  "readers never mutate their payload (span unchanged after reads)",
  (() => {
    const r: HistoryResponse = JSON.parse(JSON.stringify(LIVE));
    archiveAvailable(r); archiveSpan(r); archivePeak(r); archiveSubjectCount(r); archiveSubtitle(r);
    return JSON.stringify(r) === JSON.stringify(LIVE);
  })(),
  "payload mutated"
);

console.log(`\nterm-archive r114: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
