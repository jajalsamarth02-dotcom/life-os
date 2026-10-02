import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { runSync } from "./engine";

/**
 * Scheduler watchdog — self-heals a dead background tick loop.
 *
 * The in-process scheduler (scheduler.ts) ticks every 60s and calls
 * syncIfDue(). If that interval ever stops firing (dev-mode hot reloads,
 * a wedged event loop phase, a silent crash of its module closure), the
 * app would keep serving STALE data forever with status "idle" and zero
 * errors — the worst failure mode for a live sync dashboard.
 *
 * This watchdog is called from hot read paths (GET /api/dashboard and
 * GET /api/sync). It notices when a scheduled sync is overdue by more
 * than WATCHDOG_GRACE_MS while the engine is idle, and kicks one
 * fire-and-forget runSync("scheduled"). Cheap (a single-row read, most
 * calls), deduped, and it respects the auto-sync setting.
 */

const WATCHDOG_GRACE_MS = 2 * 60_000; // overdue by >2 min counts as stalled
const MIN_KICK_GAP_MS = 5 * 60_000; // at most one kick per 5 minutes

const g = globalThis as unknown as {
  __erpKickInFlight?: boolean;
  __erpLastKickAt?: number;
};

export async function kickSyncIfStalled(): Promise<void> {
  try {
    const settings = await getSettings();
    if (!settings.autoSyncEnabled) return;

    const state = await db.syncState.findUnique({ where: { id: "singleton" } });
    if (!state || state.status === "syncing") return;

    const dueAt = state.nextScheduledSyncAt?.getTime() ?? 0;
    if (!dueAt) return;
    const overdueMs = Date.now() - dueAt;
    if (overdueMs < WATCHDOG_GRACE_MS) return;

    if (g.__erpKickInFlight) return;
    if (g.__erpLastKickAt && Date.now() - g.__erpLastKickAt < MIN_KICK_GAP_MS) return;
    g.__erpKickInFlight = true;
    g.__erpLastKickAt = Date.now();

    console.warn(
      `[erp-sync] watchdog: scheduled sync overdue by ${Math.round(overdueMs / 1000)}s while idle — kicking runSync now`
    );
    void runSync("scheduled")
      .catch(() => {
        /* runSync records its own failure state — nothing to add here */
      })
      .finally(() => {
        g.__erpKickInFlight = false;
      });
  } catch {
    // The watchdog must never break the read path that hosts it.
  }
}
