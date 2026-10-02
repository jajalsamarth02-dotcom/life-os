/** Shared types for ERP connectors and the sync engine. */

export type SnapshotMode = "live" | "demo";

export type ReminderType =
  | "EXAM"
  | "PRACTICAL_EXAM"
  | "VIVA"
  | "ASSIGNMENT"
  | "SUBMISSION"
  | "ATTENDANCE_WARNING"
  | "OTHER";

export interface ErpSubjectSnapshot {
  code: string;
  name: string;
  present: number;
  total: number;
  /** Semester (1–8) if the ERP reports it for this row; null = unknown. */
  semester?: number | null;
}

export interface ErpReminderSnapshot {
  /** Unique ERP identifier — used to upsert without creating duplicates. */
  externalId: string;
  type: ReminderType;
  title: string;
  description?: string;
  /** ISO-8601 */
  dueAt: string;
}

/**
 * One row of the ERP's Assignments page ("ALA" — Active Learning
 * Assignments — plus other coursework). Verified GMIU table columns:
 *   # | Title | Course | Session | Semester | Start Date | End Date |
 *   Submission Status | Approval Status
 */
export interface ErpAssignmentSnapshot {
  /** ERP assignment row id (from /student/assignment/{id}) — dedup key. */
  externalId: string;
  title: string;
  /** ERP course code, e.g. "BETCE15324" — the subject-wise grouping key. */
  courseCode: string;
  /** Academic session label, e.g. "GMIU-2026-27(ODD)". */
  session?: string | null;
  /** Raw semester label from the row, e.g. "Sem 5". */
  semesterLabel?: string | null;
  /** ISO date (yyyy-mm-dd) the assignment opened; null when absent. */
  startDate?: string | null;
  /** ISO date (yyyy-mm-dd) — the LAST DATE / deadline shown to the student. */
  endDate: string;
  /** ERP submission state: "Pending" | "Submitted" | … (drives complete?). */
  submissionStatus: string;
  /** Faculty-side approval state: "Pending" | "Approved" | …. */
  approvalStatus?: string | null;
}

/**
 * One weekly class slot parsed from the ERP's Class Routine page
 * (/student/class-routine — verified: day-per-column table whose cells hold
 * `div.class-time` blocks with name / start / end / room / faculty / batch).
 * Only the four schedule facts the app models are kept; room/faculty/batch
 * are intentionally dropped for now.
 */
export interface ErpRoutineSlot {
  /** 0 = Sunday … 6 = Saturday (parsed from the table's own day header). */
  dayOfWeek: number;
  /** Minutes from midnight, 12-hour ERP times normalized (01:00 PM → 780). */
  startMin: number;
  endMin: number;
  /** Subject code resolved via the cached course-name → code mapping. */
  subjectCode: string;
}

export interface ErpSnapshot {
  mode: SnapshotMode;
  fetchedAt: string;
  /**
   * true = snapshot is a full view of what the ERP offers (enables safe
   * removal of subjects/reminders that disappeared from the source).
   */
  complete: boolean;
  subjects: ErpSubjectSnapshot[];
  reminders: ErpReminderSnapshot[];
  /** ALA/assignment rows parsed from the ERP Assignments page ([] when the page was unavailable). */
  assignments: ErpAssignmentSnapshot[];
  /**
   * true = the Assignments page loaded and parsed fully, so removal of
   * locally-tracked assignments that vanished from the ERP is safe.
   */
  assignmentsComplete: boolean;
  /** Course-code → course-name pairs resolved during this fetch (merged into the app's cache). */
  courseNames?: Record<string, string>;
  /** Weekly class-routine slots parsed from /student/class-routine; omitted when the page is unavailable or unrecognized. */
  routine?: ErpRoutineSlot[];
  /** Routine subject names that could not be matched to a known course code (skipped, never invented). */
  routineUnknown?: string[];
  /** Current semester detected on the ERP pages (1–8); null = not found. */
  currentSemester?: number | null;
  note?: string;
}

export type SyncErrorCode =
  | "NO_CONNECTION" // no live credentials and demo mode off
  | "UNREACHABLE" // ERP site could not be reached
  | "CAPTCHA_DETECTED" // login blocked by captcha — we never bypass it
  | "INVALID_CREDENTIALS"
  | "AUTH_FAILED" // login succeeded before but session no longer valid & re-login failed
  | "PARSE_FAILED" // logged in but page structure could not be understood
  | "SYNC_IN_PROGRESS"
  | "RATE_LIMITED"
  | "UNKNOWN";

export class SyncError extends Error {
  code: SyncErrorCode;
  details?: string;

  constructor(code: SyncErrorCode, message: string, details?: string) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export const ERROR_COPY: Record<SyncErrorCode, string> = {
  NO_CONNECTION:
    "Automatic ERP synchronization is unavailable because no ERP connection is configured. Connect your ERP account in Settings, or enable Demo mode to explore the system.",
  UNREACHABLE:
    "The college ERP could not be reached. It may be offline or blocked by the campus network.",
  CAPTCHA_DETECTED:
    "The ERP login is protected by a CAPTCHA, which cannot be bypassed. Automatic synchronization is unavailable because the ERP does not provide a supported integration method.",
  INVALID_CREDENTIALS:
    "The ERP rejected the stored credentials. Re-connect with your current ERP email and password in Settings.",
  AUTH_FAILED:
    "Could not establish an authorized ERP session. Your previously synchronized data is still being shown.",
  PARSE_FAILED:
    "Signed in to the ERP but its response could not be interpreted reliably. No data was changed. Your previously synchronized data is still being shown.",
  SYNC_IN_PROGRESS: "A synchronization is already running.",
  RATE_LIMITED: "Sync skipped to respect ERP rate limits. Try again shortly.",
  UNKNOWN: "An unexpected error occurred during synchronization.",
};
