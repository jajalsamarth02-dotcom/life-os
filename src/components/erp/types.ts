/**
 * Client-side types mirroring the verified API contracts.
 * (Kept separate from @/lib/views.ts, which imports the server-only DB client.)
 */

export type AttendanceStatus = "safe" | "warning" | "danger" | "none";
export type AppMode = "demo" | "live" | "none";
export type SyncStatus = "idle" | "syncing" | "failed" | "never_synced";

export interface AttendanceView {
  present: number;
  total: number;
  absent: number;
  percentage: number;
  status: AttendanceStatus;
  classesToTarget: number;
  canSkip: number;
}

export interface SubjectView extends AttendanceView {
  id: string;
  code: string;
  name: string;
  /** Semester partition (1–8) as reported by the ERP; null = not yet known. */
  semester: number | null;
  updatedAt: string;
  /** Effective target for THIS subject (override or global). */
  targetPct: number;
  /** True when this subject uses its own target (≠ global). */
  hasCustomTarget: boolean;
}

export type ReminderSource = "ERP" | "PERSONAL";
export type RemindersFilter = "all" | "erp" | "personal";
export type ReminderType =
  | "EXAM"
  | "PRACTICAL_EXAM"
  | "VIVA"
  | "ASSIGNMENT"
  | "SUBMISSION"
  | "ATTENDANCE_WARNING"
  | "OTHER";
export type ReminderStatus = "ACTIVE" | "DONE" | "DISMISSED";

export interface Reminder {
  id: string;
  source: ReminderSource;
  externalId: string | null;
  type: ReminderType;
  title: string;
  description: string | null;
  /** Linked subject code (attendance warnings get it from sync; personal reminders may pick one). */
  subjectCode: string | null;
  /** Joined by /api/reminders so the client can group by subject without a second call. */
  subjectName?: string | null;
  subjectSemester?: number | null;
  dueAt: string;
  status: ReminderStatus;
  createdAt: string;
  updatedAt?: string;
}

export interface SyncState {
  status: SyncStatus;
  mode: AppMode;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  nextScheduledSyncAt: string | null;
}

export type SyncLogStatus = "success" | "failed" | "running" | "skipped";
export type SyncTrigger = "scheduled" | "manual" | "startup";

export interface SyncLog {
  id: string;
  status: SyncLogStatus;
  trigger: SyncTrigger;
  mode: AppMode | string;
  changes: number;
  durationMs: number;
  summary: string | null;
  errorDetails: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export type ChangeKind =
  | "ATTENDANCE_UPDATED"
  | "SUBJECT_ADDED"
  | "SUBJECT_REMOVED"
  | "REMINDER_UPSERTED"
  | "REMINDER_DATE_CHANGED"
  | "REMINDER_REMOVED";

export interface ChangeEvent {
  id: string;
  kind: ChangeKind;
  subjectCode: string | null;
  detail: string;
  createdAt: string;
}

export type NotificationSeverity = "info" | "success" | "warning" | "critical";

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: NotificationSeverity;
  read: boolean;
  createdAt: string;
}

export interface ErpSyncEnvelope {
  connected: boolean;
  username: string | null;
  connectionStatus: string | null;
  demoMode?: boolean;
  sync: SyncState;
}

export interface ErpStatus extends ErpSyncEnvelope {
  lastVerifiedAt: string | null;
  liveAvailable: "unknown" | "yes" | "no";
  /** Semester the ERP pages reported during sync; null = not detected yet. */
  detectedSemester: number | null;
}

export interface DashboardResponse {
  target: number;
  /** Active semester partition: "all" or "1".."8". */
  semester: string;
  mode: AppMode;
  overall: AttendanceView;
  subjects: SubjectView[];
  warningSubjects: number;
  reminders: {
    items: Reminder[];
    todayCount: number;
    weekCount: number;
    /** Pending (not yet Submitted) ERP ALA/assignment rows. */
    alaPending: number;
    /** All tracked ERP ALA/assignment rows. */
    alaTotal: number;
  };
  erp: ErpSyncEnvelope;
  notifications: AppNotification[];
  unreadCount: number;
  changes: ChangeEvent[];
}

export interface AttendanceResponse {
  target: number;
  /** Active semester partition: "all" or "1".."8". */
  semester: string;
  overall: AttendanceView;
  subjects: SubjectView[];
}

export interface HistoryPoint {
  t: string;
  percentage: number;
  present: number;
  total: number;
}

export interface HistoryResponse {
  overall: HistoryPoint[];
  subjects: Record<string, HistoryPoint[]>;
  subjectsMeta: { code: string; name: string }[];
}

export interface TimetableSlotRow {
  id: string;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  subjectCode: string;
  source: string;
}

export interface TimetableResponse {
  slots: TimetableSlotRow[];
}

/**
 * One ERP-synced ALA/assignment row (Reminder with externalId `erp:assign:*`),
 * joined with the resolved ERP course name for subject-wise grouping.
 */
export type AssignmentRow = Reminder;

export interface AssignmentsResponse {
  assignments: AssignmentRow[];
  /** ERP course-code → course-name map resolved from assignment detail pages. */
  courseNames: Record<string, string>;
  semester: string;
  /** Semester the ERP itself reported at sync time (the ALA list's true origin). */
  sourceSemester: number | null;
  mode: AppMode;
  sync: { status: SyncStatus; lastSuccessAt: string | null };
}

export interface AppSettings {
  targetPercentage: number;
  syncIntervalMinutes: number;
  autoSyncEnabled: boolean;
  demoMode: boolean;
  minLiveSyncGapMinutes: number;
  /** Per-type notification switches; missing key = enabled. */
  notifyPrefs: Record<string, boolean>;
  /** Per-subject target overrides (code → %); missing key = global target. */
  subjectTargets: Record<string, number>;
  /** Semester partition: "all" or "1".."8" — only that semester's ERP subjects are shown. */
  selectedSemester: string;
}

/** Data for the Settings semester partition card. */
export interface SemestersResponse {
  selected: string;
  /** Current semester the ERP itself reported during sync; null = unknown. */
  detected: number | null;
  counts: { semester: number | null; count: number }[];
}

export interface SyncResponse {
  ok: boolean;
  mode?: AppMode | string;
  changes?: number;
  message?: string;
  errorCode?: string;
  error?: string;
}

export interface SyncLogsResponse {
  state: SyncState;
  logs: SyncLog[];
}

export interface SyncEventsResponse {
  events: ChangeEvent[];
}

export interface DigestResponse {
  days: number;
  window: { from: string; to: string };
  overall: {
    pctStart: number | null;
    pctEnd: number | null;
    deltaPts: number | null;
    attended: number;
    held: number;
    missed: number;
  } | null;
  subjects: {
    code: string;
    name: string;
    pctStart: number | null;
    pctEnd: number | null;
    deltaPts: number | null;
    attended: number;
    held: number;
    missed: number;
  }[];
  syncs: { total: number; success: number; failed: number };
  changes: number;
  reminders: { created: number; completed: number };
  upcoming: { id: string; title: string; source: string; dueAt: string }[];
}

export interface ErpConnectSuccess {
  ok: true;
  username: string;
  snapshotSubjects: number;
  sync: SyncState;
}

export interface ErpConnectFailure {
  ok: false;
  errorCode: string;
  error: string;
  details?: string | null;
}
