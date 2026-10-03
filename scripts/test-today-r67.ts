/**
 * Round 67 — timetable row → subject-drawer deep-link gate.
 *
 * knownSubjectCode decides whether a timetable row's subject code becomes a
 * violet "open subject details" button (the drawer's key) or stays plain
 * text. The gate is exact-match against the synced attendance subjects:
 * routine codes with no attendance data must NOT render as dead-end
 * buttons, and case/whitespace drift must stay visible (a silent fold
 * would mask a parse regression). This file pins that contract.
 *
 * Run: bun scripts/test-today-r67.ts
 */
import { knownSubjectCode } from "../src/components/erp/timetable-card";
import { istNow } from "../src/components/erp/shared";
import type { SubjectView } from "../src/components/erp/types";

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

function subj(code: string): SubjectView {
  return {
    id: `id-${code}`,
    code,
    name: `Subject ${code}`,
    semester: 5,
    updatedAt: new Date().toISOString(),
    targetPct: 75,
    hasCustomTarget: false,
    status: "warning",
    percentage: 66.67,
    present: 2,
    total: 3,
    canSkip: 0,
    classesToTarget: 1,
  } as SubjectView;
}

const subjects = [subj("RWM"), subj("CN"), subj("SE")]

// 1. Known code → canonical code (drawer key), today's real case.
check("RWM (today's 11:00 class) arms the deep-link → 'RWM'", knownSubjectCode("RWM", subjects) === "RWM");

// 2. Unknown code → null → plain text, never a dead-end drawer.
check("unknown code 'XYZ' → null (plain text row)", knownSubjectCode("XYZ", subjects) === null);

// 3. Empty subject list (fresh install / sync pending) → everything stays plain text.
check("empty subjects → null even for 'RWM'", knownSubjectCode("RWM", []) === null);

// 4. Case drift stays VISIBLE: 'rwm' must not silently match 'RWM' — if the
//    parser ever starts emitting lowercase codes, the button disappearing is
//    the honest signal (and this test catches it immediately).
check("case drift 'rwm' → null (exact-match contract)", knownSubjectCode("rwm", subjects) === null);

// 5. Whitespace drift likewise unmatched: a padded code means parse drift,
//    not a subject to open.
check("padded ' RWM' → null", knownSubjectCode(" RWM", subjects) === null);
check("padded 'RWM ' → null", knownSubjectCode("RWM ", subjects) === null);

// 6. Canonical return: the drawer key is the SUBJECT's own code string, so
//    dashboard's find(s.code === key) is guaranteed to hit.
const canon = knownSubjectCode("CN", subjects);
check("returns the subject's own code (drawer key)", canon !== null && subjects.some((s) => s.code === canon));

// 8. HEADER regression (found live in QA this round): the header's
//    NextClassChip still used the DEVICE clock — a UTC browser at 02:50 read
//    the student's 11:00 IST class as "in 490 min" (11:00 − 02:50). With
//    istNow the same instant is 08:20 IST → 660 − 500 = 160 min. istNow is
//    the shared helper the chip now derives from; this pins the arithmetic
//    of the exact moment the bug was caught.
const utcInstant = Date.UTC(2026, 9, 3, 2, 50, 0); // Sat 03 Oct 2026, 02:50 UTC = 08:20 IST
const ist = istNow(utcInstant);
check("02:50 UTC = 08:20 IST (day=Saturday)", ist.day === 6 && ist.min === 500);
check("11:00 IST class → 160 min away, NOT 490 (header chip bug)", 660 - ist.min === 160);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
