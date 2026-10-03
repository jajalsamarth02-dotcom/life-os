import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getRawSetting,
  getSettings,
  ERP_SEMESTER_KEY,
  semesterFilterOf,
} from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/semesters — data for the Settings semester partition card:
 * how many synchronized subjects sit in each semester (1–8, plus null for
 * "not yet classified by the ERP"), which partition is active, and which
 * semester the ERP itself reported during sync.
 */
export async function GET() {
  try {
    const settings = await getSettings();
    const rawDetected = await getRawSetting(ERP_SEMESTER_KEY);
    const detected = semesterFilterOf(rawDetected);

    const grouped = await db.subject.groupBy({
      by: ["semester"],
      where: { active: true },
      _count: { _all: true },
    });

    const counts: { semester: number | null; count: number }[] = grouped.map((g) => ({
      semester: typeof g.semester === "number" ? g.semester : null,
      count: g._count._all,
    }));
    // stable ordering: known semesters ascending, unclassified last
    counts.sort((a, b) => {
      if (a.semester === null) return 1;
      if (b.semester === null) return -1;
      return a.semester - b.semester;
    });

    return NextResponse.json({
      selected: settings.selectedSemester,
      detected,
      counts,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load semesters" },
      { status: 500 }
    );
  }
}
