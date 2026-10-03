/**
 * r103 — the palette's shared "search-aware cap" pure.
 *
 * The problem it solves: cmdk filters only RENDERED rows. A group that
 * pre-truncates to N rows (the 41 active deadlines → top 8, deep classes,
 * old retry stories) is invisible to searches that would have matched a
 * hidden row — r102 hit this live ("network calendar" → EMPTY although a
 * matching class existed at position 14).
 *
 * The cure, now applied to EVERY capped group:
 *  - idle (no query): keep the group's own meaningful order, cap at N —
 *    unchanged behavior, zero cost;
 *  - while typing: score EVERY item with cmdk's OWN defaultFilter (the
 *    exact scorer the list uses, imported — never re-implemented), keep
 *    the positive ranks, sort strongest-first, cap.
 *
 * One source of truth: the `key` function passed here MUST be the same
 * string the CommandItem renders as its `value` prop — what is scored is
 * exactly what is shown (the r102 classRowValue contract, generalized).
 *
 * Pure: no React, no DOM — pinned by scripts/test-palette-search-r103.ts.
 */
import { defaultFilter as cmdkDefaultFilter } from "cmdk";

export function rankedCap<T>(
  items: readonly T[],
  key: (item: T) => string,
  cap: number,
  query: string
): T[] {
  const q = query.trim();
  if (!q) return items.slice(0, cap);
  return items
    .map((item) => ({ item, rank: cmdkDefaultFilter(key(item), q) }))
    .filter((x) => x.rank > 0)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, cap)
    .map((x) => x.item);
}
