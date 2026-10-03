import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { ASSIGNMENT_EXT_PREFIX } from "@/lib/sync/engine";
import { withSubjectMeta } from "@/lib/reminders";
import { applyBatchPicks, BATCH_PICKS_KEY, parseBatchPicks, validatePicks } from "@/lib/batch-picks";
import { alaUid, buildClassEvents, buildDeadlineIcs, reminderUid, type IcsEventInput } from "@/components/erp/ics";

/**
 * LIVE calendar subscription feed (server-side twin of the Settings export).
 *
 * The settings tab exports a one-shot .ics download; THIS module serves the
 * same event set at GET /api/calendar?token=… so the student can SUBSCRIBE
 * from Google/Apple/Outlook calendar and let the phone auto-refresh
 * deadlines — no manual re-export, ever.
 *
 * Because both paths share buildDeadlineIcs() and the SAME stable UIDs
 * (derived from erp:assign:<n> / reminder ids), a subscribed calendar
 * receives UPDATES to existing events instead of duplicates when a sync
 * moves a deadline or the ERP adds/cancels work.
 *
 * Access: the feed URL itself is the secret. The token is a 24-char
 * base64url random stored in Setting "calendar.ics.token"; requests without
 * the exact token get a bland 404 (no existence leak). Rotating the token
 * instantly invalidates every previously-shared URL. The dashboard pages
 * themselves stay open like every other page of this personal app — the
 * token protects the copy-paste-into-external-services artifact.
 */

export const CALENDAR_TOKEN_KEY = "calendar.ics.token";

const SETTING_COURSE_NAMES = "erp.courseNames";

export interface CalendarFeedResult {
  text: string;
  total: number;
  future: number;
  past: number;
}

/* ------------------------------------------------------------------ */
/* Token management                                                    */
/* ------------------------------------------------------------------ */

export async function getCalendarToken(): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key: CALENDAR_TOKEN_KEY } });
  const t = row?.value?.trim();
  return t ? t : null;
}

/** Create the first token. Returns null if one already exists (use rotate). */
export async function createCalendarToken(): Promise<string | null> {
  const existing = await getCalendarToken();
  if (existing) return null;
  const token = randomBytes(24).toString("base64url");
  await db.setting.upsert({ where: { key: CALENDAR_TOKEN_KEY }, create: { key: CALENDAR_TOKEN_KEY, value: token }, update: {} });
  return token;
}

/** Replace the token — every previously shared subscription URL stops working. */
export async function rotateCalendarToken(): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await db.setting.upsert({ where: { key: CALENDAR_TOKEN_KEY }, create: { key: CALENDAR_TOKEN_KEY, value: token }, update: { value: token } });
  return token;
}

/** Remove the token entirely — the feed 404s until a new link is created. */
export async function deleteCalendarToken(): Promise<void> {
  await db.setting.deleteMany({ where: { key: CALENDAR_TOKEN_KEY } });
}

/** Constant-shape comparison to keep timing side channels boring. */
function tokenMatches(provided: string | null, saved: string): boolean {
  if (!provided || provided.length !== saved.length) return false;
  let diff = 0;
  for (let i = 0; i < saved.length; i++) diff |= provided.charCodeAt(i) ^ saved.charCodeAt(i);
  return diff === 0;
}

export async function isCalendarTokenValid(provided: string | null): Promise<boolean> {
  const saved = await getCalendarToken();
  if (!saved) return false;
  return tokenMatches(provided, saved);
}

/* ------------------------------------------------------------------ */
/* Feed builder — mirrors the Settings export's event set EXACTLY      */
/* ------------------------------------------------------------------ */

/** Mirror of shared.tsx erpAssignmentUrl (kept local: shared.tsx is a client module). */
function erpAssignmentUrlOf(externalId: string): string | null {
  if (!externalId.startsWith(ASSIGNMENT_EXT_PREFIX)) return null;
  const id = externalId.slice(ASSIGNMENT_EXT_PREFIX.length);
  return /^\d+$/.test(id) ? `https://erp.gmiu.edu.in/student/assignment/${id}` : null;
}

export async function buildCalendarFeed(now: Date = new Date()): Promise<CalendarFeedResult> {
  const [rows, namesRow, subjectRows] = await Promise.all([
    db.reminder.findMany({ where: { status: "ACTIVE" }, orderBy: { dueAt: "asc" }, take: 1000 }),
    db.setting.findUnique({ where: { key: SETTING_COURSE_NAMES } }),
    db.subject.findMany({ select: { code: true, name: true } }),
  ]);

  let courseNames: Record<string, string> = {};
  try {
    courseNames = namesRow ? (JSON.parse(namesRow.value) as Record<string, string>) : {};
  } catch {
    courseNames = {};
  }
  const subjectNameByCode = new Map(subjectRows.map((s) => [s.code, s.name]));

  const metaRows = await withSubjectMeta(rows);
  const meta = new Map(metaRows.map((r) => [r.id, r]));

  const items: IcsEventInput[] = [];
  const seen = new Set<string>();

  // Pass 1 — ERP ALA/assignment rows (same selection the assignments API uses).
  for (const r of rows) {
    if (r.source !== "ERP" || r.type !== "ASSIGNMENT") continue;
    if (!r.externalId || !r.externalId.startsWith(ASSIGNMENT_EXT_PREFIX)) continue;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const m = meta.get(r.id);
    const subject = m?.subjectName ?? (r.subjectCode ? subjectNameByCode.get(r.subjectCode) ?? courseNames[r.subjectCode] ?? null : null);
    items.push({
      uid: alaUid(r.externalId),
      title: r.subjectCode ? `[${r.subjectCode}] ${r.title}` : r.title,
      description: subject
        ? `ALA / assignment deadline from the ERP.\nSubject: ${subject}`
        : "ALA / assignment deadline from the ERP.",
      dueAt: r.dueAt.toISOString(),
      url: erpAssignmentUrlOf(r.externalId),
    });
  }

  // Pass 2 — every other ACTIVE reminder; ALA rows are already covered above.
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    if (r.externalId?.startsWith(ASSIGNMENT_EXT_PREFIX)) continue;
    const m = meta.get(r.id);
    const kind = r.source === "PERSONAL" ? "Personal reminder" : "From the ERP";
    items.push({
      uid: reminderUid(r.externalId, r.id),
      title: r.subjectCode ? `[${r.subjectCode}] ${r.title}` : r.title,
      description: [kind, r.description?.trim() || null, m?.subjectName ? `Subject: ${m.subjectName}` : null]
        .filter(Boolean)
        .join("\n"),
      dueAt: r.dueAt.toISOString(),
      url: null,
    });
  }

  // Pass 3 — weekly class slots from the synced ERP Class Routine (RRULE
  // FREQ=WEEKLY, floating IST wall times, no alarms). Shares buildClassEvents
  // AND the batch-pick math with the Settings one-shot export so event
  // identity (UID, time, rule) and the EVENT SET can never drift between the
  // two paths: same-batch duplicates collapsed, parallel windows trimmed to
  // the student's picks (validated against the current routine — stale picks
  // from a resync drop out silently). Dedupe lives inside the builder too.
  const [slotRows, picksRow] = await Promise.all([
    db.timetableSlot.findMany({ orderBy: [{ dayOfWeek: "asc" }, { startMin: "asc" }] }),
    db.setting.findUnique({ where: { key: BATCH_PICKS_KEY } }),
  ]);
  const picks = validatePicks(parseBatchPicks(picksRow?.value), slotRows);
  items.push(
    ...buildClassEvents(
      applyBatchPicks(slotRows, picks).attending,
      (code) => subjectNameByCode.get(code) ?? courseNames[code] ?? null,
      now
    )
  );

  return buildDeadlineIcs(items, now);
}
