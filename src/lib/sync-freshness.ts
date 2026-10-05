/**
 * The canonical sync-freshness module — ONE rulebook that decides how old
 * "the data" is and how loudly that age should speak.
 *
 * Round 105 origin (the incident, act II): the r104 cron commit stripped
 * APP_ENCRYPTION_KEY from .env, every server boot since baked a keyless
 * env, and scheduled syncs failed for ~39h (last success Sat 22:32 IST →
 * recovered Mon 13:54 IST). The header's small dot told the truth the whole
 * time — but the TODAY CARD (the hero surface, and the source of the SMS
 * brief the student copies/prints/shares) printed "SYNCED 23:02 IST": no
 * weekday, no age, no tone. A portable artifact must carry its own
 * freshness — a parent reading a forwarded brief has no header dot to
 * hover. The header's inline decision table also lived in exactly one
 * component, one refactor away from drifting.
 *
 * One rulebook, three consumers:
 *  - syncFreshness        — the header chip dot + label (byte-equal to the
 *                           r-era inline table: syncing → fresh; failures →
 *                           degraded; no instant → none; ≤22 min → fresh;
 *                           else stale);
 *  - freshnessAgeLabel    — the compact age voice ("just now", "12m ago",
 *                           "39h ago", "2d ago"), floor-based and ASCII so
 *                           the SMS plane can print it untouched;
 *  - syncedBriefLine      — the SMS brief's SYNCED line, now with the
 *                           weekday and the age ("SYNCED SAT 23:02 IST
 *                           (39h ago) - erp.gmiu.edu.in").
 *
 * Thresholds: FRESH_LIMIT_MIN = 22 — one 15-min cadence plus a 7-min grace
 * (the same 22 the header has always used; now it has a name and a home).
 * The age ladder mirrors the header's honesty ladder: fresh is quiet, stale
 * is amber, degraded (the engine retrying after failures) is red.
 */
import { istFormat } from "./ist";

/** One cadence (15 min) + grace (7 min) — the "data is fresh" ceiling. */
export const SYNC_FRESH_LIMIT_MIN = 22;

export type SyncFreshness = "fresh" | "stale" | "degraded" | "none";

/** The ONE freshness verdict. `at` is the resolved "last good data" instant
 *  (the caller decides the lastSuccess ?? lastSync fallback — the header's
 *  documented choice); failures/isSyncing come from the same SyncState row. */
export function syncFreshness(
  nowMs: number,
  at: string | number | null,
  consecutiveFailures: number,
  isSyncing: boolean
): SyncFreshness {
  if (isSyncing) return "fresh";
  if (consecutiveFailures > 0) return "degraded";
  if (at == null) return "none";
  const ageMin = (nowMs - new Date(at).getTime()) / 60_000;
  return ageMin <= SYNC_FRESH_LIMIT_MIN ? "fresh" : "stale";
}

/** Compact ASCII age voice. Clock skew (a future instant) reads as "just
 *  now" — an honest "age" is never negative. */
export function freshnessAgeLabel(nowMs: number, atMs: number): string {
  const s = Math.floor((nowMs - atMs) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 48 * 3600) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** The SMS brief's SYNCED line. The legacy "not yet" fallback stays
 *  byte-identical to the r62-era composition; the synced case gains the
 *  weekday (the stamp was ambiguous across any multi-day gap) and the age
 *  (the incident's lesson: a copied brief must say how old its numbers are). */
export function syncedBriefLine(nowMs: number, lastSyncAt: string | null): string {
  if (!lastSyncAt) return "SYNCED not yet IST - erp.gmiu.edu.in";
  const t = new Date(lastSyncAt).getTime();
  const weekday = istFormat(t, "EEE").toUpperCase();
  const hhmm = istFormat(t, "HH:mm");
  return `SYNCED ${weekday} ${hhmm} IST (${freshnessAgeLabel(nowMs, t)}) - erp.gmiu.edu.in`;
}
