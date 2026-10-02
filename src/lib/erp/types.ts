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
