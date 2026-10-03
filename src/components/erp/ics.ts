/**
 * Deadlines calendar (.ics) builder — RFC 5545 subset.
 *
 * Turns active ALA/assignment deadlines, dated reminders AND the weekly
 * class routine into a standards-correct VCALENDAR that imports into
 * Google Calendar, Apple Calendar and Outlook. UIDs are derived from the
 * stable ERP externalId (or the local reminder id, or the class slot's
 * content), so RE-IMPORTING a newer export updates the same events instead
 * of duplicating them.
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
  /** ISO timestamp of the deadline (for weekly classes: the NEXT occurrence). */
  dueAt: string;
  /** Optional deep link (ERP assignment page) — goes to URL + DESCRIPTION. */
  url?: string | null;
  /** RRULE content, e.g. "FREQ=WEEKLY" — emitted after DTEND (non-TEXT, raw). */
  rrule?: string | null;
  /** Event length in minutes (deadlines default to 1 hour). */
  durationMin?: number;
  /** Emit DTSTART/DTEND as FLOATING wall times (IST wall clock, no "Z") so a
   *  recurring class always fires at the same wall time on the student's
   *  phone regardless of how calendar apps handle the timezone. */
  floating?: boolean;
  /** Set false to suppress the 24-hour VALARM (weekly classes carry none —
   *  a day-before ping for every class of the week is pure noise). */
  alarm?: boolean;
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

/** IST wall-clock offset in minutes (India does not observe DST). */
export const IST_OFFSET_MIN = 330;

/** Date → FLOATING local (IST wall clock) stamp, e.g. 20261010T110000 — no Z.
 *  Used for recurring class events so they repeat at the same wall time. */
function icsStampLocal(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MIN * 60_000);
  return (
    `${ist.getUTCFullYear()}${pad(ist.getUTCMonth() + 1)}${pad(ist.getUTCDate())}` +
    `T${pad(ist.getUTCHours())}${pad(ist.getUTCMinutes())}${pad(ist.getUTCSeconds())}`
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

export function buildDeadlineIcs(
  events: IcsEventInput[],
  now: Date = new Date(),
  /* r101: optional calendar-name override — the per-class export names the
     calendar after the class so it reads well if imported as its own calendar.
     The feed and Settings export keep the shared default. */
  opts?: { calendarName?: string }
): IcsResult {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ERP Sync//Student Deadlines//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(opts?.calendarName ?? "ERP Sync - classes & deadlines")}`,
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

    const durMin = ev.durationMin ?? 60;
    const end = new Date(due.getTime() + durMin * 60_000);
    const stampStart = ev.floating ? icsStampLocal(due) : icsStamp(due);
    const stampEnd = ev.floating ? icsStampLocal(end) : icsStamp(end);
    const descParts: string[] = [];
    if (ev.description && ev.description.trim()) descParts.push(ev.description.trim());
    if (ev.url) descParts.push(`Open: ${ev.url}`);
    descParts.push("Exported by ERP Sync dashboard.");

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${esc(ev.uid)}`);
    lines.push(`DTSTAMP:${icsStamp(now)}`);
    lines.push(`DTSTART:${stampStart}`);
    lines.push(`DTEND:${stampEnd}`);
    if (ev.rrule) lines.push(`RRULE:${ev.rrule}`);
    lines.push(`SUMMARY:${esc(ev.title)}`);
    lines.push(`DESCRIPTION:${esc(descParts.join("\n"))}`);
    if (ev.url) lines.push(`URL:${esc(ev.url)}`);
    lines.push("STATUS:CONFIRMED");
    if (isFuture && ev.alarm !== false) {
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

/* ------------------------------------------------------------------ */
/* Weekly class events (the synced ERP Class Routine)                  */
/* ------------------------------------------------------------------ */

/** Minimal slot shape — structurally the TimetableSlot row. */
export interface ClassSlotInput {
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
export function classSlotUid(s: ClassSlotInput): string {
  const p = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}${String(m % 60).padStart(2, "0")}`;
  const code = s.subjectCode.replace(/[^A-Za-z0-9-]+/g, "-");
  return `cls-${s.dayOfWeek}-${p(s.startMin)}-${p(s.endMin)}-${code}@erp-sync`;
}

/**
 * UTC instant of the NEXT occurrence of a weekly class at an IST wall time
 * (today counts if the start time is still ahead; otherwise next week).
 * IST is DST-free, so a fixed offset is exact here.
 */
export function nextWeeklyInstant(dayOfWeek: number, startMin: number, now: Date = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  const istNowMin = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  let ahead = (dayOfWeek - ist.getUTCDay() + 7) % 7;
  if (ahead === 0 && startMin <= istNowMin) ahead = 7;
  const wall = Date.UTC(
    ist.getUTCFullYear(),
    ist.getUTCMonth(),
    ist.getUTCDate() + ahead,
    Math.floor(startMin / 60),
    startMin % 60,
    0,
    0
  );
  return new Date(wall - IST_OFFSET_MIN * 60_000);
}

const DAY_NAMES_ICS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Pure builder for the weekly class events — the SHARED core of the live
 * feed (server) and the Settings one-shot export (client), so the two can
 * never drift apart in event identity (UID, time, recurrence).
 * `nameOf` resolves a subject display name; `null` falls back to the code.
 */
export function buildClassEvents(
  slots: ClassSlotInput[],
  nameOf: (code: string) => string | null,
  now: Date = new Date()
): IcsEventInput[] {
  const seen = new Set<string>();
  const out: IcsEventInput[] = [];
  for (const s of slots) {
    if (!Number.isInteger(s.dayOfWeek) || s.dayOfWeek < 0 || s.dayOfWeek > 6) continue;
    if (s.endMin <= s.startMin) continue;
    const uid = classSlotUid(s);
    if (seen.has(uid)) continue; // parallel batches can share the wall time
    seen.add(uid);
    const name = nameOf(s.subjectCode);
    out.push({
      uid,
      title: `[${s.subjectCode}] Class${name ? ` — ${name}` : ""}`,
      description: `Weekly class from the synced ERP class routine. Repeats every ${DAY_NAMES_ICS[s.dayOfWeek]} — the subscription keeps it current automatically.`,
      dueAt: nextWeeklyInstant(s.dayOfWeek, s.startMin, now).toISOString(),
      durationMin: s.endMin - s.startMin,
      rrule: "FREQ=WEEKLY",
      floating: true,
      alarm: false,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* r101 — per-class one-shot export ("Add to calendar" on a chip)       */
/* ------------------------------------------------------------------ */

/** File name for a single-class download: class-<code-slug>-<day>.ics. */
export function classIcsFilename(slot: ClassSlotInput): string {
  const slug =
    slot.subjectCode
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "class";
  const day = DAY_NAMES_ICS[slot.dayOfWeek]?.toLowerCase() ?? "weekly";
  return `class-${slug}-${day}.ics`;
}

/**
 * r101 — ONE weekly class as a standalone .ics for the timetable chip's
 * "Add to calendar" action.
 *
 * Event identity is NOT re-invented here: the event comes from
 * buildClassEvents (the SAME core the live /api/calendar feed uses), so the
 * downloaded event carries the feed's stable content-derived UID. A student
 * who imports this file and later subscribes to the feed UPDATES the same
 * event instead of duplicating it — the whole reason this builder exists
 * beside lib/ics.ts's whole-week export (which predates the feed's UID
 * convention and stays untouched for compatibility).
 *
 * Description is tailored for the one-shot context ("importing an updated
 * export updates this event" instead of the feed's "the subscription keeps
 * it current"), and the calendar is named after the class.
 *
 * Returns null for a slot the shared core rejects (bad day, end<=start) —
 * the UI toasts honestly instead of writing a broken file.
 */
export function buildSingleClassIcs(
  slot: ClassSlotInput,
  displayName: string | null,
  now: Date = new Date()
): { text: string; filename: string } | null {
  const wall = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const [ev] = buildClassEvents([slot], () => displayName, now);
  if (!ev) return null;
  const dayName = DAY_NAMES_ICS[slot.dayOfWeek];
  const tailored: IcsEventInput = {
    ...ev,
    description:
      `Weekly ${dayName} class (${wall(slot.startMin)}–${wall(slot.endMin)} IST)` +
      `${displayName ? ` — ${displayName}` : ""} from your ERP Sync timetable. Repeats every ${dayName}; ` +
      "importing an updated export updates this event instead of duplicating it.",
  };
  return {
    text: buildDeadlineIcs([tailored], now, { calendarName: `Class — ${slot.subjectCode}` }).text,
    filename: classIcsFilename(slot),
  };
}
