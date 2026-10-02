"use client";

import { useEffect } from "react";

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
