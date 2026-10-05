"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * Tracks the browser's online/offline state and toasts on transitions.
 *
 * The app degrades gracefully offline: every view is rendered from the last
 * successful sync (React Query cache), so the banner only has to EXPLAIN the
 * stale data — no data work is needed here.
 */
export function useOffline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);

    const goOffline = () => {
      setOnline(false);
      toast.error("You're offline", {
        description: "Showing the last synced data — it updates automatically once you reconnect.",
      });
    };
    const goOnline = () => {
      setOnline(true);
      toast.success("Connection restored", {
        description: "The next ERP poll will refresh everything.",
      });
    };

    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  return online;
}
