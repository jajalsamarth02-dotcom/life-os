/**
 * RFC 5545 (.ics) builder for the weekly timetable — pure functions, client-safe.
 *
 * Class times are emitted as FLOATING local times (no TZID / no Z suffix):
 * a timetable is a recurring weekly pattern, so each occurrence is interpreted
 * in whatever timezone the importing calendar app uses. DTSTART is anchored on
 * the next occurrence of the slot's weekday so the series starts immediately.
 *
 * r105 — ONE CALENDAR IDENTITY: both builders below now mint the SAME stable
 * UIDs as the live feed / Settings export / per-class palette downloads
 * (components/erp/ics.ts):
 *   • classes    → classSlotUid (content-derived: day + times + code) —
 *                  re-syncs replace slot ROWS wholesale, so a row-id UID
 *                  churned on every sync and duplicated the student's
 *                  calendar; a content UID survives and re-imports UPDATE.
 *   • reminders  → reminderUid (stable ERP externalId, row-id fallback).
 * The canonical pure UID builders live HERE (lib = the shared core the
 * components layer re-exports), so the two .ics generations can never
 * drift apart again.
 */

export interface IcsSlot {
  id: string;
  dayOfWeek: number; // 0 = Sunday … 6 = Saturday
  startMin: number;
  endMin: number;
  subjectCode: string;
  source: string;
}

export interface IcsSubject {
  code: string;
  name: string;
}

/** Date of the next occurrence of `dayOfWeek` (today counts if the class hasn't started yet). */
export function nextOccurrence(dayOfWeek: number, startMin: number, now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  let delta = (dayOfWeek - d.getDay() + 7) % 7;
  if (delta === 0 && nowMin >= startMin) delta = 7; // today's instance already started → next week
  d.setDate(d.getDate() + delta);
  return d;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Floating local datetime, e.g. 20261002T090000 (timetable weekly pattern). */
function icsLocal(d: Date, minutes: number): string {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `T${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}00`
  );
}

/** UTC datetime with Z suffix, e.g. 20261002T093000Z — absolute instants (deadlines). */
function icsUtc(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Fold a content line at 74 octets with CRLF + single space continuation (RFC 5545 §3.1). */
function fold(line: string): string {
  if (line.length <= 74) return line;
  const parts: string[] = [line.slice(0, 74)];
  let rest = line.slice(74);
  while (rest.length > 0) {
    parts.push(` ${rest.slice(0, 73)}`);
    rest = rest.slice(73);
  }
  return parts.join("\r\n");
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/* ------------------------------------------------------------------ */
/* r105 — canonical, stable event identities (moved here from           */
/* components/erp/ics.ts, which now re-exports these — ONE source).     */
/* ------------------------------------------------------------------ */

/** Minimal slot shape — structurally the TimetableSlot / ClassSlotInput row. */
export interface IcsClassSlot {
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  subjectCode: string;
}

/**
 * STABLE class UID derived from slot CONTENT (day, times, subject), never
 * from the row id: the sync engine replaces slot rows wholesale, so ids
 * churn while the actual schedule stays put. Same class → same UID →
 * re-imports and feed refreshes UPDATE instead of duplicating. If the ERP
 * genuinely moves a class, the UID changes and the subscribed calendar
 * drops the stale occurrence together with the feed refresh.
 */
export function classSlotUid(s: IcsClassSlot): string {
  const p = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}${String(m % 60).padStart(2, "0")}`;
  const code = s.subjectCode.replace(/[^A-Za-z0-9-]+/g, "-");
  return `cls-${s.dayOfWeek}-${p(s.startMin)}-${p(s.endMin)}-${code}@erp-sync`;
}

/**
 * STABLE UID for a local/synced reminder row: the ERP externalId when the
 * row has one (survives re-syncs and upserts), the row id otherwise
 * (personal reminders never churn — they are only ever edited in place).
 */
export function reminderUid(externalId: string | null, id: string): string {
  if (externalId) return `${externalId.replace(/[^a-zA-Z0-9-]/g, "-")}@erp-sync`;
  return `rem-${id}@erp-sync`;
}

/**
 * Build a complete VCALENDAR with one VEVENT per timetable slot.
 * `calendarName` shows up as the calendar title in most apps.
 *
 * r105: the VEVENT UID is now classSlotUid(slot) — the SAME identity the
 * calendar feed, the Settings export and the per-class palette download
 * mint for the same class. Importing this file and later subscribing to
 * the feed updates one event set instead of duplicating it.
 */
export function buildTimetableIcs(
  slots: IcsSlot[],
  subjects: IcsSubject[],
  calendarName = "Class timetable (ERP Sync)"
): string {
  const nameByCode = new Map(subjects.map((s) => [s.code, s.name]));
  const nowStamp = icsLocal(new Date(), new Date().getHours() * 60 + new Date().getMinutes());

  const sorted = [...slots].sort(
    (a, b) => a.dayOfWeek - b.dayOfWeek || a.startMin - b.startMin
  );

  const events = sorted.map((slot) => {
    const startDay = nextOccurrence(slot.dayOfWeek, slot.startMin);
    const endDay = nextOccurrence(slot.dayOfWeek, slot.endMin);
    const name = nameByCode.get(slot.subjectCode);
    const summary = name ? `${slot.subjectCode} · ${name}` : slot.subjectCode;
    const description =
      slot.source === "demo"
        ? "Seeded by the ERP Sync demo simulator."
        : "Added by you in ERP Sync (personal class).";
    return [
      "BEGIN:VEVENT",
      `UID:${classSlotUid(slot)}`,
      `DTSTAMP:${nowStamp}`,
      `DTSTART:${icsLocal(startDay, slot.startMin)}`,
      `DTEND:${icsLocal(endDay, slot.endMin)}`,
      "RRULE:FREQ=WEEKLY",
      `SUMMARY:${escapeText(summary)}`,
      `DESCRIPTION:${escapeText(description)}`,
      "STATUS:CONFIRMED",
      "TRANSP:OPAQUE",
      "END:VEVENT",
    ].map(fold).join("\r\n");
  });

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ERP Sync//Class Timetable//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

/** Trigger a browser download for a generated .ics file. Returns the filename. */
export function downloadTimetableIcs(
  slots: IcsSlot[],
  subjects: IcsSubject[]
): string {
  const d = new Date();
  const filename = `timetable-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.ics`;
  const blob = new Blob([buildTimetableIcs(slots, subjects)], {
    type: "text/calendar;charset=utf-8",
  });
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

/* ------------------------------------------------------------------ */
/* Reminder events (exams, deadlines) — one timed VEVENT each          */
/* ------------------------------------------------------------------ */

export interface IcsReminder {
  id: string;
  title: string;
  description: string | null;
  /** ISO timestamp of the deadline. */
  dueAt: string;
  /** Free-form category, e.g. EXAM / ASSIGNMENT / SUBMISSION. */
  type: string;
  source: string;
  /** Stable ERP key (`erp:assign:*` / `erp:warn:*`) when the row has one —
   *  r105: feeds reminderUid so synced rows keep their identity across
   *  re-syncs. Optional for call sites that predate the field. */
  externalId?: string | null;
}

/** Calendar block a deadline deserves, by reminder type. */
function durationMinutesFor(type: string): number {
  if (type === "EXAM" || type === "PRACTICAL_EXAM") return 120;
  if (type === "VIVA") return 60;
  return 30;
}

/**
 * Build a VCALENDAR of timed events from active reminders.
 *
 * TZ-aware: deadline due dates are absolute instants, so DTSTART/DTEND/DTSTAMP
 * are emitted in UTC (Z suffix). Calendar apps then render each deadline at the
 * correct local time regardless of the importing device's timezone — unlike the
 * weekly timetable export, which intentionally stays floating (recurring pattern
 * meant to follow whatever timezone the student is in).
 *
 * r105: VEVENT UIDs now come from reminderUid(externalId, id) — the SAME
 * identity the feed / Settings export mint. An ERP-sourced deadline imported
 * from here and later subscribed via the feed is ONE event, not two.
 */
export function buildRemindersIcs(
  reminders: IcsReminder[],
  calendarName = "Deadlines & exams (ERP Sync)"
): string {
  const nowStamp = icsUtc(new Date());

  const events = [...reminders]
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    .map((r) => {
      const start = new Date(r.dueAt);
      const end = new Date(start.getTime() + durationMinutesFor(r.type) * 60_000);
      const description = [
        r.description ?? "",
        r.source === "ERP" ? "Imported from the ERP." : "Personal reminder from ERP Sync.",
      ]
        .filter(Boolean)
        .join(" ");
      return [
        "BEGIN:VEVENT",
        `UID:${reminderUid(r.externalId ?? null, r.id)}`,
        `DTSTAMP:${nowStamp}`,
        `DTSTART:${icsUtc(start)}`,
        `DTEND:${icsUtc(end)}`,
        `SUMMARY:${escapeText(r.title)}`,
        `DESCRIPTION:${escapeText(description)}`,
        `CATEGORIES:${escapeText(r.type)}`,
        r.source === "ERP" ? "STATUS:CONFIRMED" : "STATUS:TENTATIVE",
        "TRANSP:OPAQUE",
        "END:VEVENT",
      ].map(fold).join("\r\n");
    });

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ERP Sync//Deadlines & Exams//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

/** Download active reminders as a .ics calendar file. Returns the filename. */
export function downloadRemindersIcs(
  reminders: IcsReminder[],
  calendarName = "Deadlines & exams (ERP Sync)"
): string {
  const d = new Date();
  const filename = `deadlines-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.ics`;
  const blob = new Blob([buildRemindersIcs(reminders, calendarName)], {
    type: "text/calendar;charset=utf-8",
  });
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
