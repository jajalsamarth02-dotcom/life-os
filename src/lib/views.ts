import { db } from "@/lib/db";
import { buildAttendanceView, AttendanceView } from "@/lib/attendance";

export interface SubjectView extends AttendanceView {
  id: string;
  code: string;
  name: string;
  updatedAt: string;
  /** Effective target for THIS subject (override or global). */
  targetPct: number;
  /** True when this subject has its own target different from the global one. */
  hasCustomTarget: boolean;
}

export function toSubjectView(
  s: { id: string; code: string; name: string; present: number; total: number; updatedAt: Date },
  globalTargetPct: number,
  subjectTargets?: Record<string, number>
): SubjectView {
  const override = subjectTargets?.[s.code];
  const hasCustomTarget =
    typeof override === "number" && Number.isFinite(override) && override !== globalTargetPct;
  const effective = hasCustomTarget ? (override as number) : globalTargetPct;
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    updatedAt: s.updatedAt.toISOString(),
    targetPct: effective,
    hasCustomTarget,
    ...buildAttendanceView(s.present, s.total, effective),
  };
}

export async function getSubjectViews(
  targetPct: number,
  subjectTargets?: Record<string, number>
): Promise<SubjectView[]> {
  const subjects = await db.subject.findMany({
    where: { active: true },
    orderBy: [{ code: "asc" }],
  });
  return subjects.map((s) => toSubjectView(s, targetPct, subjectTargets));
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
