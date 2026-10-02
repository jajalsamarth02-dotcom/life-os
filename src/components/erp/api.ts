/**
 * Typed fetch helpers + TanStack Query keys. All requests use relative paths.
 */
import type {
  AppSettings,
  AttendanceResponse,
  DashboardResponse,
  DigestResponse,
  ErpConnectFailure,
  ErpConnectSuccess,
  ErpStatus,
  HistoryResponse,
  Reminder,
  RemindersFilter,
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
  settings: ["settings"] as const,
  sync: ["sync"] as const,
  erpStatus: ["erp-status"] as const,
};

/* ---------- GET ---------- */

export const fetchDashboard = () => api<DashboardResponse>("/api/dashboard");
export const fetchDigest = (days = 7) =>
  api<DigestResponse>(`/api/digest?days=${days}`);
export const fetchAttendance = () => api<AttendanceResponse>("/api/attendance");
export const fetchHistory = () => api<HistoryResponse>("/api/history");
export const fetchTimetable = () => api<TimetableResponse>("/api/timetable").then((r) => r.slots);
export const createSlot = (payload: { dayOfWeek: number; start: string; end: string; subjectCode: string }) =>
  api<{ slot: unknown }>("/api/timetable", { method: "POST", body: JSON.stringify(payload) });
export const deleteSlot = (id: string) => api<{ ok: boolean }>(`/api/timetable/${id}`, { method: "DELETE" });
export const fetchReminders = (filter: RemindersFilter, includeDone: boolean) =>
  api<{ reminders: Reminder[] }>(
    `/api/reminders?filter=${encodeURIComponent(filter)}&includeDone=${includeDone}`
  ).then((r) => r.reminders);
export const fetchSettings = () => api<AppSettings>("/api/settings");
export const fetchSyncLogs = () => api<SyncLogsResponse>("/api/sync");
export const fetchSyncEvents = () => api<SyncEventsResponse>("/api/sync/events");
export const fetchErpStatus = () => api<ErpStatus>("/api/erp/status");

/* ---------- POST / PUT / PATCH / DELETE ---------- */

export const postSync = () => api<SyncResponse>("/api/sync", { method: "POST" });

export const postDemoEvolve = () =>
  api<SyncResponse>("/api/demo/evolve", { method: "POST" });

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

export const deleteReminder = (id: string) =>
  api<{ ok: boolean }>(`/api/reminders/${id}`, { method: "DELETE" });

export const putSettings = (patch: Partial<AppSettings>) =>
  api<AppSettings>("/api/settings", {
    method: "PUT",
    body: JSON.stringify(patch),
  });

export const connectErp = (username: string, password: string) =>
  api<ErpConnectSuccess>("/api/erp/connect", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });

export const disconnectErp = () =>
  api<{ ok: boolean }>("/api/erp/disconnect", { method: "POST" });

export type { ErpConnectFailure };
