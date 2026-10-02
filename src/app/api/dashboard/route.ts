import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSettings, semesterFilterOf } from "@/lib/settings";
import { getSyncState } from "@/lib/sync/engine";
import { getSubjectViews, overallWithTarget } from "@/lib/views";

export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard — one aggregated payload for the Dashboard tab.
 */
export async function GET() {
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
      where: { status: "ACTIVE", dueAt: { gte: new Date(now.getTime() - 12 * 3600 * 1000) } },
      orderBy: { dueAt: "asc" },
      take: 20,
    });

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
