/**
 * Typed fetch helpers + TanStack Query keys. All requests use relative paths.
 */
import type {
  AlaNoteRow,
  AlaNotesResponse,
  AppSettings,
  AssignmentsResponse,
  AttendanceResponse,
  DashboardResponse,
  DigestResponse,
  ErpConnectFailure,
  ErpConnectSuccess,
  ErpStatus,
  HistoryResponse,
  Reminder,
  RemindersFilter,
  ResultsResponse,
  SemestersResponse,
  SyncEventsResponse,
  SyncLogsResponse,
  SyncResponse,
  TimetableResponse,
} from "./types";

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>, fallback: string) {
    super(
      typeof body.error === "string" && body.error
        ? body.error
        : typeof body.message === "string" && body.message
          ? body.message
          : fallback
    );
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }

  get errorCode(): string | null {
    const code = this.body.errorCode ?? this.body.lastErrorCode;
    return typeof code === "string" ? code : null;
  }

  get details(): string | null {
    const d = this.body.details;
    if (typeof d === "string") return d;
    return null;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (!res.ok) {
    throw new ApiError(res.status, body, `Request failed (${res.status})`);
  }
  return body as T;
}

export const qk = {
  dashboard: ["dashboard"] as const,
  attendance: ["attendance"] as const,
  history: ["history"] as const,
  timetable: ["timetable"] as const,
  reminders: (filter: RemindersFilter, includeDone: boolean) =>
    ["reminders", filter, includeDone] as const,
  assignments: ["assignments"] as const,
  alaNotes: ["ala-notes"] as const,
  settings: ["settings"] as const,
  semesters: ["semesters"] as const,
  sync: ["sync"] as const,
  results: ["results"] as const,
  /* Cross-tab handoff for retry-story deep-links: the command palette writes
     {code, nonce} here and the results card consumes it on mount/effect —
     survives tab unmounts, unlike a window CustomEvent (no missed events). */
  retryFocus: ["retry-story-focus"] as const,
  erpStatus: ["erp-status"] as const,
  waStatus: ["wa-status"] as const,
  ntfyStatus: ["ntfy-status"] as const,
  calendarToken: ["calendar-token"] as const,
};

/** Payload for the qk.retryFocus handoff (command palette → results card). */
export interface RetryFocusHandoff {
  /** Subject code to spotlight — null = generic "open retry history". */
  code: string | null;
  /** Monotonic bump so repeat commands re-flash even with the same code. */
  nonce: number;
}

/* ---------- GET ---------- */

export const fetchDashboard = () => api<DashboardResponse>("/api/dashboard");
export const fetchDigest = (days = 7) =>
  api<DigestResponse>(`/api/digest?days=${days}`);
export const fetchAttendance = () => api<AttendanceResponse>("/api/attendance");
export const fetchHistory = () => api<HistoryResponse>("/api/history");
/** The weekly routine + the student's parallel-class picks (one shared cache). */
export const fetchTimetable = () => api<TimetableResponse>("/api/timetable");

/**
 * Published exam results (Final Results). TTL-cached server-side; the first
 * load after a cache miss walks the ERP read-only and can take a while —
 * pass `refresh` to force a live walk (the card's refresh button).
 */
export const fetchResults = (refresh = false) =>
  api<ResultsResponse>(`/api/results${refresh ? "?refresh=1" : ""}`);

/**
 * Resolve (or clear with null) ONE parallel class window — the routine lists
 * ≥2 classes in the same wall time and the student attends exactly one.
 */
export const setBatchPick = (cellKey: string, subjectCode: string | null) =>
  api<{ picks: Record<string, string> }>("/api/timetable/picks", {
    method: "PUT",
    body: JSON.stringify({ cellKey, subjectCode }),
  });
export const createSlot = (payload: {
  dayOfWeek: number;
  start: string;
  end: string;
  subjectCode: string;
  /** Accept overlapping slots deliberately (server answers 409 without it). */
  force?: boolean;
}) => api<{ slot: unknown; conflicts?: SlotConflict[] }>("/api/timetable", {
  method: "POST",
  body: JSON.stringify(payload),
});

/** Another class occupying the same time window (returned by a 409). */
export interface SlotConflict {
  id: string;
  subjectCode: string;
  start: string;
  end: string;
  source: string;
}
export const deleteSlot = (id: string) => api<{ ok: boolean }>(`/api/timetable/${id}`, { method: "DELETE" });
export const fetchReminders = (filter: RemindersFilter, includeDone: boolean) =>
  api<{ reminders: Reminder[] }>(
    `/api/reminders?filter=${encodeURIComponent(filter)}&includeDone=${includeDone}`
  ).then((r) => r.reminders);
/** ERP-synced ALA/assignment rows, subject-wise (includes Submitted rows). */
export const fetchAssignments = () => api<AssignmentsResponse>("/api/assignments");
/** Local-only note/priority overlay on ALA rows (never synced to the ERP). */
export const fetchAlaNotes = () => api<AlaNotesResponse>("/api/ala-notes").then((r) => r.notes);
/**
 * Upsert one ALA row's overlay. Saving an empty note with priority 0 clears
 * (deletes) the overlay row server-side; the response echoes the new state.
 */
export const saveAlaNote = (payload: {
  externalId: string;
  note: string;
  priority: number;
}) =>
  api<{ ok: boolean; deleted?: boolean; note: AlaNoteRow }>("/api/ala-notes", {
    method: "POST",
    body: JSON.stringify(payload),
  });

/** Aggregate result of a batch restore (Settings → Data & backups). */
export interface AlaNotesRestoreResult {
  ok: boolean;
  created: number;
  updated: number;
  /** Entries whose backup state was empty — the overlay row was removed. */
  cleared: number;
  /** Valid rows with no matching local ERP row (older semester, deleted ALA). */
  skipped: number;
  skippedIds: string[];
  /** Rows rejected outright (bad externalId shape). */
  invalid: number;
  total: number;
}

/**
 * Restore a batch of noted ALAs from a parsed backup file. Merge-only:
 * matching rows are overwritten, nothing is wiped implicitly.
 */
export const restoreAlaNotes = (notes: { externalId: string; note?: string; priority?: number }[]) =>
  api<AlaNotesRestoreResult>("/api/ala-notes/restore", {
    method: "POST",
    body: JSON.stringify({ notes }),
  });
export const fetchSettings = () => api<AppSettings>("/api/settings");
export const fetchSemesters = () => api<SemestersResponse>("/api/semesters");
export const fetchSyncLogs = () => api<SyncLogsResponse>("/api/sync");
export const fetchSyncEvents = () => api<SyncEventsResponse>("/api/sync/events");
export const fetchErpStatus = () => api<ErpStatus>("/api/erp/status");

/* ---------- POST / PUT / PATCH / DELETE ---------- */

export const postSync = () => api<SyncResponse>("/api/sync", { method: "POST" });

export const postDemoEvolve = () =>
  api<SyncResponse>("/api/demo/evolve", { method: "POST" });

export interface DemoResetResult {
  ok: boolean;
  message: string;
  wiped: {
    timetableSlots: number;
    snapshots: number;
    changeEvents: number;
    syncLogs: number;
    notifications: number;
    erpReminders: number;
    subjects: number;
  };
}

/** Wipe all demo-generated data and rebuild from a fresh simulated ERP. */
export const postDemoReset = () =>
  api<DemoResetResult>("/api/demo/reset", { method: "POST" });

export const markAllNotificationsRead = () =>
  api<{ ok: boolean }>("/api/notifications", {
    method: "POST",
    body: JSON.stringify({ all: true }),
  });

export const createReminder = (payload: {
  title: string;
  type: string;
  description?: string;
  dueAt: string;
  subjectCode?: string | null;
}) =>
  api<{ reminder: Reminder }>("/api/reminders", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const updateReminderStatus = (id: string, status: string) =>
  api<{ reminder: Reminder }>(`/api/reminders/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });

/** Link/unlink a subject on a PERSONAL reminder (null clears the link). */
export const updateReminderSubject = (id: string, subjectCode: string | null) =>
  api<{ reminder: Reminder }>(`/api/reminders/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ subjectCode: subjectCode ?? "" }),
  });

/** Snooze/reschedule a PERSONAL reminder (ERP reminders are sync-owned). */
export const snoozeReminder = (id: string, dueAt: string) =>
  api<{ reminder: Reminder }>(`/api/reminders/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ dueAt }),
  });

/** Fetch the full JSON backup produced by GET /api/export. */
export async function fetchBackup(): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch("/api/export");
  if (!res.ok) throw new ApiError(res.status, {}, "Could not build the backup");
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="?([^";]+)"?/.exec(disposition);
  return {
    blob: await res.blob(),
    filename: match?.[1] ?? "erp-sync-backup.json",
  };
}

/** Download the JSON backup via a temporary object URL. */
export async function downloadBackup(): Promise<string> {
  const { blob, filename } = await fetchBackup();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return filename;
}

export const deleteReminder = (id: string) =>
  api<{ ok: boolean }>(`/api/reminders/${id}`, { method: "DELETE" });

export const putSettings = (patch: Partial<AppSettings>) =>
  api<AppSettings>("/api/settings", {
    method: "PUT",
    body: JSON.stringify(patch),
  });

/**
 * Set the semester partition ("all" or "1".."8"). Every subject list,
 * overall figure and trend chart then shows ONLY that semester's data.
 */
export const putSelectedSemester = (selected: string) =>
  putSettings({ selectedSemester: selected });

/** Set (or clear with null) a per-subject attendance target override. */
export const putSubjectTarget = (code: string, targetPct: number | null) =>
  api<{ ok: boolean; code: string; hasCustomTarget: boolean; targetPct: number }>(
    "/api/subjects/target",
    { method: "PUT", body: JSON.stringify({ code, targetPct }) }
  );

export const connectErp = (username: string, password: string) =>
  api<ErpConnectSuccess>("/api/erp/connect", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });

export const disconnectErp = () =>
  api<{ ok: boolean }>("/api/erp/disconnect", { method: "POST" });

export type { ErpConnectFailure };

/* ---------- WhatsApp alerts (CallMeBot) ---------- */

export interface WaStatusResponse {
  enabled: boolean;
  configured: boolean;
  phoneMasked: string | null;
  lastAutoAt: string | null;
  lastPendingCount: number | null;
  lastResult: string | null;
  /** "HH:MM" IST when a fixed daily digest is scheduled; null = sync-triggered only. */
  digestTime: string | null;
}

export const fetchWaStatus = () => api<WaStatusResponse>("/api/notify/whatsapp");

export const postWaAction = (
  action: "save" | "enable" | "setDigestTime" | "test" | "digest",
  payload?: { phone?: string; apikey?: string; enabled?: boolean; time?: string | null }
) =>
  api<{ ok?: boolean; status?: WaStatusResponse; snippet?: string; text?: string; message?: string }>(
    "/api/notify/whatsapp",
    { method: "POST", body: JSON.stringify({ action, ...payload }) }
  );

/* ---------- Push notifications (ntfy) ---------- */

export interface NtfyStatusResponse {
  enabled: boolean;
  configured: boolean;
  topicMasked: string | null;
  serverHost: string | null;
  isDefaultServer: boolean;
  lastAutoAt: string | null;
  lastPendingCount: number | null;
  lastResult: string | null;
  /** "HH:MM" IST when a fixed daily digest is scheduled; null = sync-triggered only. */
  digestTime: string | null;
}

export const fetchNtfyStatus = () => api<NtfyStatusResponse>("/api/notify/ntfy");

export const postNtfyAction = (
  action: "save" | "enable" | "setDigestTime" | "test" | "digest",
  payload?: { topic?: string; server?: string; enabled?: boolean; time?: string | null }
) =>
  api<{ ok?: boolean; status?: NtfyStatusResponse; snippet?: string; text?: string; message?: string }>(
    "/api/notify/ntfy",
    { method: "POST", body: JSON.stringify({ action, ...payload }) }
  );

/* ---------- Live calendar subscription feed ---------- */

export interface CalendarTokenResponse {
  token: string | null;
  url: string | null;
}

export const fetchCalendarToken = () => api<CalendarTokenResponse>("/api/calendar/token");

export const postCalendarTokenAction = (action: "create" | "rotate" | "revoke") =>
  api<{ ok: boolean; token: string | null; url: string | null }>("/api/calendar/token", {
    method: "POST",
    body: JSON.stringify({ action }),
  });

/** Upload one ALA to the ERP portal (explicit, user-initiated). */
export async function submitAlaToErp(
  id: string,
  file: File | null,
  link: string | null
): Promise<{ ok: boolean; confirmed: boolean; message?: string }> {
  const fd = new FormData();
  if (file) fd.set("file", file);
  if (link) fd.set("link", link);
  const res = await fetch(`/api/assignments/${id}/submit`, { method: "POST", body: fd });
  const body: Record<string, unknown> = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body, typeof body.message === "string" ? body.message : "Submission failed");
  }
  return { ok: true, confirmed: Boolean(body.confirmed), message: typeof body.message === "string" ? body.message : undefined };
}
