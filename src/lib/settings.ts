import { db } from "@/lib/db";

export interface AppSettings {
  targetPercentage: number;
  syncIntervalMinutes: number;
  autoSyncEnabled: boolean;
  demoMode: boolean;
  minLiveSyncGapMinutes: number;
  /** Per-type notification switches; missing key = enabled. */
  notifyPrefs: Record<string, boolean>;
}

/** Notification types the engine can emit (whitelisted in the API + UI). */
export const NOTIFY_TYPES = [
  "ERP_CHANGE",
  "SYNC_SUCCESS",
  "SYNC_FAILURE",
  "ATTENDANCE_WARNING",
  "REMINDER_CHANGE",
] as const;

export const DEFAULT_SETTINGS: AppSettings = {
  targetPercentage: 75,
  syncIntervalMinutes: 15,
  autoSyncEnabled: true,
  demoMode: true, // clearly-labelled simulator so the pipeline is usable without live credentials
  minLiveSyncGapMinutes: 5, // rate-limit protection for the real ERP
  notifyPrefs: {},
};

export function isNotifyType(type: string): boolean {
  return (NOTIFY_TYPES as readonly string[]).includes(type);
}

export function isNotifyEnabled(prefs: Record<string, boolean> | undefined, type: string): boolean {
  return prefs?.[type] !== false;
}

const SETTINGS_KEY = "app.settings";

export async function getSettings(): Promise<AppSettings> {
  const row = await db.setting.findUnique({ where: { key: SETTINGS_KEY } });
  if (!row) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(row.value) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const next: AppSettings = { ...current, ...patch };
  // sanity clamps
  next.targetPercentage = Math.min(100, Math.max(1, Math.round(next.targetPercentage)));
  next.syncIntervalMinutes = Math.min(1440, Math.max(1, Math.round(next.syncIntervalMinutes)));
  next.minLiveSyncGapMinutes = Math.min(120, Math.max(1, Math.round(next.minLiveSyncGapMinutes)));
  // notification prefs merge key-wise and keep only known types
  if (patch.notifyPrefs) {
    const merged: Record<string, boolean> = { ...current.notifyPrefs };
    for (const [k, v] of Object.entries(patch.notifyPrefs)) {
      if (isNotifyType(k) && typeof v === "boolean") merged[k] = v;
    }
    next.notifyPrefs = merged;
  }
  await db.setting.upsert({
    where: { key: SETTINGS_KEY },
    update: { value: JSON.stringify(next) },
    create: { key: SETTINGS_KEY, value: JSON.stringify(next) },
  });
  return next;
}

/** Generic single-value helper used by the sync engine for locks etc. */
export async function getRawSetting(key: string): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setRawSetting(key: string, value: string): Promise<void> {
  await db.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}
