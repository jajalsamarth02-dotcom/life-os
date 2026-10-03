/**
 * Derivations over parsed exam results (ErpResultExam[]) — pure, zero imports
 * so it is safe in client bundles and trivially testable.
 *
 * Honest-state rules:
 *  - "Latest" always means latest by the ERP's own exam date; unparseable
 *    dates sort last (they are never assumed newer).
 *  - A subject's CURRENT state comes from its most recent mention: the latest
 *    exam whose subject table lists that code decides pending vs cleared.
 *    Earlier failures do not linger once a later exam clears the subject.
 *  - Nothing here judges: it only relabels what the ERP already printed.
 */

export interface ExamLike {
  typeId: string;
  label: string;
  examKind: "REGULAR" | "REMEDIAL" | "UNKNOWN";
  semester: number | null;
  examDateKey: string | null;
  /** Raw "Year of Examination" cell text (display form). */
  examDateLabel: string | null;
  subjects: {
    code: string;
    name: string;
    credit: number | null;
    grade: string | null;
    creditPoint: number | null;
  }[];
  offeredCredit: number | null;
  earnedCredit: number | null;
  sgpa: number | null;
  totalOfferedCredit: number | null;
  totalEarnedCredit: number | null;
  cgpa: number | null;
  result: string | null;
}

export interface PendingSubject {
  code: string;
  name: string;
  credit: number | null;
  grade: string | null;
  /** The exam whose row is the subject's latest mention (display provenance). */
  examLabel: string;
  examDateKey: string | null;
}

export interface SgpaPoint {
  semester: number;
  sgpa: number;
  passed: boolean;
  examDateKey: string | null;
  typeId: string;
}

export interface ResultsSummary {
  /** Latest REGULAR exam — the career-cumulative line (CGPA, credits). */
  latestRegular: ExamLike | null;
  cgpa: number | null;
  creditsEarned: number | null;
  creditsOffered: number | null;
  /** Subjects whose most recent ERP mention has 0 credit points. */
  pending: PendingSubject[];
  /** REGULAR exams' SGPA by semester (ascending) — the trend line. */
  regularSeries: SgpaPoint[];
  /** REMEDIAL attempts (latest per semester) — improvement markers. */
  remedialSeries: SgpaPoint[];
  /** True when at least one REGULAR exam exists (the record is usable). */
  hasRecord: boolean;
}

const PASS_RE = /\bpass\b/i;

export function examPassed(result: string | null): boolean {
  return result != null && PASS_RE.test(result);
}

/** Latest first: exam date desc → semester desc → type id desc (stable). */
export function byExamDateDesc(a: ExamLike, b: ExamLike): number {
  if (a.examDateKey && b.examDateKey && a.examDateKey !== b.examDateKey) {
    return b.examDateKey.localeCompare(a.examDateKey);
  }
  if (a.examDateKey && !b.examDateKey) return -1;
  if (!a.examDateKey && b.examDateKey) return 1;
  if (a.semester !== null && b.semester !== null && a.semester !== b.semester) {
    return b.semester - a.semester;
  }
  return b.typeId.localeCompare(a.typeId);
}

function latestPerSemester(exams: ExamLike[], kind: ExamLike["examKind"]): SgpaPoint[] {
  const best = new Map<number, ExamLike>();
  for (const e of exams) {
    if (e.examKind !== kind || e.semester == null || e.sgpa == null) continue;
    const prev = best.get(e.semester);
    if (!prev || byExamDateDesc(e, prev) < 0) best.set(e.semester, e);
  }
  return [...best.values()]
    .map((e) => ({ semester: e.semester as number, sgpa: e.sgpa as number, passed: examPassed(e.result), examDateKey: e.examDateKey, typeId: e.typeId }))
    .sort((a, b) => a.semester - b.semester);
}

export function deriveResultsSummary(exams: ExamLike[]): ResultsSummary {
  const sorted = [...exams].sort(byExamDateDesc);
  const latestRegular = sorted.find((e) => e.examKind === "REGULAR") ?? null;

  // Latest-mention-wins per subject code → the honest pending list.
  const pending: PendingSubject[] = [];
  const seen = new Set<string>();
  for (const e of sorted) {
    for (const s of e.subjects) {
      if (seen.has(s.code)) continue;
      seen.add(s.code);
      if (s.creditPoint === 0) {
        pending.push({
          code: s.code,
          name: s.name,
          credit: s.credit,
          grade: s.grade,
          examLabel: e.label,
          examDateKey: e.examDateKey,
        });
      }
    }
  }
  pending.sort((a, b) => a.code.localeCompare(b.code));

  return {
    latestRegular,
    cgpa: latestRegular?.cgpa ?? null,
    creditsEarned: latestRegular?.totalEarnedCredit ?? null,
    creditsOffered: latestRegular?.totalOfferedCredit ?? null,
    pending,
    regularSeries: latestPerSemester(exams, "REGULAR"),
    remedialSeries: latestPerSemester(exams, "REMEDIAL"),
    hasRecord: latestRegular !== null,
  };
}

/** O→P ladder for grade-chip coloring (client-safe, no ERP round trip). */
export function gradeTier(grade: string | null): "top" | "good" | "ok" | "weak" | "fail" | "muted" {
  if (!grade) return "muted";
  const g = grade.toUpperCase();
  if (g === "O" || g === "A+") return "top";
  if (g === "A" || g === "B+") return "good";
  if (g === "B" || g === "C") return "ok";
  if (g === "P") return "weak";
  if (g === "F" || g === "FT" || g === "AB") return "fail";
  return "muted";
}
