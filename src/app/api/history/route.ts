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
 *
 * r114 — `?scope=archive`: the ERP removed last term's subjects at the Oct 2
 * rollover (rows kept, active=false) and their snapshots remain within the
 * 90-day retention window — but every active-scoped surface went blind to
 * them. The archive scope returns ONLY those removed subjects' series (real
 * names preserved on the rows), with the overall series being the recorded
 * OVERALL_KEY snapshots up to the archive's last captured class — the ERP's
 * own whole-cohort numbers from that era, not a recomputation. Read-only:
 * nothing here mutates snapshots or subjects.
 */
export async function GET(req: Request) {
  try {
    const settings = await getSettings();
    const semesterFilter = semesterFilterOf(settings.selectedSemester);
    const archiveScope = new URL(req.url).searchParams.get("scope") === "archive";

    const subjects = await db.subject.findMany({
      where: archiveScope
        ? { active: false }
        : {
            // r114: active-only in the default scope too — a partition-less
            // ("All semesters") view must not resurrect removed subjects in
            // the live trend; the archive scope is their only surface.
            active: true,
            ...(semesterFilter ? { semester: semesterFilter } : {}),
          },
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

    // Per-subject series (filtered codes only). When partitioned, the overall
    // line is rebuilt from these at every capture time — each subject
    // contributes its LATEST snapshot at or before that time (carry-forward),
    // because unchanged subjects are not re-recorded on every sync.
    const scopedOverall = archiveScope ? false : semesterFilter ? true : false;

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
      // r114: the code allowlist applies in EVERY scope — the default scope
      // is active-only and the archive scope is removed-only; a snapshot for
      // any other code belongs to neither series.
      if (!allowedCodes.has(snap.subjectCode)) continue;

      const point = {
        t: snap.capturedAt.toISOString(),
        percentage: snap.total > 0 ? (snap.present / snap.total) * 100 : 0,
        present: snap.present,
        total: snap.total,
      };
      const arr = subjectMap.get(snap.subjectCode) ?? [];
      arr.push(point);
      subjectMap.set(snap.subjectCode, arr);
    }

    if (scopedOverall) {
      const times = [...new Set([...subjectMap.values()].flat().map((p) => p.t))].sort((a, b) =>
        a.localeCompare(b)
      );
      const codes = [...subjectMap.keys()];
      const pointers = new Map<string, number>(codes.map((c) => [c, 0]));
      const latest = new Map<string, { present: number; total: number }>();
      for (const t of times) {
        let present = 0;
        let total = 0;
        for (const code of codes) {
          const arr = subjectMap.get(code)!;
          let idx = pointers.get(code)!;
          while (idx < arr.length && arr[idx].t <= t) {
            latest.set(code, { present: arr[idx].present, total: arr[idx].total });
            idx++;
          }
          pointers.set(code, idx);
          const cur = latest.get(code);
          if (cur) {
            present += cur.present;
            total += cur.total;
          }
        }
        overall.push({
          t,
          percentage: total > 0 ? (present / total) * 100 : 0,
          present,
          total,
        });
      }
    }

    if (archiveScope) {
      // The recorded overall is a continuous series spanning every era; the
      // archive shows only the era its subjects were on the ERP — cut at the
      // last archived class snapshot (OVERALL_KEY rows after that belong to
      // the current term).
      let cutAt = "";
      for (const arr of subjectMap.values()) {
        const last = arr[arr.length - 1];
        if (last && last.t > cutAt) cutAt = last.t;
      }
      const cut = overall.filter((p) => p.t <= cutAt);
      overall.length = 0;
      overall.push(...cut);
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
