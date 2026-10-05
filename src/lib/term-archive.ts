/**
 * r114 — the ARCHIVE SHELF rulebook (term-archive).
 *
 * The ERP's term rollover (Oct 2) removed last term's subjects — the rows
 * survive with active=false and their snapshots stay within the 90-day
 * retention window — but every active-scoped surface went blind to them.
 * The archive shelf surfaces that history, read-only, one toggle away.
 *
 * THE HONESTY CONTRACT (pinned by tests):
 *   • The archive is a RECORD, not a tool — every helper here is a read-only
 *     reader of a HistoryResponse. Nothing computes projections, recovery
 *     math, or statuses; the forward-looking surfaces stay bound to CURRENT
 *     data and never consume an archive payload.
 *   • "Available" means real data: at least one subject series with at
     least one point. An empty payload renders no toggle — an archive
 *     button that opens an empty drawer is a lie.
 *   • The span is measured in whole days between the first and last
 *     archive point (inclusive), so the subtitle can say what the record
 *     covers without implying the ERP held classes on every one of them.
 *   • The peak is the max overall percentage ACTUALLY RECORDED — never an
 *     interpolation or a "best possible".
 */

import type { HistoryResponse } from "@/components/erp/types";

/** All archive subject points, flattened and left in arrival order. */
function archivePoints(resp: HistoryResponse): { t: string }[] {
  return Object.values(resp.subjects).flat();
}

/** True when the payload carries at least one archived subject point. */
export function archiveAvailable(resp: HistoryResponse | undefined | null): boolean {
  if (!resp) return false;
  return archivePoints(resp).length > 0;
}

export interface ArchiveSpan {
  from: string;
  to: string;
  /** Whole days covered by the record, inclusive of both ends. */
  days: number;
}

/** First→last span of the archived record (null without real data). */
export function archiveSpan(resp: HistoryResponse | undefined | null): ArchiveSpan | null {
  if (!resp) return null;
  const times = archivePoints(resp)
    .map((p) => p.t)
    .sort();
  if (times.length === 0) return null;
  const from = new Date(times[0]);
  const to = new Date(times[times.length - 1]);
  const days = Math.max(1, Math.round((+to - +from) / 86_400_000) + 1);
  return { from: times[0], to: times[times.length - 1], days };
}

/** Peak recorded overall percentage in the archive (null without data). */
export function archivePeak(resp: HistoryResponse | undefined | null): number | null {
  if (!resp || resp.overall.length === 0) return null;
  return resp.overall.reduce((best, p) => (p.percentage > best ? p.percentage : best), -Infinity);
}

/** Number of archived subjects with at least one point. */
export function archiveSubjectCount(resp: HistoryResponse | undefined | null): number {
  if (!resp) return 0;
  return Object.values(resp.subjects).filter((series) => series.length > 0).length;
}

/**
 * Subtitle for the archive surface — one honest sentence naming the span,
 * the peak and the subject count. Byte-pinned shape so voice drift is
 * caught. Null when the payload is empty (the toggle must not exist).
 */
export function archiveSubtitle(resp: HistoryResponse | undefined | null): string | null {
  const span = archiveSpan(resp);
  if (!span) return null;
  const peak = archivePeak(resp);
  const count = archiveSubjectCount(resp);
  const peakPart = peak == null ? "" : ` · peaked at ${peak.toFixed(2)}%`;
  const subjectPart = `${count} ${count === 1 ? "subject" : "subjects"}`;
  return `${subjectPart} across ${span.days} day${span.days === 1 ? "" : "s"} before the term rollover${peakPart}`;
}
