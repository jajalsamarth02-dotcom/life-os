/**
 * Parallel-class awareness for the synced ERP class routine.
 *
 * The Class Routine page lists lab groups / batch options as SEPARATE rows
 * sharing one wall-time window: e.g. Wed 13:45 shows AI + CN + CN. Two of
 * those rows are the same CN lab running for two batches (same code, same
 * time, indistinguishable in every consumer sense — the ICS builder's
 * content-derived UIDs already collapse them into one event). The student
 * attends exactly ONE class per window; this module provides the pure math
 * that turns the raw routine into the week the student actually lives:
 *
 *   1. SAME-CODE COLLAPSE  — rows with identical day+time+code are ONE class
 *      (parallel batches of it). Always applied, pick or no pick: counting
 *      both was an overcount everywhere the plan does arithmetic.
 *   2. PARALLEL CELLS      — windows with ≥2 DISTINCT codes after collapse.
 *      Unresolved cells count every option (disclosed, never silent); a
 *      stored pick trims the cell to the chosen class.
 *
 * Picks live in Setting "timetable.batchPicks" as
 *   { "<day>-<startMin>-<endMin>": "<subjectCode>" }
 * — content-derived keys (row ids churn on every sync, Round 53 lesson), so
 * a resync that keeps the wall time keeps the pick; one that moves the class
 * silently drops it and the cell becomes unresolved again. Every function
 * here is pure so the server feed, the API and the client components run the
 * BYTE-IDENTICAL math (the calendar mirror contract depends on it).
 */

export const BATCH_PICKS_KEY = "timetable.batchPicks";

/** Minimal slot shape the pick math needs (db rows satisfy it structurally). */
export interface PickSlot {
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  subjectCode: string;
}

/** Content key for a wall-time window: "<day>-<startMin>-<endMin>". */
export function parallelCellKey(s: PickSlot): string {
  return `${s.dayOfWeek}-${s.startMin}-${s.endMin}`;
}

/** One wall-time window holding ≥2 distinct classes (lab groups / batches). */
export interface ParallelCell<T extends PickSlot = PickSlot> {
  key: string;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  /** Distinct subject codes at this window, sorted for stable UI order. */
  options: string[];
  /** One representative row per option, ordered like `options`. */
  rows: T[];
}

/**
 * Group the routine into parallel cells. Same-code duplicates are collapsed
 * first (a second batch of the same lab is NOT a second option), then any
 * window with ≥2 distinct codes becomes a cell. Ordered by day, then start.
 */
export function parallelCells<T extends PickSlot>(slots: T[]): ParallelCell<T>[] {
  // collapse same-code-same-time rows (keep first occurrence, input order)
  const seen = new Set<string>();
  const collapsed: T[] = [];
  for (const s of slots) {
    const k = `${s.dayOfWeek}-${s.startMin}-${s.endMin}-${s.subjectCode}`;
    if (seen.has(k)) continue;
    seen.add(k);
    collapsed.push(s);
  }
  // group by wall time
  const byWindow = new Map<string, T[]>();
  for (const s of collapsed) {
    const k = parallelCellKey(s);
    const list = byWindow.get(k);
    if (list) list.push(s);
    else byWindow.set(k, [s]);
  }
  // cells = windows with ≥2 distinct codes
  const cells: ParallelCell<T>[] = [];
  for (const [key, rows] of byWindow) {
    const codes = [...new Set(rows.map((r) => r.subjectCode))].sort((a, b) => a.localeCompare(b));
    if (codes.length < 2) continue;
    const repr = codes.map((c) => rows.find((r) => r.subjectCode === c));
    cells.push({
      key,
      dayOfWeek: rows[0].dayOfWeek,
      startMin: rows[0].startMin,
      endMin: rows[0].endMin,
      options: codes,
      rows: repr.filter((r): r is T => r !== undefined),
    });
  }
  cells.sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMin - b.startMin);
  return cells;
}

/** Parse the raw Setting value into a picks map (garbage → empty, never throws). */
export function parseBatchPicks(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v.length > 0 && v.length <= 120) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Drop picks that no longer match the routine — a resync that moved times,
 * merged batches or removed the picked subject must not ghost-filter the
 * plan. Unknown keys and codes not present in their cell vanish silently;
 * the cell simply becomes unresolved again (honest, never wrong).
 */
export function validatePicks<T extends PickSlot>(
  picks: Record<string, string>,
  slots: T[]
): Record<string, string> {
  const cells = new Map(parallelCells(slots).map((c) => [c.key, c]));
  const out: Record<string, string> = {};
  for (const [key, code] of Object.entries(picks)) {
    const cell = cells.get(key);
    if (cell && cell.options.includes(code)) out[key] = code;
  }
  return out;
}

export interface BatchApply<T extends PickSlot> {
  /** The student's real week: duplicates collapsed + picks applied. Input order preserved. */
  attending: T[];
  /** Cross-code alternatives hidden by a pick (disclosure count, never silent). */
  excluded: T[];
  /** Cells resolved by a pick in this run. */
  resolvedCells: ParallelCell<T>[];
  /** Cells with no (valid) pick yet — the plan counts every option for these. */
  unresolvedCells: ParallelCell<T>[];
}

/**
 * The one filter every consumer runs: the week plan's remaining counts, the
 * today card, the next-class chips and BOTH calendar paths (feed + export)
 * all count `attending` — one math, zero drift.
 */
export function applyBatchPicks<T extends PickSlot>(
  slots: T[],
  picks: Record<string, string>
): BatchApply<T> {
  // 1. same-code collapse (always — parallel batches of one class)
  const seen = new Set<string>();
  const collapsed: T[] = [];
  for (const s of slots) {
    const k = `${s.dayOfWeek}-${s.startMin}-${s.endMin}-${s.subjectCode}`;
    if (seen.has(k)) continue;
    seen.add(k);
    collapsed.push(s);
  }
  // 2. resolve cells
  const cells = parallelCells(collapsed);
  const cellByKey = new Map(cells.map((c) => [c.key, c]));
  const resolved = new Map<string, string>();
  const unresolvedCells: ParallelCell<T>[] = [];
  for (const c of cells) {
    const pick = picks[c.key];
    if (pick !== undefined && c.options.includes(pick)) resolved.set(c.key, pick);
    else unresolvedCells.push(c);
  }
  // 3. filter — unpicked windows keep every option (current behavior, disclosed)
  const attending: T[] = [];
  const excluded: T[] = [];
  for (const s of collapsed) {
    const cell = cellByKey.get(parallelCellKey(s));
    if (!cell) {
      attending.push(s);
      continue;
    }
    const pick = resolved.get(cell.key);
    if (pick === undefined) {
      attending.push(s);
      continue;
    }
    if (s.subjectCode === pick) attending.push(s);
    else excluded.push(s);
  }
  return {
    attending,
    excluded,
    resolvedCells: cells.filter((c) => resolved.has(c.key)),
    unresolvedCells,
  };
}
