import { db } from "@/lib/db";
import { buildAttendanceView, AttendanceView } from "@/lib/attendance";

export interface SubjectView extends AttendanceView {
  id: string;
  code: string;
  name: string;
  updatedAt: string;
}

export function toSubjectView(
  s: { id: string; code: string; name: string; present: number; total: number; updatedAt: Date },
  targetPct: number
): SubjectView {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    updatedAt: s.updatedAt.toISOString(),
    ...buildAttendanceView(s.present, s.total, targetPct),
  };
}

export async function getSubjectViews(targetPct: number): Promise<SubjectView[]> {
  const subjects = await db.subject.findMany({
    where: { active: true },
    orderBy: [{ code: "asc" }],
  });
  return subjects.map((s) => toSubjectView(s, targetPct));
}

export function overallOf(views: SubjectView[]): AttendanceView & { subjectsCount: number } {
  const present = views.reduce((a, s) => a + s.present, 0);
  const total = views.reduce((a, s) => a + s.total, 0);
  return { subjectsCount: views.length, ...buildAttendanceView(present, total, 100) };
}

/** Same as overallOf but respects the target for status. */
export function overallWithTarget(views: SubjectView[], targetPct: number): AttendanceView {
  const present = views.reduce((a, s) => a + s.present, 0);
  const total = views.reduce((a, s) => a + s.total, 0);
  return buildAttendanceView(present, total, targetPct);
}
