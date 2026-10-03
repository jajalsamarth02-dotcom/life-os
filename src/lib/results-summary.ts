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

/* ------------------------------------------------------------------ */
/* Attempt history / progression / projection (all client-safe, pure)  */
/* ------------------------------------------------------------------ */

export interface AttemptMention {
  typeId: string;
  semester: number | null;
  kind: ExamLike["examKind"];
  dateKey: string | null;
  dateLabel: string | null;
  grade: string | null;
  creditPoint: number | null;
}

/** Every published mention of one subject code across all exams, latest first. */
export function attemptHistory(exams: ExamLike[], code: string): AttemptMention[] {
  const pairs: { exam: ExamLike; row: ExamLike["subjects"][number] }[] = [];
  for (const e of exams) {
    const row = e.subjects.find((s) => s.code === code);
    if (row) pairs.push({ exam: e, row });
  }
  pairs.sort((a, b) => byExamDateDesc(a.exam, b.exam));
  return pairs.map(({ exam, row }) => ({
    typeId: exam.typeId,
    semester: exam.semester,
    kind: exam.examKind,
    dateKey: exam.examDateKey,
    dateLabel: exam.examDateLabel,
    grade: row.grade,
    creditPoint: row.creditPoint,
  }));
}

/* ------------------------------------------------------------------ */
/* Retry-story roll-up: subjects with retries or failures              */
/* ------------------------------------------------------------------ */

const FAIL_RE = /^(F|FT|AB)$/i;

export interface SubjectStory {
  code: string;
  name: string;
  credit: number | null;
  /** Every published attempt, ascending by exam date (oldest first). */
  attempts: AttemptMention[];
  latestGrade: string | null;
  /** True when the subject's LATEST mention earned credit points. */
  cleared: boolean;
}

/**
 * Subjects whose published history contains a retry (more than one mention)
 * or any failing grade — the "how did I get here" timelines. Cleared-after-
 * failure subjects stay visible on purpose: the F→C→F path is the story.
 * Sorted: not-cleared first, then most attempts, then code (stable).
 */
export function subjectStories(exams: ExamLike[]): SubjectStory[] {
  const byCode = new Map<string, { name: string; credit: number | null; mentions: { exam: ExamLike; row: ExamLike["subjects"][number] }[] }>();
  for (const e of exams) {
    for (const row of e.subjects) {
      let entry = byCode.get(row.code);
      if (!entry) {
        entry = { name: row.name, credit: row.credit, mentions: [] };
        byCode.set(row.code, entry);
      }
      entry.mentions.push({ exam: e, row });
    }
  }
  const stories: SubjectStory[] = [];
  for (const [code, { name, credit, mentions }] of byCode) {
    const hasFail = mentions.some(({ row }) => row.grade != null && FAIL_RE.test(row.grade));
    if (mentions.length < 2 && !hasFail) continue;
    const asc = [...mentions].sort((a, b) => -byExamDateDesc(a.exam, b.exam));
    const latest = asc[asc.length - 1];
    stories.push({
      code,
      name,
      credit: credit ?? latest.row.credit,
      attempts: asc.map(({ exam, row }) => ({
        typeId: exam.typeId,
        semester: exam.semester,
        kind: exam.examKind,
        dateKey: exam.examDateKey,
        dateLabel: exam.examDateLabel,
        grade: row.grade,
        creditPoint: row.creditPoint,
      })),
      latestGrade: latest.row.grade,
      cleared: latest.row.creditPoint != null && latest.row.creditPoint > 0,
    });
  }
  stories.sort((a, b) => {
    if (a.cleared !== b.cleared) return a.cleared ? 1 : -1;
    if (b.attempts.length !== a.attempts.length) return b.attempts.length - a.attempts.length;
    return a.code.localeCompare(b.code);
  });
  return stories;
}

export interface CgpaPoint {
  semester: number | null;
  cgpa: number;
  creditsOffered: number | null;
  dateKey: string | null;
}

/** Career CGPA exactly as printed on each REGULAR exam, ascending by exam
 *  date (null-dated exams last, never assumed newer). */
export function cgpaProgression(exams: ExamLike[]): CgpaPoint[] {
  const asc = (a: ExamLike, b: ExamLike): number => {
    if (a.examDateKey && b.examDateKey && a.examDateKey !== b.examDateKey) {
      return a.examDateKey.localeCompare(b.examDateKey);
    }
    if (a.examDateKey && !b.examDateKey) return -1;
    if (!a.examDateKey && b.examDateKey) return 1;
    if (a.semester !== null && b.semester !== null && a.semester !== b.semester) {
      return a.semester - b.semester;
    }
    return a.typeId.localeCompare(b.typeId);
  };
  return exams
    .filter((e) => e.examKind === "REGULAR" && e.cgpa != null)
    .sort(asc)
    .map((e) => ({ semester: e.semester, cgpa: e.cgpa as number, creditsOffered: e.totalOfferedCredit, dateKey: e.examDateKey }));
}

/**
 * Career-CGPA change at each REGULAR exam (keyed by typeId): the printed
 * career line minus the previous REGULAR exam's printed line, ascending by
 * exam date. The first regular exam is the baseline (no delta). Remedial
 * pages never carry a career line, so they are never in the map.
 */
export function careerDeltas(exams: ExamLike[]): Map<string, number> {
  const asc = (a: ExamLike, b: ExamLike): number => {
    if (a.examDateKey && b.examDateKey && a.examDateKey !== b.examDateKey) {
      return a.examDateKey.localeCompare(b.examDateKey);
    }
    if (a.examDateKey && !b.examDateKey) return -1;
    if (!a.examDateKey && b.examDateKey) return 1;
    if (a.semester !== null && b.semester !== null && a.semester !== b.semester) {
      return a.semester - b.semester;
    }
    return a.typeId.localeCompare(b.typeId);
  };
  const deltas = new Map<string, number>();
  let prev: number | null = null;
  for (const e of [...exams].filter((e) => e.examKind === "REGULAR" && e.cgpa != null).sort(asc)) {
    if (prev !== null) deltas.set(e.typeId, Math.round((e.cgpa! - prev) * 1000) / 1000);
    prev = e.cgpa!;
  }
  return deltas;
}

/**
 * Plain-text academic summary for sharing (copy-to-clipboard payload) —
 * built purely from what the ERP published, never embellished. Returns
 * null when there is no REGULAR exam to summarise.
 */
export function resultsSummaryText(exams: ExamLike[]): string | null {
  const s = deriveResultsSummary(exams);
  if (!s.hasRecord || s.latestRegular == null) return null;
  const lines: string[] = [];
  lines.push(
    `CGPA ${s.cgpa?.toFixed(2) ?? "—"} (career, after ${s.latestRegular.examDateLabel ?? "latest published exam"})`,
  );
  if (s.creditsEarned != null && s.creditsOffered != null) {
    lines.push(`Credits ${s.creditsEarned} / ${s.creditsOffered} earned`);
  }
  if (s.pending.length > 0) {
    lines.push(
      `Pending (${s.pending.length}): ` +
        s.pending
          .map((p) => `${p.code} ${p.name} — ${p.grade ?? "grade not printed"}, latest attempt ${p.examDateKey ?? "date not printed"}`)
          .join("; "),
    );
  } else {
    lines.push("No pending backlogs — every published subject result is cleared.");
  }
  if (s.regularSeries.length > 0) {
    lines.push(`SGPA: ${s.regularSeries.map((p) => `S${p.semester} ${p.sgpa.toFixed(2)} (${p.passed ? "P" : "F"})`).join(" · ")}`);
  }
  if (s.remedialSeries.length > 0) {
    lines.push(`Remedial: ${s.remedialSeries.map((p) => `↺S${p.semester} ${p.sgpa.toFixed(2)}`).join(" · ")}`);
  }
  // Retry narratives — only subjects re-attempted across exams (a single
  // failed attempt is already fully described by the Pending line above).
  const retried = subjectStories(exams).filter((st) => st.attempts.length > 1);
  const openRetries = retried.filter((st) => !st.cleared);
  const recoveredRetries = retried.filter((st) => st.cleared);
  if (openRetries.length > 0) {
    lines.push(
      `Retries still open (${openRetries.length}): ` +
        openRetries
          .map((st) => `${st.code} ${st.name} ${st.attempts.map((a) => a.grade ?? "—").join("→")}`)
          .join("; "),
    );
  }
  if (recoveredRetries.length > 0) {
    lines.push(
      `Retries recovered (${recoveredRetries.length}): ` +
        recoveredRetries
          .map((st) => `${st.code} ${st.name} ${st.attempts.map((a) => a.grade ?? "—").join("→")}`)
          .join("; "),
    );
  }
  lines.push("(from the ERP Final Results page — published exams only)");
  return lines.join("\n");
}

/**
 * Estimate the career CGPA after one more semester. The ERP's career CGPA is
 * treated as cumulative credit-points ÷ credit-offered (points = cgpa ×
 * offered); the UI must label the result an estimate — the university's exact
 * rounding is unknown. Returns null when any input is missing/invalid.
 */
export function projectCgpa(
  baseCgpa: number | null,
  baseOffered: number | null,
  nextSgpa: number | null,
  nextCredits: number | null,
): number | null {
  if (baseCgpa == null || baseOffered == null || nextSgpa == null || nextCredits == null) return null;
  if (baseOffered < 0 || nextCredits <= 0) return null;
  const points = baseCgpa * baseOffered + nextSgpa * nextCredits;
  return Math.round((points / (baseOffered + nextCredits)) * 1000) / 1000;
}
