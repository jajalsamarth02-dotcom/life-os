/**
 * Browser (system) notification support for due reminders.
 *
 * State is intentionally device-local (localStorage + Notification permission):
 * permissions are per-browser, so they do not belong in the server-side settings.
 * Components subscribe to CHANGE_EVENT to re-read the state reactively.
 */

const ENABLED_KEY = "erp.browserReminders.enabled";
const NOTIFIED_KEY = "erp.browserReminders.notified"; // { [reminderId]: dueAtIso }

export const CHANGE_EVENT = "erp:browser-reminders-changed";

export type PermissionState = "granted" | "denied" | "default" | "unsupported";

export function isSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function permissionState(): PermissionState {
  if (!isSupported()) return "unsupported";
  return Notification.permission as PermissionState;
}

export function isEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setEnabled(v: boolean): void {
  try {
    if (v) window.localStorage.setItem(ENABLED_KEY, "1");
    else window.localStorage.removeItem(ENABLED_KEY);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    /* storage unavailable — stay non-fatal */
  }
}

export async function requestPermission(): Promise<PermissionState> {
  if (!isSupported()) return "unsupported";
  try {
    const result = await Notification.requestPermission();
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
    return result as PermissionState;
  } catch {
    return permissionState();
  }
}

export function showSystemNotification(title: string, body: string, tag: string): boolean {
  if (!isSupported() || Notification.permission !== "granted") return false;
  try {
    const n = new Notification(title, { body, tag });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}

/* ---------------- notified-reminder bookkeeping ---------------- */

export function wasNotified(reminderId: string): boolean {
  try {
    const map = readNotified();
    return Object.prototype.hasOwnProperty.call(map, reminderId);
  } catch {
    return false;
  }
}

/**
 * True when THIS reminder has already fired for THIS due date. Keyed by
 * (id, dueAt) so a snoozed/rescheduled reminder (new dueAt) is eligible to
 * notify again when it becomes due.
 */
export function wasNotifiedFor(reminderId: string, dueAtIso: string): boolean {
  try {
    const map = readNotified();
    const at = map[reminderId];
    if (at === undefined) return false;
    const stored = new Date(at).getTime();
    const current = new Date(dueAtIso).getTime();
    if (!Number.isNaN(stored) && !Number.isNaN(current) && stored !== current) return false;
    return true;
  } catch {
    return false;
  }
}

export function markNotified(reminderId: string, dueAtIso: string): void {
  try {
    const map = readNotified();
    map[reminderId] = dueAtIso;
    // Prune entries whose due date is older than 7 days (ids no longer relevant).
    const cutoff = Date.now() - 7 * 86_400_000;
    for (const [id, iso] of Object.entries(map)) {
      if (new Date(iso).getTime() < cutoff) delete map[id];
    }
    window.localStorage.setItem(NOTIFIED_KEY, JSON.stringify(map));
  } catch {
    /* non-fatal */
  }
}

function readNotified(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(NOTIFIED_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Test notification used by the Settings "send a test" button. */
export function sendTestNotification(): boolean {
  return showSystemNotification(
    "ERP Sync test notification",
    "Browser reminders are working. You'll get one when a reminder becomes due.",
    "erp-test"
  );
}
