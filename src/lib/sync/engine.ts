import { db } from "@/lib/db";
import { createHash } from "crypto";
import {
  getSettings,
  getRawSetting,
  setRawSetting,
  isNotifyEnabled,
  ERP_SEMESTER_KEY,
  type AppSettings,
} from "@/lib/settings";
import { attendancePercentage, classesToReachTarget } from "@/lib/attendance";
import { fmtDateIST, fmtDateTimeIST } from "@/lib/ist";
import { compactErrorText } from "@/lib/compact-error";
import { fetchDemoSnapshot } from "@/lib/erp/demo";
import { fetchLiveSnapshot, isSubmissionComplete } from "@/lib/erp/live";
import { ERROR_COPY, ErpSnapshot, SyncError, SyncErrorCode } from "@/lib/erp/types";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { pruneSnapshots, recordSnapshots } from "@/lib/sync/history";
import { maybeAutoNotify } from "@/lib/notify/whatsapp";
import { maybeNtfyAutoNotify } from "@/lib/notify/ntfy";

/**
 * SYNC ENGINE
 *
 *   connector (live ERP | demo simulator)
 *     → change detection (diff against local DB)
 *     → update local database (never on parse failure — old data is kept)
 *     → recalculate derived attendance (always computed, never stored)
 *     → notifications + auto-managed attendance-warning reminders
 *     → SyncState / SyncLog bookkeeping
 */

const LOCK_KEY = "sync.lock";
const LOCK_STALE_MS = 3 * 60 * 1000;
/** Setting key holding the cached ERP course-code → course-name map (JSON). */
const COURSE_NAMES_KEY = "erp.courseNames";
/** Signature of the last applied class-routine slot set (avoids write churn). */
const ROUTINE_SIG_KEY = "erp.routineSig";
/** ExternalId prefix for ERP-synced ALA/assignment reminders. */
export const ASSIGNMENT_EXT_PREFIX = "erp:assign:";

export interface SyncOutcome {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  mode?: "live" | "demo" | "none";
  changes?: number;
  errorCode?: SyncErrorCode;
  message?: string;
}

export async function getSyncState() {
  return db.syncState.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
}

async function acquireLock(): Promise<boolean> {
  const raw = await getRawSetting(LOCK_KEY);
  if (raw) {
    const t = new Date(raw).getTime();
    if (!Number.isNaN(t) && Date.now() - t < LOCK_STALE_MS) return false;
  }
  await setRawSetting(LOCK_KEY, new Date().toISOString());
  return true;
}

async function releaseLock(): Promise<void> {
  await setRawSetting(LOCK_KEY, "");
}

function backoffMinutes(baseMinutes: number, failures: number): number {
  return Math.min(baseMinutes * Math.pow(2, Math.min(failures, 5)), 720);
}

/**
 * Create an in-app notification — unless the user switched this type off in
 * Settings → Notifications. Existing notifications are never retroactively
 * hidden; preferences apply to future events only.
 */
async function notify(
  type: string,
  title: string,
  message: string,
  severity: "info" | "success" | "warning" | "critical" = "info"
) {
  const prefs = (await getSettings()).notifyPrefs;
  if (!isNotifyEnabled(prefs, type)) return;
  await db.notification.create({ data: { type, title, message, severity } });
}

async function changeEvent(kind: string, subjectCode: string | null, detail: string) {
  await db.changeEvent.create({ data: { kind, subjectCode, detail } });
}

/** Decide which connector to use and fetch a snapshot. */
async function fetchSnapshot(
  trigger: "scheduled" | "manual" | "startup"
): Promise<{ snapshot: ErpSnapshot; mode: "live" | "demo" }> {
  const settings = await getSettings();

  if (settings.demoMode) {
    return { snapshot: await fetchDemoSnapshot(false), mode: "demo" };
  }

  const conn = await db.erpConnection.findFirst({ orderBy: { createdAt: "desc" } });
  if (!conn) {
    throw new SyncError("NO_CONNECTION", ERROR_COPY.NO_CONNECTION);
  }

  // Rate-limit protection for the real ERP (manual syncs are never throttled).
  if (trigger === "scheduled") {
    const state = await getSyncState();
    const gap = settings.minLiveSyncGapMinutes * 60 * 1000;
    if (state.lastSyncAt && Date.now() - state.lastSyncAt.getTime() < gap) {
      throw new SyncError("RATE_LIMITED", ERROR_COPY.RATE_LIMITED);
    }
  }

  let password: string;
  let savedCookie: string | null = null;
  try {
    password = decryptSecret(conn.secretEnc);
    if (conn.sessionCookieEnc) savedCookie = decryptSecret(conn.sessionCookieEnc);
  } catch {
    throw new SyncError("UNKNOWN", "Stored credentials could not be decrypted (key changed?).");
  }

  // Cached course-code → course-name pairs (from assignment detail pages).
  // Unknown codes are resolved lazily during the sync, a couple per run at
  // most, to stay gentle on the ERP (spec #8).
  let knownCourseNames: Record<string, string> = {};
  try {
    const raw = await getRawSetting(COURSE_NAMES_KEY);
    if (raw) knownCourseNames = JSON.parse(raw);
  } catch {
    knownCourseNames = {};
  }

  const result = await fetchLiveSnapshot(conn.username, password, savedCookie, {
    knownCourseNames,
    // Manual/startup syncs may resolve more names at once; scheduled ones
    // resolve at most two per run.
    courseNameBudget: trigger === "scheduled" ? 2 : 8,
  });
  if (result.sessionCookie) {
    // persist refreshed session so future syncs avoid re-login (gentle on the ERP)
    await db.erpConnection.update({
      where: { id: conn.id },
      data: { sessionCookieEnc: encryptSecret(result.sessionCookie) },
    });
  }
  const mergedNames = result.snapshot?.courseNames ?? {};
  if (Object.keys(mergedNames).length > 0 && JSON.stringify(mergedNames) !== JSON.stringify(knownCourseNames)) {
    await setRawSetting(COURSE_NAMES_KEY, JSON.stringify(mergedNames));
  }
  return { snapshot: result.snapshot!, mode: "live" };
}

export async function runSync(
  trigger: "scheduled" | "manual" | "startup"
): Promise<SyncOutcome> {
  if (!(await acquireLock())) {
    return { ok: false, skipped: true, reason: "A synchronization is already running.", errorCode: "SYNC_IN_PROGRESS" };
  }

  const startedAt = Date.now();
  const log = await db.syncLog.create({
    data: { status: "running", trigger, mode: "none" },
  });
  await db.syncState.upsert({
    where: { id: "singleton" },
    update: { status: "syncing" },
    create: { id: "singleton", status: "syncing" },
  });

  try {
    const settings = await getSettings();
    const stateBefore = await getSyncState();
    const prevFailures = stateBefore.consecutiveFailures;
    const { snapshot, mode } = await fetchSnapshot(trigger);

    const changes = await applySnapshot(snapshot, settings);
    await recordSnapshots(mode);
    void pruneSnapshots();
    const now = new Date();

    await db.syncState.upsert({
      where: { id: "singleton" },
      update: {
        status: "idle",
        mode,
        lastSyncAt: now,
        lastSuccessAt: now,
        consecutiveFailures: 0,
        lastErrorCode: null,
        lastErrorMessage: null,
        nextScheduledSyncAt: new Date(now.getTime() + settings.syncIntervalMinutes * 60 * 1000),
      },
      create: { id: "singleton", status: "idle", mode },
    });

    // If live sync succeeded, the demo simulator is no longer needed.
    if (mode === "live" && settings.demoMode) {
      await setRawSetting(
        "app.settings",
        JSON.stringify({ ...settings, demoMode: false })
      );
    }

    if (changes > 0) {
      await notify(
        "ERP_CHANGE",
        "ERP data updated",
        `Synchronized from ${mode === "demo" ? "the demo ERP" : "the college ERP"}: ${changes} change${changes === 1 ? "" : "s"} applied.`,
        "info"
      );
    } else if (mode === "live" && prevFailures > 0) {
      await notify("SYNC_SUCCESS", "ERP connection restored", "Live synchronization succeeded again.", "success");
    }

    await db.syncLog.update({
      where: { id: log.id },
      data: {
        status: "success",
        mode,
        changes,
        durationMs: Date.now() - startedAt,
        finishedAt: new Date(),
        summary: `${changes} change${changes === 1 ? "" : "s"} applied`,
      },
    });

    // refresh notifications badge etc. — nothing else to do
    // (Auto-digests on both channels: only after scheduled syncs, each
    // independently throttled inside its own module.)
    if (trigger === "scheduled") {
      void maybeAutoNotify();
      void maybeNtfyAutoNotify();
    }
    return { ok: true, mode, changes, message: `Sync complete — ${changes} change${changes === 1 ? "" : "s"}.` };
  } catch (err) {
    const syncErr =
      err instanceof SyncError
        ? err
        : new SyncError(
            "UNKNOWN",
            compactErrorText(err instanceof Error ? err.message : String(err))
          );

    const settings = await getSettings();
    const state = await getSyncState();
    const failures = state.consecutiveFailures + 1;
    const now = new Date();
    const nextAt = new Date(
      now.getTime() + backoffMinutes(settings.syncIntervalMinutes, failures) * 60 * 1000
    );

    await db.syncState.upsert({
      where: { id: "singleton" },
      update: {
        status: "failed",
        mode: state.mode === "none" ? "none" : state.mode,
        lastSyncAt: now,
        consecutiveFailures: failures,
        lastErrorCode: syncErr.code,
        lastErrorMessage: syncErr.message,
        nextScheduledSyncAt: nextAt,
      },
      create: {
        id: "singleton",
        status: "failed",
        lastSyncAt: now,
        consecutiveFailures: failures,
        lastErrorCode: syncErr.code,
        lastErrorMessage: syncErr.message,
        nextScheduledSyncAt: nextAt,
      },
    });

    if (syncErr.code === "INVALID_CREDENTIALS") {
      await db.erpConnection.updateMany({ data: { status: "failed", lastError: syncErr.message } });
    }

    if (failures === 1 || syncErr.code === "INVALID_CREDENTIALS") {
      await notify(
        "SYNC_FAILURE",
        "ERP Sync Failed",
        `${syncErr.message}\n\nLast successful sync: ${
          state.lastSuccessAt ? formatDateTime(state.lastSuccessAt) : "never"
        }. Your previously synchronized data is still being shown.`,
        failures >= 3 ? "critical" : "warning"
      );
    }

    await db.syncLog.update({
      where: { id: log.id },
      data: {
        status: "failed",
        mode: syncErr.code === "NO_CONNECTION" ? "none" : undefined,
        durationMs: Date.now() - startedAt,
        finishedAt: new Date(),
        errorDetails: `${syncErr.code}: ${syncErr.message}${syncErr.details ? ` — ${syncErr.details}` : ""}`,
      },
    });

    return { ok: false, errorCode: syncErr.code, message: syncErr.message };
  } finally {
    await releaseLock();
  }
}

/**
 * Diff a fresh snapshot against local data; apply only actual changes.
 * Returns the number of changes applied.
 */
async function applySnapshot(snapshot: ErpSnapshot, settings: AppSettings): Promise<number> {
  let changes = 0;
  const previous = await db.subject.findMany({ where: { active: true } });
  const prevByCode = new Map(previous.map((s) => [s.code, s]));

  // --- subjects ---
  for (const s of snapshot.subjects) {
    const prev = prevByCode.get(s.code);
    // Semester: the row's own value wins, else the page-level current semester.
    const semester = s.semester ?? snapshot.currentSemester ?? null;
    if (!prev) {
      const existedInactive = await db.subject.findUnique({ where: { code: s.code } });
      if (existedInactive) {
        await db.subject.update({
          where: { id: existedInactive.id },
          data: { name: s.name, present: s.present, total: s.total, semester, active: true },
        });
      } else {
        await db.subject.create({
          data: { code: s.code, name: s.name, present: s.present, total: s.total, semester },
        });
      }
      await changeEvent("SUBJECT_ADDED", s.code, `${s.name} — ${s.present}/${s.total} classes${semester ? ` · Sem ${semester}` : ""}`);
      changes++;
    } else if (prev.present !== s.present || prev.total !== s.total || prev.name !== s.name) {
      await db.subject.update({
        where: { id: prev.id },
        data: { name: s.name, present: s.present, total: s.total, semester },
      });
      const oldPct = attendancePercentage(prev.present, prev.total);
      const newPct = attendancePercentage(s.present, s.total);
      await changeEvent(
        "ATTENDANCE_UPDATED",
        s.code,
        `${s.name}: Present ${prev.present}→${s.present}, Total ${prev.total}→${s.total} (${oldPct.toFixed(2)}% → ${newPct.toFixed(2)}%)`
      );
      changes++;
    } else if (prev.semester !== semester) {
      // Semester metadata arrived/changed without any attendance difference —
      // update quietly (the partition itself is not an "ERP data change").
      await db.subject.update({ where: { id: prev.id }, data: { semester } });
    }
  }

  // Remember the ERP-detected current semester so Settings can offer it
  // as a one-tap partition choice.
  if (typeof snapshot.currentSemester === "number" && snapshot.currentSemester >= 1 && snapshot.currentSemester <= 8) {
    const stored = await getRawSetting(ERP_SEMESTER_KEY);
    if (stored !== String(snapshot.currentSemester)) {
      await setRawSetting(ERP_SEMESTER_KEY, String(snapshot.currentSemester));
    }
  }

  // --- removals (only when the snapshot is a complete view) ---
  if (snapshot.complete) {
    for (const prev of previous) {
      if (!snapshot.subjects.some((s) => s.code === prev.code)) {
        await db.subject.update({ where: { id: prev.id }, data: { active: false } });
        await changeEvent("SUBJECT_REMOVED", prev.code, `${prev.name} no longer on the ERP`);
        changes++;
        // its auto-managed warning reminder has no subject left to describe
        const warn = await db.reminder.findUnique({ where: { externalId: `erp:warn:${prev.code}` } });
        if (warn) await db.reminder.delete({ where: { id: warn.id } });
      }
    }
  }

  // --- warnings + auto-managed ATTENDANCE_WARNING reminders ---
  await recomputeAttendanceWarnings(settings.targetPercentage, {
    prevByCode,
    subjectTargets: settings.subjectTargets,
  });

  // --- ERP reminders (exams, assignments, ...) — dedup via externalId ---
  const seenExternal = new Set<string>();
  for (const r of snapshot.reminders) {
    if (r.type === "ATTENDANCE_WARNING") continue; // managed above
    seenExternal.add(r.externalId);
    const existing = await db.reminder.findUnique({ where: { externalId: r.externalId } });
    const dueAt = new Date(r.dueAt);
    if (!existing) {
      await db.reminder.create({
        data: {
          source: "ERP",
          externalId: r.externalId,
          type: r.type,
          title: r.title,
          description: r.description,
          dueAt,
        },
      });
      await changeEvent("REMINDER_UPSERTED", null, `${r.title} — ${formatDateTime(dueAt)}`);
      changes++;
    } else {
      const dueChanged = existing.dueAt.getTime() !== dueAt.getTime();
      const metaChanged =
        existing.title !== r.title || existing.description !== r.description || existing.type !== r.type;
      if (dueChanged || metaChanged) {
        const oldDue = existing.dueAt;
        await db.reminder.update({
          where: { id: existing.id },
          data: { type: r.type, title: r.title, description: r.description, dueAt },
        });
        if (dueChanged) {
          await changeEvent(
            "REMINDER_DATE_CHANGED",
            null,
            `${r.title}: ${formatDateTime(oldDue)} → ${formatDateTime(dueAt)}`
          );
          await notify(
            "REMINDER_CHANGE",
            "Deadline updated by ERP",
            `${r.title} moved from ${formatDateTime(oldDue)} to ${formatDateTime(dueAt)}.`,
            "warning"
          );
        }
        changes++;
      }
    }
  }

  // remove ERP reminders that disappeared from a complete snapshot (ACTIVE only).
  // ALA/assignment rows carry the erp:assign: prefix and are managed by the
  // dedicated block below (they have their own completeness signal).
  if (snapshot.complete) {
    const erpReminders = await db.reminder.findMany({ where: { source: "ERP" } });
    for (const e of erpReminders) {
      if (e.type === "ATTENDANCE_WARNING") continue;
      if ((e.externalId ?? "").startsWith(ASSIGNMENT_EXT_PREFIX)) continue;
      if (!seenExternal.has(e.externalId ?? "") && e.status === "ACTIVE") {
        await db.reminder.delete({ where: { id: e.id } });
        await changeEvent("REMINDER_REMOVED", null, `${e.title} — no longer on the ERP`);
        changes++;
      }
    }
  }

  // --- ERP assignments (ALA) — one ASSIGNMENT reminder per row, dedup via
  //     externalId `erp:assign:{id}`. The ERP's own Submission Status drives
  //     ACTIVE/DONE (read-only mirror, spec #14); dueAt is the End Date —
  //     the "last date" the student must submit by.
  if ((snapshot.assignments?.length ?? 0) > 0) {
    const firstImport =
      (await db.reminder.count({ where: { externalId: { startsWith: ASSIGNMENT_EXT_PREFIX } } })) === 0;
    let created = 0;
    const seenAssign = new Set<string>();
    for (const a of snapshot.assignments!) {
      const externalId = `${ASSIGNMENT_EXT_PREFIX}${a.externalId}`;
      seenAssign.add(externalId);
      const completed = isSubmissionComplete(a.submissionStatus, a.approvalStatus);
      const status = completed ? "DONE" : "ACTIVE";
      // Date-only from the ERP → store mid-day UTC so the calendar date is
      // displayed identically in any timezone and the item only turns overdue
      // late on the last date.
      const dueAt = new Date(`${a.endDate}T12:00:00Z`);
      const descriptionBits = [
        `Submission: ${a.submissionStatus}`,
        a.approvalStatus ? `Approval: ${a.approvalStatus}` : null,
        a.startDate ? `Start: ${a.startDate}` : null,
        a.session ? `Session: ${a.session}` : null,
      ].filter((x): x is string => !!x);
      const description = descriptionBits.join(" · ");

      const existing = await db.reminder.findUnique({ where: { externalId } });
      if (!existing) {
        await db.reminder.create({
          data: {
            source: "ERP",
            externalId,
            type: "ASSIGNMENT",
            title: a.title,
            description,
            subjectCode: a.courseCode,
            dueAt,
            status,
          },
        });
        created++;
        changes++;
      } else {
        const dueChanged = existing.dueAt.getTime() !== dueAt.getTime();
        const metaChanged =
          existing.title !== a.title ||
          existing.description !== description ||
          existing.subjectCode !== a.courseCode;
        const statusChanged = existing.status !== status && existing.status !== "DISMISSED";
        if (dueChanged || metaChanged || statusChanged) {
          await db.reminder.update({
            where: { id: existing.id },
            data: { title: a.title, description, subjectCode: a.courseCode, dueAt, status },
          });
          if (statusChanged) {
            await changeEvent(
              "REMINDER_UPSERTED",
              a.courseCode,
              `${a.title} (${a.courseCode}) — ${completed ? "marked Submitted" : "back to Pending"} on the ERP`
            );
          }
          if (dueChanged) {
            await changeEvent(
              "REMINDER_DATE_CHANGED",
              a.courseCode,
              `${a.title} (${a.courseCode}): last date ${formatDate(existing.dueAt)} → ${formatDate(dueAt)}`
            );
            await notify(
              "REMINDER_CHANGE",
              "Deadline updated by ERP",
              `${a.title} (${a.courseCode}) last date moved from ${formatDate(existing.dueAt)} to ${formatDate(dueAt)}.`,
              "warning"
            );
          }
          if (!statusChanged && !dueChanged) changes++; // quiet metadata refresh
        }
      }
    }

    if (created > 0) {
      await changeEvent(
        "REMINDER_UPSERTED",
        null,
        `${created} ALA/assignment row${created === 1 ? "" : "s"} ${firstImport ? "imported" : "added"} from the ERP Assignments page`
      );
    }

    // Removal — only when the Assignments page itself loaded fully this run.
    if (snapshot.assignmentsComplete) {
      const assignReminders = await db.reminder.findMany({
        where: { source: "ERP", externalId: { startsWith: ASSIGNMENT_EXT_PREFIX } },
      });
      for (const e of assignReminders) {
        if (!seenAssign.has(e.externalId ?? "") && e.status === "ACTIVE") {
          await db.reminder.delete({ where: { id: e.id } });
          await changeEvent("REMINDER_REMOVED", null, `${e.title} — no longer on the ERP Assignments page`);
          changes++;
        }
      }
    }
  }

  // --- Class routine (weekly timetable from the ERP's Class Routine page) ---
  // The ERP routine is the authoritative schedule: replace every sync-owned
  // slot (source "erp" AND legacy stale "demo" rows) with the parsed set,
  // but only when the applied set actually changed — so a stable week costs
  // zero writes on the 15-minute cadence. PERSONAL slots the student added
  // themselves are never touched. Safety rails: slots whose subject has no
  // ACTIVE Subject row are held back (the attendance sync will create the
  // subject, then the next sync applies them — nothing is invented); an
  // empty filtered set (page down / structure change) skips the whole block
  // and keeps existing slots.
  if (snapshot.routine && snapshot.routine.length > 0) {
    const activeCodes = new Set(
      (
        await db.subject.findMany({
          where: { active: true },
          select: { code: true },
        })
      ).map((s) => s.code)
    );
    const applied = snapshot.routine.filter((s) => activeCodes.has(s.subjectCode));
    if (applied.length > 0) {
      const sorted = [...applied].sort(
        (a, b) =>
          a.dayOfWeek - b.dayOfWeek ||
          a.startMin - b.startMin ||
          a.endMin - b.endMin ||
          a.subjectCode.localeCompare(b.subjectCode)
      );
      const sig = createHash("sha256").update(JSON.stringify(sorted)).digest("hex").slice(0, 16);
      const storedSig = await getRawSetting(ROUTINE_SIG_KEY);
      const syncOwned = await db.timetableSlot.count({ where: { source: { in: ["demo", "erp"] } } });
      if (sig !== storedSig || syncOwned !== sorted.length) {
        await db.timetableSlot.deleteMany({ where: { source: { in: ["demo", "erp"] } } });
        await db.timetableSlot.createMany({
          data: sorted.map((s) => ({
            dayOfWeek: s.dayOfWeek,
            startMin: s.startMin,
            endMin: s.endMin,
            subjectCode: s.subjectCode,
            source: "erp",
          })),
        });
        await setRawSetting(ROUTINE_SIG_KEY, sig);
        changes += sorted.length;
        const held = snapshot.routine.length - applied.length;
        const unknown = snapshot.routineUnknown ?? [];
        const notes: string[] = [];
        if (held > 0) notes.push(`${held} slot(s) held back — subject not in the active list yet`);
        if (unknown.length > 0) notes.push(`unresolved course name(s): ${unknown.join("; ")}`);
        if (notes.length > 0) console.log(`[erp-sync] routine: ${sorted.length} slots synced (${notes.join(" · ")})`);
      }
    }
  }

  return changes;
}

/**
 * Recalculate per-subject warnings without contacting the ERP. Each subject is
 * measured against its own effective target (per-subject override when set,
 * otherwise the global target). Used after syncs and whenever the user changes
 * the global target or a per-subject override.
 */
export async function recomputeAttendanceWarnings(
  targetPct: number,
  opts?: {
    prevByCode?: Map<string, { present: number; total: number }>;
    subjectTargets?: Record<string, number>;
  }
): Promise<void> {
  const overrides = opts?.subjectTargets ?? {};
  const activeSubjects = await db.subject.findMany({ where: { active: true } });
  for (const sub of activeSubjects) {
    if (sub.total <= 0) continue;
    const override = overrides[sub.code];
    const effectiveTargetPct =
      typeof override === "number" && Number.isFinite(override) ? override : targetPct;
    const pct = attendancePercentage(sub.present, sub.total);
    const below = pct < effectiveTargetPct;
    const prevRow = opts?.prevByCode?.get(sub.code);
    const wasBelow =
      prevRow && prevRow.total > 0
        ? attendancePercentage(prevRow.present, prevRow.total) < effectiveTargetPct
        : false;

    if (below && !wasBelow) {
      const need = classesToReachTarget(sub.present, sub.total, effectiveTargetPct);
      await notify(
        "ATTENDANCE_WARNING",
        `Attendance Alert — ${sub.name}`,
        `${sub.name} attendance is now ${pct.toFixed(2)}%.\nTarget: ${effectiveTargetPct}%${override != null ? " (custom for this subject)" : ""}.\nYou need to attend the next ${need} class${need === 1 ? "" : "es"} to reach the target.`,
        pct < effectiveTargetPct - 10 ? "critical" : "warning"
      );
    }

    const externalId = `erp:warn:${sub.code}`;
    const warnReminder = await db.reminder.findUnique({ where: { externalId } });
    if (below) {
      const need = classesToReachTarget(sub.present, sub.total, effectiveTargetPct);
      const dueAt = endOfToday();
      const description = `${pct.toFixed(2)}% vs ${effectiveTargetPct}% target${override != null ? " (custom)" : ""}. Attend the next ${need} class${need === 1 ? "" : "es"}.`;
      if (!warnReminder) {
        await db.reminder.create({
          data: {
            source: "ERP",
            externalId,
            type: "ATTENDANCE_WARNING",
            title: `Attendance below target — ${sub.name}`,
            description,
            subjectCode: sub.code,
            dueAt,
          },
        });
      } else {
        await db.reminder.update({
          where: { id: warnReminder.id },
          data: {
            title: `Attendance below target — ${sub.name}`,
            description,
            subjectCode: sub.code,
            dueAt,
          },
        });
      }
    } else if (warnReminder) {
      await db.reminder.delete({ where: { id: warnReminder.id } });
    }
  }
}

function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Compact date-only rendering for deadline change messages.
 *  r99: moved to lib/ist — a UTC server shifted every delivered time by -5:30. */
function formatDate(d: Date): string {
  return fmtDateIST(d);
}

function formatDateTime(d: Date): string {
  return fmtDateTimeIST(d);
}

/** Called by the background scheduler once a minute. */
export async function syncIfDue(): Promise<SyncOutcome | null> {
  try {
    const settings = await getSettings();
    if (!settings.autoSyncEnabled) return null;
    const state = await getSyncState();
    if (state.status === "syncing") return null;
    const hasConn = (await db.erpConnection.count()) > 0;
    if (!hasConn && !settings.demoMode) return null; // nothing to sync from
    const dueAt = state.nextScheduledSyncAt?.getTime();
    if (dueAt && Date.now() < dueAt) return null;
    return await runSync("scheduled");
  } catch {
    // DB might not be ready during boot — the next tick will retry.
    return null;
  }
}
