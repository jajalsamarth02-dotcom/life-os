/**
 * The reminder-housekeeping rulebook — ONE pure module that decides which
 * reminders are housekeeping candidates and which ERP rows are likely the
 * same assignment wearing two ids.
 *
 * Round 107 origin ("the graveyard at the top of the list"): after three
 * months of live syncing the Reminders tab had 45 ACTIVE rows, 18 of them
 * overdue since July/August — and the ERP itself had re-issued several
 * assignments under fresh ids (a teacher edits "Mini Project" and the ERP
 * mints `erp:assign:479755` next to the original `erp:assign:406875`), so
 * the same deadline appeared twice. Every surface downstream inherited the
 * noise: the timeline's overdue group opened on a wall of red ghosts, the
 * .ics export and the WhatsApp digest counted them as pending work
 * (lastPendingCount 41), and clearing the pile meant 18 individual taps.
 *
 * What the module provides (all pure — no db, no clock reads; `nowMs` is a
 * parameter so tests can pin every boundary):
 *
 *  - normalizeTitle      — title fingerprint for duplicate grouping
 *                          (lowercase, punctuation stripped, whitespace
 *                          collapsed) so "ALA -1" and "ala 1" collide;
 *  - numericErpId        — `erp:assign:479686` → 479686 (null when the id
 *                          is not a numbered ERP row);
 *  - findDuplicateGroups — same fingerprint + same subject + dueAt within
 *                          DUPLICATE_DUE_WINDOW_MS → one group with a
 *                          deterministic "keep" pick and "ghost" rest;
 *  - buildHousekeepingPlan — the full cleanup picture: stale overdue
 *                          (STALE_OVERDUE_MS past due), recent overdue,
 *                          and duplicate groups, warnings always excluded;
 *  - nextAssignmentStatus — the sync-engine guard as a pure function: a
 *                          DISMISSED reminder stays DISMISSED until the ERP
 *                          itself reports the work completed. The student's
 *                          dismissal is student-owned state; a quiet
 *                          metadata refresh on the ERP must not resurrect
 *                          a ghost the student explicitly swept away.
 *
 * Deliberate boundaries:
 *  - ATTENDANCE_WARNING rows are NEVER housekeeping candidates: they are
 *    auto-managed (created/updated/deleted by the attendance sync) and each
 *    describes live risk, not dead homework.
 *  - ERP rows cannot be deleted by the bulk path — the next sync would
 *    recreate any row still present on the ERP page. DISMISS is the honest
 *    sweep: the upsert respects it (via nextAssignmentStatus) while the
 *    row's metadata is stable.
 *  - Only ERP rows group as duplicates (ghosts are a sync artifact); a
 *    personal reminder is never grouped, and different sources never mix.
 */

/** Overdue longer than this counts as "stale" — the graveyard, not "oops, yesterday". */
export const STALE_OVERDUE_MS = 14 * 86_400_000;

/** Two ERP rows whose due dates sit within this window can be the same
 *  assignment re-issued (the ERP moves "last date" by a day when editing). */
export const DUPLICATE_DUE_WINDOW_MS = 3 * 86_400_000;

/** Minimal cleanup shape this module needs — a superset of db Reminder and
 *  the client Reminder type, so the same rulebook runs on both sides. */
export interface HygieneReminder {
  id: string;
  source: string; // ERP | PERSONAL
  externalId: string | null;
  type: string;
  title: string;
  subjectCode: string | null;
  dueAt: string | Date;
  status: string; // ACTIVE | DONE | DISMISSED
}

export interface DuplicateGroup<T extends HygieneReminder> {
  /** The row to keep — the safest deadline, tie-broken to the newest ERP id. */
  keep: T;
  /** Same-assignment rows the student probably does not need twice. */
  ghosts: T[];
  /** Shared fingerprint (normalized title + subject) — for tests/debug. */
  key: string;
}

export interface HousekeepingPlan<T extends HygieneReminder> {
  /** ACTIVE + overdue by more than STALE_OVERDUE_MS (never warnings). */
  staleOverdue: T[];
  /** ACTIVE + overdue within STALE_OVERDUE_MS — recent misses, still fresh. */
  recentOverdue: T[];
  /** Likely same-assignment pairs/triples among ACTIVE ERP rows. */
  duplicateGroups: DuplicateGroup<T>[];
}

/** Lowercase, strip punctuation, collapse whitespace — "ALA -1" ≡ "ala 1". */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** `erp:assign:479686` → 479686; null for non-numeric or foreign ids. */
export function numericErpId(externalId: string | null): number | null {
  if (!externalId) return null;
  const m = /^erp:[a-z]+:(\d+)$/.exec(externalId);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

const WARN_TYPE = "ATTENDANCE_WARNING";
const dueMs = (r: HygieneReminder): number => new Date(r.dueAt).getTime();

/**
 * Group ACTIVE ERP rows that look like the same assignment re-issued under a
 * new id: same normalized title, same subject (null ≡ null), due dates within
 * DUPLICATE_DUE_WINDOW_MS of each other. The keep pick is deterministic:
 * latest dueAt first (the safer deadline to track), tie-broken by the higher
 * numeric ERP id (the newest row the ERP minted). Groups sort by earliest
 * due, then key — stable across reloads so the dialog never shuffles.
 */
export function findDuplicateGroups<T extends HygieneReminder>(
  reminders: readonly T[],
): DuplicateGroup<T>[] {
  const candidates = reminders.filter(
    (r) => r.status === "ACTIVE" && r.source === "ERP" && r.type !== WARN_TYPE,
  );

  // Bucket by fingerprint first (title + subject), then cluster each bucket
  // by due-date proximity via sorted sliding windows.
  const buckets = new Map<string, T[]>();
  for (const r of candidates) {
    const key = `${normalizeTitle(r.title)}|${r.subjectCode ?? ""}`;
    const list = buckets.get(key);
    if (list) list.push(r);
    else buckets.set(key, [r]);
  }

  const groups: DuplicateGroup<T>[] = [];
  for (const [key, list] of buckets) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => dueMs(a) - dueMs(b) || a.id.localeCompare(b.id));
    let cluster: T[] = [sorted[0]];
    const flush = () => {
      if (cluster.length >= 2) groups.push(pickKeep(cluster, key));
      cluster = [];
    };
    for (let i = 1; i < sorted.length; i++) {
      if (dueMs(sorted[i]) - dueMs(cluster[cluster.length - 1]) <= DUPLICATE_DUE_WINDOW_MS) {
        cluster.push(sorted[i]);
      } else {
        flush();
        cluster = [sorted[i]];
      }
    }
    flush();
  }

  return groups.sort((a, b) => {
    const ad = Math.min(...a.ghosts.concat(a.keep).map(dueMs));
    const bd = Math.min(...b.ghosts.concat(b.keep).map(dueMs));
    return ad - bd || a.key.localeCompare(b.key);
  });
}

function pickKeep<T extends HygieneReminder>(cluster: T[], key: string): DuplicateGroup<T> {
  const ranked = [...cluster].sort((a, b) => {
    const byDue = dueMs(b) - dueMs(a); // latest deadline first — safer to track
    if (byDue !== 0) return byDue;
    const ia = numericErpId(a.externalId) ?? -1;
    const ib = numericErpId(b.externalId) ?? -1;
    if (ia !== ib) return ib - ia; // newest ERP row wins the tie
    return a.id.localeCompare(b.id); // last resort: stable
  });
  return { keep: ranked[0], ghosts: ranked.slice(1), key };
}

/**
 * The full cleanup picture. Overdue = ACTIVE and due in the past; stale =
 * overdue by more than STALE_OVERDUE_MS. Warnings are excluded everywhere.
 * Duplicates are detected among ALL active ERP rows (not just overdue ones —
 * a re-issued id can carry a future deadline too).
 */
export function buildHousekeepingPlan<T extends HygieneReminder>(
  reminders: readonly T[],
  nowMs: number,
): HousekeepingPlan<T> {
  const staleOverdue: T[] = [];
  const recentOverdue: T[] = [];
  for (const r of reminders) {
    if (r.status !== "ACTIVE" || r.type === WARN_TYPE) continue;
    const over = nowMs - dueMs(r);
    if (over <= 0) continue;
    (over >= STALE_OVERDUE_MS ? staleOverdue : recentOverdue).push(r);
  }
  const sortOver = (a: T, b: T) => dueMs(a) - dueMs(b) || a.id.localeCompare(b.id);
  staleOverdue.sort(sortOver);
  recentOverdue.sort(sortOver);
  return {
    staleOverdue,
    recentOverdue,
    duplicateGroups: findDuplicateGroups(reminders),
  };
}

/**
 * The sync-engine guard as a pure decision (tested, not inline): what status
 * should an ERP assignment row carry after this sync pass?
 *  - the ERP's own submission state is the mirror (completed → DONE);
 *  - a DISMISSED row stays DISMISSED until the ERP reports completion —
 *    "back to Pending" on the ERP must not resurrect a swept ghost.
 */
export function nextAssignmentStatus(existingStatus: string, completed: boolean): string {
  if (completed) return "DONE";
  if (existingStatus === "DISMISSED") return "DISMISSED";
  return "ACTIVE";
}

/* ---------------------------------------------------------------------- */
/* r108 — the dashboard nudge ("the noise ledger")                         */
/* ---------------------------------------------------------------------- */

/**
 * Round 108 origin: a day after the one-pass sweep shipped, the student had
 * still not touched it — the affordance lived only on the Reminders tab,
 * but the Dashboard is where the student actually lands. The nudge needed
 * honest numbers (not "clean up your reminders!") computed by the SAME
 * rulebook as the sweep dialog, plus a polite dismissal that cannot hide a
 * CHANGED situation: sweeping a ghost or missing a fresh deadline must
 * re-arm the nudge even inside its 24h quiet window.
 *
 * `buildHousekeepingNudgeSummary` turns a plan into the three numbers the
 * nudge shows (stale / ghosts / recent), the oldest stale due date (the
 * "overdue since Jul 16" line — the visceral hook), and a `signature` that
 * flips the moment any of those numbers change.
 *
 * COUNTING BOUNDARY (r108, discovered against the live wall): a duplicate
 * ghost is usually ALSO stale — it is the same old row seen through two
 * lenses. The stale/recent counts here EXCLUDE ghost ids so the arithmetic
 * adds up everywhere exactly once: the nudge chips ("11 stale · 3 ghosts"),
 * the dialog sections (11 stale rows + 3 ghost rows), the pre-checked
 * selection (14 ids) and the sweep toast ("14 swept") all describe the same
 * 14 unique noise rows. The ghost COUNT stays the lens count (3). Only the
 * oldest-stale hook looks through BOTH lenses — it is about the wall's age,
 * not the ledger, and the keep row carries the same assignment anyway.
 *
 * `nudgeDismissalActive` is the whole dismissal policy in one pure call:
 *  - no stored dismissal          → show (false);
 *  - same signature, < TTL        → quiet (true);
 *  - same signature, ≥ TTL        → show again (false) — daily nag is honest;
 *  - different signature          → show immediately (false) — the situation
 *    changed, the old "later" promise no longer describes it;
 *  - corrupt storage              → show (false) — fail open toward honesty.
 */

/** How long a dismissal keeps the nudge quiet — one day, then it asks again. */
export const NUDGE_DISMISS_TTL_MS = 24 * 86_400_000;

export interface HousekeepingNudgeSummary {
  /** ACTIVE overdue rows past the stale threshold (warnings never counted). */
  staleCount: number;
  /** Duplicate ghosts across all groups — the "keep" rows are NOT noise. */
  ghostCount: number;
  /** Overdue rows still inside the fresh window ("oops, yesterday"). */
  recentCount: number;
  /** All non-warning ACTIVE overdue (stale + recent) — the wall's size. */
  totalOverdueCount: number;
  /** Oldest stale dueAt in ms, null when nothing is stale — powers the
   *  "overdue since …" line. Recent-only walls do not get this hook. */
  oldestStaleDueMs: number | null;
  /** `${stale}:${ghosts}:${recent}` — changes the moment the noise does. */
  signature: string;
}

export function buildHousekeepingNudgeSummary<T extends HygieneReminder>(
  plan: HousekeepingPlan<T>,
): HousekeepingNudgeSummary {
  const ghostIds = new Set(
    plan.duplicateGroups.flatMap((g) => g.ghosts.map((x) => x.id)),
  );
  const ghostCount = plan.duplicateGroups.reduce((n, g) => n + g.ghosts.length, 0);
  const staleOverdue = plan.staleOverdue.filter((r) => !ghostIds.has(r.id));
  const recentOverdue = plan.recentOverdue.filter((r) => !ghostIds.has(r.id));
  const oldestStale = plan.staleOverdue.reduce<number | null>((min, r) => {
    const ms = new Date(r.dueAt).getTime();
    return min === null || ms < min ? ms : min;
  }, null);
  return {
    staleCount: staleOverdue.length,
    ghostCount,
    recentCount: recentOverdue.length,
    totalOverdueCount: staleOverdue.length + ghostCount + recentOverdue.length,
    oldestStaleDueMs: oldestStale,
    signature: `${staleOverdue.length}:${ghostCount}:${recentOverdue.length}`,
  };
}

/** What localStorage stores when the student presses "Later today". */
export interface StoredNudgeDismissal {
  signature: string;
  at: number;
}

export function nudgeDismissalActive(
  stored: string | null,
  signature: string,
  nowMs: number,
): boolean {
  if (!stored) return false;
  try {
    const parsed = JSON.parse(stored) as Partial<StoredNudgeDismissal>;
    if (typeof parsed !== "object" || parsed === null) return false;
    if (parsed.signature !== signature) return false;
    if (typeof parsed.at !== "number" || !Number.isFinite(parsed.at)) return false;
    return nowMs - parsed.at < NUDGE_DISMISS_TTL_MS;
  } catch {
    return false;
  }
}
