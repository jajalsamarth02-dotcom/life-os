/**
 * r113 — the EARLY-TERM LENS rulebook (term-pulse).
 *
 * The ERP term rolled over and every subject restarted from a handful of
 * classes. The dashboard's honest math suddenly reads as alarm: a subject
 * at 1/2 (50%) paints DANGER, the overall ring sits at 50%, and three of
 * six subjects flash "at risk" — on samples too small to mean much yet.
 * The numbers must stay (they are the ERP's truth and the recovery math
 * is still exact); what they lack is SAMPLE-SIZE CONTEXT. This module is
 * that context, as pure functions, so no surface re-invents a threshold.
 *
 * THE HONESTY CONTRACT (pinned by tests):
 *   • Context, never replacement — nothing here computes a percentage or a
 *     status. The danger chip, the recovery math (classesToReachTarget /
 *     classesCanSkip) and the ERP's raw numbers are untouched; the lens
 *     only ADDS "the sample is small" sentences beside them.
 *   • Tier thresholds are constants: ≤4 classes = "volatile" (the percent
 *     swings with every class), 5–9 = "settling", ≥10 = "reliable".
 *   • Empty is empty — 0 classes (or junk input) has no percentage at all
 *     and never gets an early-term sentence of its own.
 *   • The verdict FADES: once every graded subject reaches 10 classes the
 *     headline is null and every surface goes quiet — the lens retires
 *     itself instead of nagging for the rest of the term.
 */

/** 1–4 recorded classes: the percentage swings hard with every class. */
export const SAMPLE_VOLATILE_MAX = 4;

/** 5–9 recorded classes: settling — still moves, but less wildly. */
export const SAMPLE_SETTLING_MAX = 9;

export type SampleTier = "empty" | "volatile" | "settling" | "reliable";

/** Junk-safe tier for a recorded-class count. */
export function sampleTier(total: number): SampleTier {
  if (!Number.isFinite(total) || total <= 0) return "empty";
  if (total <= SAMPLE_VOLATILE_MAX) return "volatile";
  if (total <= SAMPLE_SETTLING_MAX) return "settling";
  return "reliable";
}

function classWord(n: number): string {
  return n === 1 ? "class" : "classes";
}

/**
 * Chip label for a subject row — "2 classes in" / "1 class in".
 * Null for empty (no chip on a no-data row) and reliable (the sample has
 * grown up; the chip retires).
 */
export function sampleChipText(total: number): string | null {
  const tier = sampleTier(total);
  if (tier === "volatile") return `${total} ${classWord(total)} in`;
  return null;
}

/**
 * Full-sentence tooltip for the sample chip / qualifier lines. Honest about
 * the boundary: "until about 5 land" volatile, "still moves with each class"
 * settling. Null for empty and reliable.
 */
export function sampleTitle(total: number): string | null {
  const tier = sampleTier(total);
  if (tier === "volatile")
    return `Only ${total} ${classWord(total)} recorded so far — the percentage swings hard until about 5 land.`;
  if (tier === "settling")
    return `${total} ${classWord(total)} recorded — the number is settling but still moves with each class.`;
  return null;
}

/**
 * Note under the overall attendance ring. Volatile only — the settling band
 * is per-subject nuance, not worth the overall card's space. Null otherwise.
 */
export function overallSampleNote(total: number): string | null {
  if (sampleTier(total) === "volatile")
    return `Only ${total} ${classWord(total)} recorded this term — every class moves the needle.`;
  return null;
}

export interface EarlyTermBadge {
  text: "Early days" | "Settling";
  title: string;
}

/**
 * Badge for the attendance tab's per-subject chip row. Any graded subject
 * below the reliable bar gets context ("Early days" / "Settling"); no-data
 * rows get nothing (there is no percentage to qualify).
 */
export function earlyTermBadge(s: { total: number; status: string }): EarlyTermBadge | null {
  if (s.status === "none") return null;
  const tier = sampleTier(s.total);
  if (tier === "volatile") return { text: "Early days", title: sampleTitle(s.total) as string };
  if (tier === "settling") return { text: "Settling", title: sampleTitle(s.total) as string };
  return null;
}

export type TermPulseTone = "amber" | "muted";

export interface TermPulseVerdict {
  /** Graded subjects (total > 0) still in the volatile band. */
  volatileCount: number;
  /** Graded subjects in the settling band. */
  settlingCount: number;
  /** Graded subjects at ≥10 classes. */
  reliableCount: number;
  /** Subjects with at least one recorded class. */
  gradedCount: number;
  /** Dashboard strip sentence — null once every sample is reliable. */
  headline: string | null;
  tone: TermPulseTone | null;
}

/**
 * Aggregate verdict for a dashboard of subject views. Volatile presence
 * wins the tone (amber), settling-only is muted, all-reliable is null and
 * the strip renders nothing. Grammar is pinned: "every graded subject"
 * when the volatile band covers all of them, counts otherwise.
 */
export function termPulseVerdict(views: { total: number }[]): TermPulseVerdict {
  let volatileCount = 0;
  let settlingCount = 0;
  let reliableCount = 0;
  for (const v of views) {
    const tier = sampleTier(v.total);
    if (tier === "volatile") volatileCount++;
    else if (tier === "settling") settlingCount++;
    else if (tier === "reliable") reliableCount++;
  }
  const gradedCount = volatileCount + settlingCount + reliableCount;

  let headline: string | null = null;
  let tone: TermPulseTone | null = null;
  if (gradedCount > 0 && volatileCount > 0) {
    headline =
      volatileCount === gradedCount
        ? "Early term — every graded subject still has fewer than 5 classes, so percentages swing with every class."
        : `Early term — ${volatileCount} of ${gradedCount} graded subjects still have fewer than 5 classes, so their percentages swing with every class.`;
    tone = "amber";
  } else if (gradedCount > 0 && settlingCount > 0) {
    headline = "Samples are settling — trends firm up once a subject reaches 10 classes.";
    tone = "muted";
  }

  return { volatileCount, settlingCount, reliableCount, gradedCount, headline, tone };
}
