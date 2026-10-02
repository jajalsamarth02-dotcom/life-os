import { db } from "@/lib/db";

export interface AppSettings {
  targetPercentage: number;
  syncIntervalMinutes: number;
  autoSyncEnabled: boolean;
  demoMode: boolean;
  minLiveSyncGapMinutes: number;
  /** Per-type notification switches; missing key = enabled. */
  notifyPrefs: Record<string, boolean>;
  /** Per-subject attendance target overrides (subject code → %). Missing key = global target. */
  subjectTargets: Record<string, number>;
  /**
   * Semester partition: "all" shows every synchronized subject;
   * "1"–"8" shows ONLY the subjects the ERP reported for that semester.
   */
  selectedSemester: string;
}

/** Values the semester selector accepts ("all" or "1".."8"). */
export const SEMESTER_VALUES = ["all", "1", "2", "3", "4", "5", "6", "7", "8"] as const;

export function isValidSemesterValue(v: unknown): v is string {
  return typeof v === "string" && (SEMESTER_VALUES as readonly string[]).includes(v);
}

/** Convert the stored setting into a DB filter: null = all semesters. */
export function semesterFilterOf(selected: string | undefined | null): number | null {
  if (!selected) return null;
  const n = Number(selected);
  return Number.isInteger(n) && n >= 1 && n <= 8 ? n : null;
}

/** Raw setting key under which the sync engine stores the ERP-detected current semester. */
export const ERP_SEMESTER_KEY = "erp.currentSemester";

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
  subjectTargets: {},
  selectedSemester: "all", // show everything until the user partitions by semester
};

/** Resolve the effective attendance target for one subject. */
export function effectiveTarget(
  code: string,
  settings: Pick<AppSettings, "targetPercentage" | "subjectTargets">
): number {
  const override = settings.subjectTargets?.[code];
  return typeof override === "number" && Number.isFinite(override) ? override : settings.targetPercentage;
}

/** Number of subjects using a custom target. */
export function countCustomTargets(subjectTargets: Record<string, number> | undefined): number {
  return subjectTargets ? Object.keys(subjectTargets).length : 0;
}

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
  // semester partition: accept numbers too (1–8) and normalize to "all"/"1".."8"
  if (patch.selectedSemester !== undefined) {
    const raw = patch.selectedSemester as unknown;
    const normalized =
      typeof raw === "number" && Number.isInteger(raw) ? String(raw) : raw;
    next.selectedSemester = isValidSemesterValue(normalized)
      ? normalized
      : current.selectedSemester;
  }
  // subject targets: replace when provided, keep only sane numeric values (1–100)
  if (patch.subjectTargets !== undefined) {
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(patch.subjectTargets ?? {})) {
      if (typeof v === "number" && Number.isFinite(v)) {
        clean[k] = Math.min(100, Math.max(1, Math.round(v)));
      }
    }
    next.subjectTargets = clean;
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
