import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSettings, getRawSetting, ERP_SEMESTER_KEY, semesterFilterOf } from "@/lib/settings";
import { getSyncState, ASSIGNMENT_EXT_PREFIX } from "@/lib/sync/engine";
import { withSubjectMeta } from "@/lib/reminders";

export const dynamic = "force-dynamic";

/**
 * GET /api/assignments — the ERP-synced ALA/assignment list (Active Learning
 * Assignments + other coursework), including completed rows so the client can
 * show "Submitted vs Pending" subject-wise. Read-only mirror data: rows come
 * from the local copy of the ERP Assignments page (never from the ERP live).
 */
export async function GET() {
  try {
    const [rows, settings, sync, namesRow, rawDetected] = await Promise.all([
      db.reminder.findMany({
        where: { source: "ERP", type: "ASSIGNMENT", externalId: { startsWith: ASSIGNMENT_EXT_PREFIX } },
        orderBy: { dueAt: "asc" },
        take: 500,
      }),
      getSettings(),
      getSyncState(),
      db.setting.findUnique({ where: { key: "erp.courseNames" } }),
      getRawSetting(ERP_SEMESTER_KEY),
    ]);

    let courseNames: Record<string, string> = {};
    try {
      courseNames = namesRow ? (JSON.parse(namesRow.value) as Record<string, string>) : {};
    } catch {
      courseNames = {};
    }

    const connCount = await db.erpConnection.count();

    return NextResponse.json({
      assignments: await withSubjectMeta(rows),
      courseNames,
      semester: settings.selectedSemester,
      // Semester the ERP itself reported at sync time — ALA rows always belong
      // to it, regardless of the app's semester partition (honest-origin note).
      sourceSemester: semesterFilterOf(rawDetected),
      mode: settings.demoMode ? "demo" : connCount > 0 ? "live" : "none",
      sync: {
        status: sync.status,
        lastSuccessAt: sync.lastSuccessAt?.toISOString() ?? null,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load assignments" },
      { status: 500 }
    );
  }
}
