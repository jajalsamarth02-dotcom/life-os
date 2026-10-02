/**
 * RFC 5545 (.ics) builder for the weekly timetable — pure functions, client-safe.
 *
 * Class times are emitted as FLOATING local times (no TZID / no Z suffix):
 * a timetable is a recurring weekly pattern, so each occurrence is interpreted
 * in whatever timezone the importing calendar app uses. DTSTART is anchored on
 * the next occurrence of the slot's weekday so the series starts immediately.
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

/** Floating local datetime, e.g. 20261002T090000 */
function icsLocal(d: Date, minutes: number): string {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `T${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}00`
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

/**
 * Build a complete VCALENDAR with one VEVENT per timetable slot.
 * `calendarName` shows up as the calendar title in most apps.
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
      `UID:erp-sync-slot-${slot.id}@erp-sync.local`,
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
export function downloadTimetableIcs(slots: IcsSlot[], subjects: IcsSubject[]): string {
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
