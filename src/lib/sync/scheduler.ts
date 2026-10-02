import { syncIfDue } from "./engine";
import { maybeDailyDigest } from "@/lib/notify/whatsapp";

/**
 * In-process background scheduler.
 * Ticks once a minute and lets the sync engine decide whether a scheduled
 * synchronization is due (respects configured interval, failure backoff,
 * rate limits and whether any data source is configured at all).
 * The same tick also drives the fixed-time daily WhatsApp digest.
 */

export function startScheduler(): void {
  const g = globalThis as unknown as { __erpSchedulerStarted?: boolean };
  if (g.__erpSchedulerStarted) return;
  g.__erpSchedulerStarted = true;

  console.log("[erp-sync] background scheduler started (tick every 60s)");

  const tick = async () => {
    try {
      const outcome = await syncIfDue();
      if (outcome && !outcome.skipped) {
        console.log(
          `[erp-sync] scheduled sync → ${outcome.ok ? "success" : "failed"}${
            outcome.ok ? ` (${outcome.changes} changes)` : ` (${outcome.errorCode})`
          }`
        );
      }
    } catch (e) {
      console.error("[erp-sync] scheduler tick error:", e);
    }
    // Fixed-time daily digest (no-ops within milliseconds unless configured
    // and due — and it never throws, so it can't destabilize the tick).
    await maybeDailyDigest();
  };

  setInterval(tick, 60_000);
  // first tick shortly after boot so a fresh app syncs right away
  setTimeout(tick, 8_000);
}
