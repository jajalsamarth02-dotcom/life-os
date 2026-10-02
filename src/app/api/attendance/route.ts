import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";
import { getSubjectViews, overallWithTarget } from "@/lib/views";

export const dynamic = "force-dynamic";

/**
 * GET /api/attendance — all subjects with recalculated metrics
 * (percentage, classes needed to reach target, classes that can be skipped).
 */
export async function GET() {
  try {
    const settings = await getSettings();
    const subjects = await getSubjectViews(settings.targetPercentage, settings.subjectTargets);
    return NextResponse.json({
      target: settings.targetPercentage,
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
