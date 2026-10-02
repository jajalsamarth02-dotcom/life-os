import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSettings, semesterFilterOf } from "@/lib/settings";
import { OVERALL_KEY } from "@/lib/sync/history";

export const dynamic = "force-dynamic";

/**
 * GET /api/attendance history — trend series built from sync-time snapshots.
 * Returns overall + per-subject series with ISO timestamps and percentages.
 *
 * When a semester partition is selected, only that semester's subjects are
 * returned and the overall series is recomputed FROM THOSE subjects (grouped
 * by capture time) so the chart always matches the visible selection.
 */
export async function GET() {
  try {
    const settings = await getSettings();
    const semesterFilter = semesterFilterOf(settings.selectedSemester);

    const subjects = await db.subject.findMany({
      ...(semesterFilter ? { where: { semester: semesterFilter } } : {}),
    });
    const allowedCodes = new Set(subjects.map((s) => s.code));

    const snapshots = await db.attendanceSnapshot.findMany({
      orderBy: { capturedAt: "asc" },
      take: 5000,
    });

    const overall: { t: string; percentage: number; present: number; total: number }[] = [];
    const subjectMap = new Map<string, { t: string; percentage: number; present: number; total: number }[]>();
    const meta = new Map<string, string>();
    for (const s of subjects) meta.set(s.code, s.name);

    // When partitioned, the overall line is rebuilt from the filtered
    // subjects at each shared capture time (snapshots never store semester).
    const scopedOverall = semesterFilter
      ? new Map<string, { present: number; total: number }>()
      : null;

    for (const snap of snapshots) {
      if (snap.subjectCode === OVERALL_KEY) {
        if (!scopedOverall) {
          overall.push({
            t: snap.capturedAt.toISOString(),
            percentage: snap.total > 0 ? (snap.present / snap.total) * 100 : 0,
            present: snap.present,
            total: snap.total,
          });
        }
        continue;
      }
      if (semesterFilter && !allowedCodes.has(snap.subjectCode)) continue;

      const point = {
        t: snap.capturedAt.toISOString(),
        percentage: snap.total > 0 ? (snap.present / snap.total) * 100 : 0,
        present: snap.present,
        total: snap.total,
      };
      const arr = subjectMap.get(snap.subjectCode) ?? [];
      arr.push(point);
      subjectMap.set(snap.subjectCode, arr);

      if (scopedOverall) {
        const acc = scopedOverall.get(point.t) ?? { present: 0, total: 0 };
        acc.present += snap.present;
        acc.total += snap.total;
        scopedOverall.set(point.t, acc);
      }
    }

    if (scopedOverall) {
      for (const [t, sums] of [...scopedOverall.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        overall.push({
          t,
          percentage: sums.total > 0 ? (sums.present / sums.total) * 100 : 0,
          present: sums.present,
          total: sums.total,
        });
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
