"use client";

import { useEffect } from "react";

/**
 * r102 — the badge's "due personal reminders" half, as a pinned pure.
 *
 * Counts the student's own (PERSONAL) reminders that are ACTIVE and whose
 * due time has passed — the same "actionable now" rule the Reminders tab's
 * overdue styling uses (ACTIVE + dueAt < now, line-pinned there). Deliberate
 * divergences from the notification watcher's rule (use-due-notifications):
 *  - no 24h lookback cap: the badge is a persistent nag, not a burst
 *    guard — an item stays counted until it is DONE/DISMISSED;
 *  - ERP rows are never counted here (the overdue-ALA half of the badge
 *    already covers them via /api/assignments — counting both would
 *    double-report every late assignment).
 * ATTENDANCE_WARNING is excluded for symmetry with the watcher: auto
 * warnings live in the notification center and would inflate the badge.
 */
export function duePersonalCount(
  rows: readonly {
    source: string;
    status: string;
    type: string;
    dueAt: string;
  }[],
  nowMs: number
): number {
  return rows.filter((r) => {
    if (r.source !== "PERSONAL") return false;
    if (r.status !== "ACTIVE") return false;
    if (r.type === "ATTENDANCE_WARNING") return false;
    return new Date(r.dueAt).getTime() < nowMs;
  }).length;
}

/**
 * r104 — the palette's "Your reminders" group order, as a pinned pure.
 *
 * ACTIVE personal reminders (ATTENDANCE_WARNING excluded, mirroring
 * duePersonalCount) sorted DUE-FIRST (overdue items lead, red-tinted in the
 * UI) and then by soonest dueAt. The palette pipes this through rankedCap:
 * idle = the due/soonest rows visible; searching = cmdk's own scorer picks
 * the best matches from the full list.
 *
 * Deliberately the SAME membership rules as duePersonalCount (PERSONAL +
 * ACTIVE + not an auto warning) — the badge half and the palette group can
 * never disagree about what counts as a reminder.
 */
export function dueFirstReminderRows<
  T extends { source: string; status: string; type: string; dueAt: string },
>(rows: readonly T[], nowMs: number): T[] {
  return rows
    .filter(
      (r) =>
        r.source === "PERSONAL" &&
        r.status === "ACTIVE" &&
        r.type !== "ATTENDANCE_WARNING"
    )
    .slice()
    .sort((a, b) => {
      const aDue = new Date(a.dueAt).getTime() < nowMs ? 0 : 1;
      const bDue = new Date(b.dueAt).getTime() < nowMs ? 0 : 1;
      return (
        aDue - bDue ||
        new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
      );
    });
}

/**
 * PWA app badge — shows a numeric badge (overdue ALA count) on the installed
 * app's icon (Android home screen, desktop taskbar/dock; iOS 17+ standalone).
 * Feature-detected and fully cosmetic: any failure is swallowed so a missing
 * badge can never disturb the app. Re-applies only when the count changes.
 */
export function useAppBadge(count: number) {
  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };

    /* Not supported (headless QA, desktop browsers without the API) → no-op. */
    if (typeof nav.setAppBadge !== "function") return;

    let cancelled = false;
    const apply = async () => {
      try {
        if (cancelled) return;
        if (count > 0) {
          await nav.setAppBadge(Math.min(count, 99));
        } else {
          await nav.clearAppBadge?.();
        }
      } catch {
        /* Some contexts (e.g. non-installed Safari tabs) reject — ignore. */
      }
    };

    void apply();
    return () => {
      cancelled = true;
    };
  }, [count]);
}
