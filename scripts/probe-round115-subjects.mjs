// Round 115: removed vs current subject names — can links be honestly re-derived?
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

try {
  const removed = await db.subject.findMany({ where: { active: false }, select: { code: true, name: true, semester: true, present: true, total: true } });
  const current = await db.subject.findMany({ where: { active: true }, select: { code: true, name: true, semester: true, present: true, total: true } });
  console.log("== REMOVED (old codes) ==");
  for (const s of removed) console.log(`${s.code} | sem ${s.semester} | ${s.present}/${s.total} | ${s.name}`);
  console.log("== CURRENT ==");
  for (const s of current) console.log(`${s.code} | sem ${s.semester} | ${s.present}/${s.total} | ${s.name}`);
} finally {
  await db.$disconnect();
}
