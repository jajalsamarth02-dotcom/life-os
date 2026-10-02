"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchReminders, qk } from "./api";
import {
  CHANGE_EVENT,
  isEnabled,
  markNotified,
  permissionState,
  showSystemNotification,
  wasNotified,
  type PermissionState,
} from "@/lib/browser-reminders";
import type { Reminder } from "./types";

/**
 * Watches ACTIVE reminders and fires a system notification (plus an in-app
 * toast) when a reminder becomes due. Auto-managed attendance warnings are
 * excluded — they already live in the notification center and would be noisy.
 *
 * Only runs when the user both enabled browser reminders AND granted the
 * Notification permission. This is a page-level watcher: it fires while the
 * app is open. Each reminder fires at most once per device (tracked in
 * localStorage), and long-past items (>24h overdue) never fire.
 */
export function useDueNotifications() {
  /* Read device state lazily (client-side); effects only subscribe to changes. */
  const [permission, setPermission] = useState<PermissionState>(() => permissionState());
  const [enabled, setEnabled] = useState(() => isEnabled());

  const refresh = useCallback(() => {
    setPermission(permissionState());
    setEnabled(isEnabled());
  }, []);

  useEffect(() => {
    window.addEventListener(CHANGE_EVENT, refresh);
    return () => window.removeEventListener(CHANGE_EVENT, refresh);
  }, [refresh]);

  const active = permission === "granted" && enabled;

  const { data: reminders } = useQuery({
    queryKey: qk.reminders("all", false),
    queryFn: () => fetchReminders("all", false),
    enabled: active,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!active || !reminders) return;

    const now = Date.now();
    const due: Reminder[] = reminders.filter((r) => {
      if (r.status !== "ACTIVE" || r.type === "ATTENDANCE_WARNING") return false;
      const t = new Date(r.dueAt).getTime();
      // Fire when due; on first sight only consider things overdue < 24h
      // (avoids a burst for long-past items imported from history).
      return t <= now && now - t < 24 * 3_600_000 && !wasNotified(r.id);
    });

    for (const r of due) {
      const body = r.description?.trim()
        ? r.description.trim().slice(0, 140)
        : `Due ${new Date(r.dueAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}`;
      showSystemNotification(`⏰ ${r.title}`, body, `erp-reminder-${r.id}`);
      // Toast as well, so the reminder is visible even when the tab is focused.
      toast.warning(`Reminder due: ${r.title}`, { description: body, duration: 8000 });
      markNotified(r.id, r.dueAt);
    }
  }, [active, reminders]);
}
