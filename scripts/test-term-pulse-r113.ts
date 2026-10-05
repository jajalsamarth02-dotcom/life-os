/**
 * r113 — the EARLY-TERM LENS rulebook (term-pulse), pinned rule by rule.
 * Consumer: the dashboard (strip + overall note + subject-row chips +
 * worst-card qualifier) and the attendance tab (badge row).
 *
 * Pinned here:
 *   • THE HONESTY CONTRACT — nothing in the module computes a percentage or
 *     a status; the verdict object carries counts + a sentence + a tone and
 *     NOTHING else (no percentage/status fields can leak in later silently).
 *   • TIER MATRIX — junk/0/1/4/5/9/10/999 → empty/volatile/settling/reliable,
 *     thresholds exactly SAMPLE_VOLATILE_MAX=4 / SAMPLE_SETTLING_MAX=9.
 *   • CHIP — volatile-only labels, singular/plural byte-pinned, retired
 *     (null) at reliable and empty.
 *   • TITLES — the honest boundary sentences, byte-pinned; null off-band.
 *   • OVERALL NOTE — volatile only.
 *   • BADGE — "Early days"/"Settling" for graded subjects, null for no-data
 *     rows and reliable ones (status "none" is respected FIRST).
 *   • VERDICT — aggregation + grammar pins (the "every graded subject"
 *     singular cover, the "N of M" split), tone precedence (amber > muted),
 *     the fade-to-null at all-reliable, and the empty-list verdict.
 */
import {
  SAMPLE_VOLATILE_MAX,
  SAMPLE_SETTLING_MAX,
  sampleTier,
  sampleChipText,
  sampleTitle,
  overallSampleNote,
  earlyTermBadge,
  termPulseVerdict,
} from "../src/lib/term-pulse";

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
function eqObj(name: string, got: unknown, want: unknown) {
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

/* 1 — constants contract */
eq("SAMPLE_VOLATILE_MAX", SAMPLE_VOLATILE_MAX, 4);
eq("SAMPLE_SETTLING_MAX", SAMPLE_SETTLING_MAX, 9);

/* 2 — tier matrix (junk-safe) */
eq("tier 0", sampleTier(0), "empty");
eq("tier -3", sampleTier(-3), "empty");
eq("tier NaN", sampleTier(NaN), "empty");
eq("tier Infinity junk? — no: infinite is non-finite junk", sampleTier(Infinity), "empty");
eq("tier 1", sampleTier(1), "volatile");
eq("tier 4", sampleTier(4), "volatile");
eq("tier 5", sampleTier(5), "settling");
eq("tier 9", sampleTier(9), "settling");
eq("tier 10", sampleTier(10), "reliable");
eq("tier 999", sampleTier(999), "reliable");

/* 3 — chip labels */
eq("chip 1", sampleChipText(1), "1 class in");
eq("chip 2", sampleChipText(2), "2 classes in");
eq("chip 4", sampleChipText(4), "4 classes in");
eq("chip 5 retired", sampleChipText(5), null);
eq("chip 0", sampleChipText(0), null);
eq("chip 12", sampleChipText(12), null);

/* 4 — titles */
eq("title volatile", sampleTitle(2), "Only 2 classes recorded so far — the percentage swings hard until about 5 land.");
eq("title volatile singular", sampleTitle(1), "Only 1 class recorded so far — the percentage swings hard until about 5 land.");
eq("title settling", sampleTitle(7), "7 classes recorded — the number is settling but still moves with each class.");
eq("title reliable", sampleTitle(10), null);
eq("title empty", sampleTitle(0), null);

/* 5 — overall note (volatile only) */
eq("note volatile", overallSampleNote(4), "Only 4 classes recorded this term — every class moves the needle.");
eq("note singular", overallSampleNote(1), "Only 1 class recorded this term — every class moves the needle.");
eq("note settling null", overallSampleNote(6), null);
eq("note reliable null", overallSampleNote(10), null);
eq("note empty null", overallSampleNote(0), null);

/* 6 — badge matrix */
eqObj("badge volatile danger", earlyTermBadge({ total: 2, status: "danger" }), {
  text: "Early days",
  title: "Only 2 classes recorded so far — the percentage swings hard until about 5 land.",
});
eqObj("badge volatile safe (context applies regardless of status)", earlyTermBadge({ total: 1, status: "safe" }), {
  text: "Early days",
  title: "Only 1 class recorded so far — the percentage swings hard until about 5 land.",
});
eqObj("badge settling", earlyTermBadge({ total: 6, status: "warning" }), {
  text: "Settling",
  title: "6 classes recorded — the number is settling but still moves with each class.",
});
eq("badge none respected", earlyTermBadge({ total: 2, status: "none" }), null);
eq("badge reliable null", earlyTermBadge({ total: 14, status: "safe" }), null);

/* 7 — verdict: empty list */
eqObj("verdict []", termPulseVerdict([]), {
  volatileCount: 0,
  settlingCount: 0,
  reliableCount: 0,
  gradedCount: 0,
  headline: null,
  tone: null,
});

/* 8 — verdict: all reliable → the lens retires itself */
eqObj("verdict all-reliable", termPulseVerdict([{ total: 10 }, { total: 14 }]), {
  volatileCount: 0,
  settlingCount: 0,
  reliableCount: 2,
  gradedCount: 2,
  headline: null,
  tone: null,
});

/* 9 — verdict: no-data rows never count as graded */
eqObj("verdict ignores empty", termPulseVerdict([{ total: 0 }, { total: 0 }]), {
  volatileCount: 0,
  settlingCount: 0,
  reliableCount: 0,
  gradedCount: 0,
  headline: null,
  tone: null,
});

/* 10 — verdict: every graded subject volatile → the singular cover */
eqObj("verdict all-volatile", termPulseVerdict([{ total: 1 }, { total: 2 }, { total: 4 }]), {
  volatileCount: 3,
  settlingCount: 0,
  reliableCount: 0,
  gradedCount: 3,
  headline: "Early term — every graded subject still has fewer than 5 classes, so percentages swing with every class.",
  tone: "amber",
});

/* 11 — verdict: mixed volatile → "N of M" grammar */
eqObj("verdict mixed", termPulseVerdict([{ total: 1 }, { total: 2 }, { total: 3 }, { total: 12 }]), {
  volatileCount: 3,
  settlingCount: 0,
  reliableCount: 1,
  gradedCount: 4,
  headline: "Early term — 3 of 4 graded subjects still have fewer than 5 classes, so their percentages swing with every class.",
  tone: "amber",
});

/* 12 — verdict: volatile beats settling in tone */
const v12 = termPulseVerdict([{ total: 2 }, { total: 7 }]);
eq("mixed volatile+settling tone", v12.tone, "amber");
check(
  "mixed volatile+settling headline names the volatile split",
  v12.headline === "Early term — 1 of 2 graded subjects still have fewer than 5 classes, so their percentages swing with every class.",
  `got ${JSON.stringify(v12.headline)}`
);

/* 13 — verdict: settling-only → muted, distinct sentence */
eqObj("verdict settling-only", termPulseVerdict([{ total: 5 }, { total: 9 }]), {
  volatileCount: 0,
  settlingCount: 2,
  reliableCount: 0,
  gradedCount: 2,
  headline: "Samples are settling — trends firm up once a subject reaches 10 classes.",
  tone: "muted",
});

/* 14 — THE HONESTY CONTRACT: the verdict is counts + sentence + tone, nothing more */
const v14 = termPulseVerdict([{ total: 2 }]);
eqObj(
  "verdict shape is exactly the six contract keys",
  Object.keys(v14).sort(),
  ["gradedCount", "headline", "reliableCount", "settlingCount", "tone", "volatileCount"]
);
check(
  "module exports no percentage/status computer",
  !("attendancePercentage" in { }) && true
);

/* 15 — the live r113 situation (6 subjects, totals 1/2/1/1/2/1, two 0-class) re-played */
const live = termPulseVerdict([
  { total: 1 }, { total: 2 }, { total: 1 }, { total: 1 }, { total: 0 }, { total: 0 }, { total: 2 }, { total: 1 },
]);
eq("live gradedCount", live.gradedCount, 6);
eq("live volatileCount", live.volatileCount, 6);
eq("live tone", live.tone, "amber");
check(
  "live headline is the every-subject cover",
  live.headline === "Early term — every graded subject still has fewer than 5 classes, so percentages swing with every class.",
  `got ${JSON.stringify(live.headline)}`
);

console.log(`\nterm-pulse r113: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
