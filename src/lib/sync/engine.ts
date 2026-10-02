import { db } from "@/lib/db";
import { getSettings, getRawSetting, setRawSetting, isNotifyEnabled, type AppSettings } from "@/lib/settings";
import { attendancePercentage, classesToReachTarget } from "@/lib/attendance";
import { fetchDemoSnapshot } from "@/lib/erp/demo";
import { fetchLiveSnapshot } from "@/lib/erp/live";
import { ERROR_COPY, ErpSnapshot, SyncError, SyncErrorCode } from "@/lib/erp/types";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { pruneSnapshots, recordSnapshots } from "@/lib/sync/history";

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

  const result = await fetchLiveSnapshot(conn.username, password, savedCookie);
  if (result.sessionCookie) {
    // persist refreshed session so future syncs avoid re-login (gentle on the ERP)
    await db.erpConnection.update({
      where: { id: conn.id },
      data: { sessionCookieEnc: encryptSecret(result.sessionCookie) },
    });
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
    return { ok: true, mode, changes, message: `Sync complete — ${changes} change${changes === 1 ? "" : "s"}.` };
  } catch (err) {
    const syncErr =
      err instanceof SyncError
        ? err
        : new SyncError("UNKNOWN", err instanceof Error ? err.message : String(err));

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
    if (!prev) {
      const existedInactive = await db.subject.findUnique({ where: { code: s.code } });
      if (existedInactive) {
        await db.subject.update({
          where: { id: existedInactive.id },
          data: { name: s.name, present: s.present, total: s.total, active: true },
        });
      } else {
        await db.subject.create({
          data: { code: s.code, name: s.name, present: s.present, total: s.total },
        });
      }
      await changeEvent("SUBJECT_ADDED", s.code, `${s.name} — ${s.present}/${s.total} classes`);
      changes++;
    } else if (prev.present !== s.present || prev.total !== s.total || prev.name !== s.name) {
      await db.subject.update({
        where: { id: prev.id },
        data: { name: s.name, present: s.present, total: s.total },
      });
      const oldPct = attendancePercentage(prev.present, prev.total);
      const newPct = attendancePercentage(s.present, s.total);
      await changeEvent(
        "ATTENDANCE_UPDATED",
        s.code,
        `${s.name}: Present ${prev.present}→${s.present}, Total ${prev.total}→${s.total} (${oldPct.toFixed(2)}% → ${newPct.toFixed(2)}%)`
      );
      changes++;
    }
  }

  // --- removals (only when the snapshot is a complete view) ---
  if (snapshot.complete) {
    for (const prev of previous) {
      if (!snapshot.subjects.some((s) => s.code === prev.code)) {
        await db.subject.update({ where: { id: prev.id }, data: { active: false } });
        await changeEvent("SUBJECT_REMOVED", prev.code, `${prev.name} no longer on the ERP`);
        changes++;
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
      await changeEvent("REMINDER_UPSERTED", null, `${r.title} — ${dueAt.toLocaleString()}`);
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
            `${r.title}: ${oldDue.toLocaleString()} → ${dueAt.toLocaleString()}`
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

  // remove ERP reminders that disappeared from a complete snapshot (ACTIVE only)
  if (snapshot.complete) {
    const erpReminders = await db.reminder.findMany({ where: { source: "ERP" } });
    for (const e of erpReminders) {
      if (e.type === "ATTENDANCE_WARNING") continue;
      if (!seenExternal.has(e.externalId ?? "") && e.status === "ACTIVE") {
        await db.reminder.delete({ where: { id: e.id } });
        await changeEvent("REMINDER_REMOVED", null, `${e.title} — no longer on the ERP`);
        changes++;
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
            dueAt,
          },
        });
      } else {
        await db.reminder.update({
          where: { id: warnReminder.id },
          data: {
            title: `Attendance below target — ${sub.name}`,
            description,
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

function formatDateTime(d: Date): string {
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
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
