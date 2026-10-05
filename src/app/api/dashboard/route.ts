import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSettings, semesterFilterOf } from "@/lib/settings";
import { getSyncState, ASSIGNMENT_EXT_PREFIX } from "@/lib/sync/engine";
import { kickSyncIfStalled } from "@/lib/sync/watchdog";
import { getSubjectViews, overallWithTarget } from "@/lib/views";

export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard — one aggregated payload for the Dashboard tab.
 * Hosts the scheduler watchdog (with /api/sync): if the background tick
 * loop ever stalls, the first dashboard poll after the 2-minute grace
 * window kicks the overdue scheduled sync — the UI self-heals.
 */
export async function GET() {
  void kickSyncIfStalled();
  try {
    const settings = await getSettings();
    const state = await getSyncState();
    const semesterFilter = semesterFilterOf(settings.selectedSemester);
    const subjects = await getSubjectViews(
      settings.targetPercentage,
      settings.subjectTargets,
      semesterFilter
    );
    const overall = overallWithTarget(subjects, settings.targetPercentage);

    const now = new Date();
    const reminders = await db.reminder.findMany({
      where: {
        status: "ACTIVE",
        dueAt: { gte: new Date(now.getTime() - 12 * 3600 * 1000) },
        // ALA/assignment rows live in their own subject-wise list (Reminders
        // tab). Null-safe: a bare NOT + startsWith would also drop every row
        // with externalId = null (SQL three-valued logic).
        OR: [
          { externalId: null },
          { NOT: { externalId: { startsWith: ASSIGNMENT_EXT_PREFIX } } },
        ],
      },
      orderBy: { dueAt: "asc" },
      take: 20,
    });
    const alaPending = await db.reminder.count({
      where: {
        status: "ACTIVE",
        type: "ASSIGNMENT",
        externalId: { startsWith: ASSIGNMENT_EXT_PREFIX },
      },
    });
    const alaTotal = await db.reminder.count({
      where: { type: "ASSIGNMENT", externalId: { startsWith: ASSIGNMENT_EXT_PREFIX } },
    });

    // The next few open ALA/assignment deadlines for the dashboard preview.
    // Includes already-overdue rows first (they are the most urgent), so the
    // dashboard can show the true top of the deadline queue.
    const alaUpcomingRows = await db.reminder.findMany({
      where: {
        type: "ASSIGNMENT",
        status: "ACTIVE",
        externalId: { startsWith: ASSIGNMENT_EXT_PREFIX },
      },
      orderBy: { dueAt: "asc" },
      take: 4,
    });
    // Resolve subject display names (ALA rows may reference subjects that are
    // no longer active, so resolve directly rather than reusing the view list).
    // Primary source: the ERP course-code → name map captured during sync
    // (same map /api/assignments uses); fallback: the Subject table.
    const alaCodes = Array.from(
      new Set(alaUpcomingRows.map((r) => r.subjectCode).filter((c): c is string => Boolean(c)))
    );
    const [courseNamesRow, alaSubjects] = await Promise.all([
      db.setting.findUnique({ where: { key: "erp.courseNames" } }),
      alaCodes.length
        ? db.subject.findMany({ where: { code: { in: alaCodes } }, select: { code: true, name: true } })
        : Promise.resolve([] as { code: string; name: string }[]),
    ]);
    let courseNames: Record<string, string> = {};
    if (courseNamesRow) {
      try {
        courseNames = JSON.parse(courseNamesRow.value) as Record<string, string>;
      } catch {
        courseNames = {};
      }
    }
    const alaNameByCode = new Map<string, string>(alaSubjects.map((s) => [s.code, s.name]));
    const alaUpcoming = alaUpcomingRows.map((r) => ({
      id: r.id,
      title: r.title,
      subjectCode: r.subjectCode,
      subjectName: r.subjectCode
        ? (alaNameByCode.get(r.subjectCode) ?? courseNames[r.subjectCode] ?? null)
        : null,
      dueAt: r.dueAt.toISOString(),
      externalId: r.externalId,
    }));

    const notifications = await db.notification.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    const unreadCount = await db.notification.count({ where: { read: false } });

    const conn = await db.erpConnection.findFirst({ orderBy: { createdAt: "desc" } });

    const changes = await db.changeEvent.findMany({ orderBy: { createdAt: "desc" }, take: 40 });

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const weekEnd = new Date(now.getTime() + 7 * 24 * 3600 * 1000);

    return NextResponse.json({
      target: settings.targetPercentage,
      semester: settings.selectedSemester,
      mode: settings.demoMode ? "demo" : conn ? "live" : "none",
      overall,
      subjects,
      warningSubjects: subjects.filter((s) => s.status === "warning" || s.status === "danger").length,
      reminders: {
        items: reminders,
        todayCount: reminders.filter((r) => r.dueAt <= todayEnd).length,
        weekCount: reminders.filter((r) => r.dueAt <= weekEnd).length,
        alaPending,
        alaTotal,
        alaUpcoming,
      },
      erp: {
        connected: !!conn,
        username: conn?.username ?? null,
        connectionStatus: conn?.status ?? null,
        demoMode: settings.demoMode,
        sync: {
          status: state.status,
          mode: state.mode,
          lastSyncAt: state.lastSyncAt?.toISOString() ?? null,
          lastSuccessAt: state.lastSuccessAt?.toISOString() ?? null,
          consecutiveFailures: state.consecutiveFailures,
          lastErrorCode: state.lastErrorCode,
          lastErrorMessage: state.lastErrorMessage,
          nextScheduledSyncAt: state.nextScheduledSyncAt?.toISOString() ?? null,
        },
      },
      notifications,
      unreadCount,
      changes,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load dashboard" },
      { status: 500 }
    );
  }
}
