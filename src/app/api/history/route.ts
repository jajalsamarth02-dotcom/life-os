import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { OVERALL_KEY } from "@/lib/sync/history";

export const dynamic = "force-dynamic";

/**
 * GET /api/history — attendance trend series built from sync-time snapshots.
 * Returns overall + per-subject series with ISO timestamps and percentages.
 */
export async function GET() {
  try {
    const snapshots = await db.attendanceSnapshot.findMany({
      orderBy: { capturedAt: "asc" },
      take: 5000,
    });

    const overall: { t: string; percentage: number; present: number; total: number }[] = [];
    const subjectMap = new Map<string, { t: string; percentage: number; present: number; total: number }[]>();
    const meta = new Map<string, string>();

    const subjects = await db.subject.findMany();
    for (const s of subjects) meta.set(s.code, s.name);

    for (const snap of snapshots) {
      const point = {
        t: snap.capturedAt.toISOString(),
        percentage: snap.total > 0 ? (snap.present / snap.total) * 100 : 0,
        present: snap.present,
        total: snap.total,
      };
      if (snap.subjectCode === OVERALL_KEY) {
        overall.push(point);
      } else {
        const arr = subjectMap.get(snap.subjectCode) ?? [];
        arr.push(point);
        subjectMap.set(snap.subjectCode, arr);
      }
    }

    return NextResponse.json({
      overall,
      subjects: Object.fromEntries(subjectMap.entries()),
      subjectsMeta: [...meta.entries()].map(([code, name]) => ({ code, name })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load history" },
      { status: 500 }
    );
  }
}
