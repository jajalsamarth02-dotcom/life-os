/**
 * Deadlines calendar (.ics) builder — RFC 5545 subset.
 *
 * Turns active ALA/assignment deadlines and dated reminders into a
 * standards-correct VCALENDAR that imports into Google Calendar, Apple
 * Calendar and Outlook. UIDs are derived from the stable ERP externalId
 * (or the local reminder id), so RE-IMPORTING a newer export updates the
 * same events instead of duplicating them.
 *
 * Formatting details that matter for real-world parsers:
 *  - CRLF line endings and 75-octet folding (continuation = space),
 *  - TEXT escaping for backslash / semicolon / comma / newlines,
 *  - UTC "Z" timestamps everywhere,
 *  - a 24-hour display VALARM on every FUTURE event (past events never
 *    alarm, so they are skipped there).
 */

export interface IcsEventInput {
  /** Globally unique, STABLE across exports: `<stable-key>@erp-sync`. */
  uid: string;
  /** SUMMARY — short, calendar-list friendly. */
  title: string;
  /** DESCRIPTION — plain text (escaped here). */
  description?: string | null;
  /** ISO timestamp of the deadline. */
  dueAt: string;
  /** Optional deep link (ERP assignment page) — goes to URL + DESCRIPTION. */
  url?: string | null;
}

export interface IcsResult {
  text: string;
  total: number;
  future: number;
  past: number;
}

/* ------------------------------------------------------------------ */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Date → basic-format UTC stamp, e.g. 20260716T120000Z. */
function icsStamp(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** RFC 5545 TEXT escaping. */
function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Fold content lines longer than 75 octets (approximated by code units). */
function fold(line: string): string {
  if (line.length <= 73) return line;
  const parts: string[] = [line.slice(0, 73)];
  let rest = line.slice(73);
  while (rest.length > 0) {
    parts.push(` ${rest.slice(0, 73)}`);
    rest = rest.slice(73);
  }
  return parts.join("\r\n");
}

/* ------------------------------------------------------------------ */

export function buildDeadlineIcs(events: IcsEventInput[], now: Date = new Date()): IcsResult {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ERP Sync//Student Deadlines//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:ERP Sync - deadlines",
    "X-WR-TIMEZONE:Asia/Kolkata",
  ];

  let future = 0;
  let past = 0;

  // Keep the file deterministic: chronological, then UID.
  const sorted = [...events].sort(
    (a, b) =>
      new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime() ||
      a.uid.localeCompare(b.uid)
  );

  for (const ev of sorted) {
    const due = new Date(ev.dueAt);
    if (Number.isNaN(due.getTime())) continue; // never emit a broken event
    const isFuture = due.getTime() >= now.getTime();
    if (isFuture) future += 1;
    else past += 1;

    const end = new Date(due.getTime() + 3600_000);
    const descParts: string[] = [];
    if (ev.description && ev.description.trim()) descParts.push(ev.description.trim());
    if (ev.url) descParts.push(`Open: ${ev.url}`);
    descParts.push("Exported by ERP Sync dashboard.");

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${esc(ev.uid)}`);
    lines.push(`DTSTAMP:${icsStamp(now)}`);
    lines.push(`DTSTART:${icsStamp(due)}`);
    lines.push(`DTEND:${icsStamp(end)}`);
    lines.push(`SUMMARY:${esc(ev.title)}`);
    lines.push(`DESCRIPTION:${esc(descParts.join("\n"))}`);
    if (ev.url) lines.push(`URL:${esc(ev.url)}`);
    lines.push("STATUS:CONFIRMED");
    if (isFuture) {
      lines.push("BEGIN:VALARM");
      lines.push("TRIGGER:-P1D");
      lines.push("ACTION:DISPLAY");
      lines.push("DESCRIPTION:Due in 24 hours");
      lines.push("END:VALARM");
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return { text: lines.map(fold).join("\r\n") + "\r\n", total: future + past, future, past };
}

/** Stable UID for an ERP-synced ALA row (externalId `erp:assign:<n>`). */
export function alaUid(externalId: string): string {
  return `${externalId.replace(/[^a-zA-Z0-9-]/g, "-")}@erp-sync`;
}

/** Stable UID for a local/synced reminder row. */
export function reminderUid(externalId: string | null, id: string): string {
  if (externalId) return `${externalId.replace(/[^a-zA-Z0-9-]/g, "-")}@erp-sync`;
  return `rem-${id}@erp-sync`;
}
