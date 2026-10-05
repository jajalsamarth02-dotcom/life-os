/**
 * r115 — The ALA bridge.
 *
 * The ERP's Assignments (ALA) page keys its courses by internal ids
 * (`BETCE15xxx`) that are NOT subject-table codes. `erp.courseNames` maps
 * those ids to course names, and the current-term attendance registry is a
 * separate world again. The Oct 2 rollover made the gap visible: every live
 * ALA row links to a course id that exists nowhere in the subject registry,
 * while 6 of the 7 course names exactly match live semester-5 subjects.
 *
 * This module is the honest bridge between the two namespaces:
 *   - EXACT (normalized) name match ONLY — never substring, fuzzy, or
 *     initial-based guessing. A course either IS a live subject by name or
 *     it is not.
 *   - Three honest states: "live" (matched a current attendance subject),
 *     "orphan" (known course name, no live subject — the course is not part
 *     of this term's attendance), "unlabeled" (the ERP gave no course name,
 *     so no judgement is possible).
 *   - Readers only: nothing here mutates a payload, writes a link, or
 *     reclassifies an ALA row. The bridge is derived fresh on every render
 *     so the ERP can re-issue names and the wall self-heals.
 *
 * HONESTY CONTRACT: no function here may invent an association. When the
 * match is missing the answer is "orphan"/"unlabeled", never a best guess.
 */

export interface BridgeSubject {
  code: string;
  name: string;
}

export type AlaBridgeKind = "live" | "orphan" | "unlabeled";

export interface AlaBridge {
  kind: AlaBridgeKind;
  /** The matched live subject — present ONLY when kind === "live". */
  subject: BridgeSubject | null;
}

/**
 * Normalize a course/subject name for exact comparison:
 * uppercase, trim, collapse internal whitespace, and unify the ampersand
 * ("&") to the word "AND" so "RESPONSIVE WEB & MOBILE UI DESIGN" and any
 * ERP re-issue with the spelled-out form compare equal.
 * Junk-safe: null/undefined/blank → null.
 */
export function normalizeCourseName(name: string | null | undefined): string | null {
  if (typeof name !== "string") return null;
  const collapsed = name
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/\s+/g, " ")
    .trim();
  return collapsed.length > 0 ? collapsed : null;
}

/**
 * Exact (normalized) name match of a course against the live subject
 * registry. Returns the matched subject or null. The first registry hit in
 * registry order wins; duplicates by name are an ERP pathology, not a
 * reason to guess.
 */
export function bridgeMatch(
  courseName: string | null | undefined,
  subjects: BridgeSubject[]
): BridgeSubject | null {
  const norm = normalizeCourseName(courseName);
  if (!norm) return null;
  for (const s of subjects) {
    if (normalizeCourseName(s.name) === norm) return s;
  }
  return null;
}

/**
 * The bridge verdict for one ALA course group.
 * - unlabeled: no course name (the ERP hasn't said which course this is).
 * - live: the course name exactly matches a live attendance subject.
 * - orphan: a known name with no live match — NOT this term's attendance.
 */
export function alaBridge(
  courseName: string | null | undefined,
  subjects: BridgeSubject[]
): AlaBridge {
  const match = bridgeMatch(courseName, subjects);
  if (match) return { kind: "live", subject: match };
  const hasName = normalizeCourseName(courseName) != null;
  return hasName ? { kind: "orphan", subject: null } : { kind: "unlabeled", subject: null };
}

/** Aggregate bridge verdicts for the wall's summary line. */
export function alaBridgeCounts(bridges: AlaBridge[]): {
  live: number;
  orphan: number;
  unlabeled: number;
  total: number;
} {
  let live = 0;
  let orphan = 0;
  let unlabeled = 0;
  for (const b of bridges) {
    if (b.kind === "live") live++;
    else if (b.kind === "orphan") orphan++;
    else unlabeled++;
  }
  return { live, orphan, unlabeled, total: bridges.length };
}

/** Short chip label for a group header. Pinned copy. */
export function bridgeChipText(bridge: AlaBridge): string {
  if (bridge.kind === "live" && bridge.subject) return bridge.subject.code;
  if (bridge.kind === "orphan") return "Not in attendance";
  return "Unlabeled course";
}

/** Full tooltip sentence for a group header chip. Pinned copy. */
export function bridgeTitle(bridge: AlaBridge, courseName: string | null): string {
  if (bridge.kind === "live" && bridge.subject) {
    return `Same course as attendance subject ${bridge.subject.code} — this term's classes are counted there.`;
  }
  if (bridge.kind === "orphan") {
    return `${courseName ?? "This course"} isn't part of this term's attendance — the ERP's ALA page still lists its work.`;
  }
  return "The ERP hasn't labeled this ALA course, so it can't be linked to attendance.";
}

/** One-line wall summary. Returns null when there is nothing to say (no
 *  groups, or a single unlabeled group — a wall that can't be judged yet). */
export function bridgeSummaryLine(counts: {
  live: number;
  orphan: number;
  unlabeled: number;
  total: number;
}): string | null {
  if (counts.total === 0) return null;
  if (counts.live === 0 && counts.orphan === 0) return null;
  const parts: string[] = [`${counts.live} of ${counts.total} ALA courses match this term's attendance`];
  if (counts.orphan > 0) {
    parts.push(`${counts.orphan} not in attendance`);
  }
  return parts.join(" · ");
}
