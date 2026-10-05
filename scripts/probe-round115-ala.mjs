// Round 115: characterize the ALA wall contents — pre-rollover vs current-term split
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

try {
  const ala = await db.reminder.findMany({
    where: { type: "ASSIGNMENT", externalId: { startsWith: "erp:assign:" } },
    orderBy: { dueAt: "asc" },
  });
  const active = ala.filter((r) => r.status === "ACTIVE");
  console.log("ALA rows:", ala.length, "| ACTIVE:", active.length);

  // Active subjects now
  const activeSubjects = await db.subject.findMany({ where: { active: true }, select: { code: true, name: true } });
  const activeCodes = new Set(activeSubjects.map((s) => s.code));
  console.log("Active subject codes:", [...activeCodes].join(", "));

  // Split by subject linkage
  const withSubj = active.filter((r) => r.subjectCode);
  const inCurrentTerm = withSubj.filter((r) => activeCodes.has(r.subjectCode));
  const inOldTerm = withSubj.filter((r) => !activeCodes.has(r.subjectCode));
  const noSubj = active.filter((r) => !r.subjectCode);
  console.log("ACTIVE with subjectCode:", withSubj.length, "| current-term:", inCurrentTerm.length, "| old-term:", inOldTerm.length, "| no-subject:", noSubj.length);

  // due-date spread of the old-term ones
  const oldest = active[0], newest = active[active.length - 1];
  console.log("oldest due:", oldest.dueAt.toISOString(), "|", oldest.title.slice(0, 50), "| subj:", oldest.subjectCode);
  console.log("newest due:", newest.dueAt.toISOString(), "|", newest.title.slice(0, 50), "| subj:", newest.subjectCode);

  const byOldSubj = {};
  for (const r of inOldTerm) byOldSubj[r.subjectCode] = (byOldSubj[r.subjectCode] || 0) + 1;
  console.log("old-term by subject:", JSON.stringify(byOldSubj));
  const byCurSubj = {};
  for (const r of inCurrentTerm) byCurSubj[r.subjectCode] = (byCurSubj[r.subjectCode] || 0) + 1;
  console.log("current-term by subject:", JSON.stringify(byCurSubj));

  // Any ALA due in the future (still-relevant work)?
  const now = new Date();
  const future = active.filter((r) => r.dueAt > now);
  console.log("future-due ACTIVE:", future.length);
  for (const r of future.slice(0, 8)) console.log(`  ${r.dueAt.toISOString()} | ${r.subjectCode ?? "-"} | ${r.title.slice(0, 60)}`);

  // Done/dismissed count for context
  const done = ala.filter((r) => r.status !== "ACTIVE").length;
  console.log("non-ACTIVE ALA rows:", done);
} finally {
  await db.$disconnect();
}
