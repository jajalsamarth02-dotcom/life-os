import { db } from "@/lib/db";

/**
 * Join reminders to their subjects so the client can build subject-wise lists
 * without a second request. Subjects are looked up regardless of `active` so
 * reminders linked to an inactive subject still resolve a name.
 */
export async function withSubjectMeta<T extends { subjectCode: string | null }>(
  reminders: T[]
): Promise<(T & { subjectName: string | null; subjectSemester: number | null })[]> {
  const codes = [...new Set(reminders.map((r) => r.subjectCode).filter((c): c is string => !!c))];
  if (codes.length === 0) {
    return reminders.map((r) => ({ ...r, subjectName: null, subjectSemester: null }));
  }
  const subjects = await db.subject.findMany({
    where: { code: { in: codes } },
    select: { code: true, name: true, semester: true },
  });
  const meta = new Map(subjects.map((s) => [s.code, s]));
  return reminders.map((r) => {
    const m = r.subjectCode ? meta.get(r.subjectCode) : undefined;
    return { ...r, subjectName: m?.name ?? null, subjectSemester: m?.semester ?? null };
  });
}

/** Validate a client-supplied subjectCode ("" / null → cleared). */
export async function resolveSubjectCode(input: unknown): Promise<
  { ok: true; code: string | null } | { ok: false; error: string }
> {
  if (typeof input !== "string" || input.trim() === "") return { ok: true, code: null };
  const code = input.trim();
  const subject = await db.subject.findUnique({ where: { code } });
  if (!subject) return { ok: false, error: `Unknown subject code “${code}”` };
  return { ok: true, code };
}
