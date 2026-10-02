import { NextResponse } from "next/server";
import { getSettings, semesterFilterOf } from "@/lib/settings";
import { getSubjectViews, overallWithTarget } from "@/lib/views";

export const dynamic = "force-dynamic";

/**
 * GET /api/attendance — subjects with recalculated metrics
 * (percentage, classes needed to reach target, classes that can be skipped).
 * When a semester partition is selected in Settings, ONLY that semester's
 * ERP-synchronized subjects are returned and the overall figure is computed
 * from them; otherwise every synchronized subject is included.
 */
export async function GET() {
  try {
    const settings = await getSettings();
    const semesterFilter = semesterFilterOf(settings.selectedSemester);
    const subjects = await getSubjectViews(
      settings.targetPercentage,
      settings.subjectTargets,
      semesterFilter
    );
    return NextResponse.json({
      target: settings.targetPercentage,
      semester: settings.selectedSemester,
      overall: overallWithTarget(subjects, settings.targetPercentage),
      subjects,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load attendance" },
      { status: 500 }
    );
  }
}
