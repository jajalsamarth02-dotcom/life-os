import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { OVERALL_KEY } from "@/lib/sync/history";

export const dynamic = "force-dynamic";

/**
 * GET /api/digest?days=7 — weekly digest report.
 * Aggregates (from the local read-only mirror only, never from the ERP):
 *  - attendance movement: first→last snapshot in the window per subject + overall,
 *    with classes attended / held / missed derived from snapshot diffs
 *  - sync health: total / success / failed runs in the window
 *  - detected ERP changes, reminders created / completed
 *  - upcoming ACTIVE reminders for the next `days` days
 */
export async function GET(req: NextRequest) {
  try {
    const daysRaw = Number(req.nextUrl.searchParams.get("days") ?? "7");
    const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.round(daysRaw), 1), 90) : 7;

    const now = Date.now();
    const from = new Date(now - days * 86_400_000);
    const until = new Date(now + days * 86_400_000);

    /* ---- attendance snapshots (window) ---- */
    const snaps = await db.attendanceSnapshot.findMany({
      where: { capturedAt: { gte: from } },
      orderBy: { capturedAt: "asc" },
      take: 5000,
    });

    const subjects = await db.subject.findMany();
    const nameByCode = new Map(subjects.map((s) => [s.code, s.name]));

    interface SeriesEnd {
      present: number;
      total: number;
      pct: number;
    }
    const firstByCode = new Map<string, SeriesEnd>();
    const lastByCode = new Map<string, SeriesEnd>();
    for (const s of snaps) {
      const end: SeriesEnd = {
        present: s.present,
        total: s.total,
        pct: s.total > 0 ? (s.present / s.total) * 100 : 0,
      };
      if (!firstByCode.has(s.subjectCode)) {
        firstByCode.set(s.subjectCode, end);
      }
      lastByCode.set(s.subjectCode, end);
    }

    const delta = (code: string) => {
      const a = firstByCode.get(code);
      const b = lastByCode.get(code);
      if (!a || !b) return null;
      const attended = Math.max(0, b.present - a.present);
      const held = Math.max(0, b.total - a.total);
      return {
        pctStart: Math.round(a.pct * 100) / 100,
        pctEnd: Math.round(b.pct * 100) / 100,
        deltaPts: Math.round((b.pct - a.pct) * 100) / 100,
        attended,
        held,
        missed: Math.max(0, held - attended),
      };
    };

    const overall = delta(OVERALL_KEY);
    const subjectRows = subjects
      .filter((s) => s.active && lastByCode.has(s.code))
      .map((s) => ({
        code: s.code,
        name: nameByCode.get(s.code) ?? s.code,
        ...(delta(s.code) ?? { pctStart: null, pctEnd: null, deltaPts: null, attended: 0, held: 0, missed: 0 }),
      }))
      .sort((a, b) => (b.deltaPts ?? 0) - (a.deltaPts ?? 0));

    /* ---- sync health ---- */
    const logs = await db.syncLog.findMany({
      where: { startedAt: { gte: from } },
      select: { status: true, trigger: true, changes: true, durationMs: true, startedAt: true },
    });
    const syncs = {
      total: logs.length,
      success: logs.filter((l) => l.status === "success").length,
      failed: logs.filter((l) => l.status === "failed").length,
    };

    /* ---- changes + reminders ---- */
    const [changeCount, createdCount, completedCount, upcomingRaw] = await Promise.all([
      db.changeEvent.count({ where: { createdAt: { gte: from } } }),
      db.reminder.count({ where: { createdAt: { gte: from } } }),
      db.reminder.count({ where: { updatedAt: { gte: from }, status: { not: "ACTIVE" } } }),
      db.reminder.findMany({
        where: { status: "ACTIVE", dueAt: { gte: new Date(now - 86_400_000), lte: until } },
        orderBy: { dueAt: "asc" },
        take: 8,
        select: { id: true, title: true, source: true, dueAt: true },
      }),
    ]);

    return NextResponse.json({
      days,
      window: { from: from.toISOString(), to: new Date(now).toISOString() },
      overall,
      subjects: subjectRows,
      syncs,
      changes: changeCount,
      reminders: { created: createdCount, completed: completedCount },
      upcoming: upcomingRaw.map((r) => ({
        id: r.id,
        title: r.title,
        source: r.source,
        dueAt: r.dueAt.toISOString(),
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to build digest" },
      { status: 500 }
    );
  }
}
