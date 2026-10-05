import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

// Duplicate check: same title+dueAt+subjectCode, different ids
const all = await p.reminder.findMany({ orderBy: [{ title: "asc" }, { dueAt: "asc" }] });
const seen = new Map();
console.log("ACTIVE (status) reminders with dueAt in the past:");
const now = new Date();
for (const r of all) {
  if (r.status === "ACTIVE") {
    const key = `${r.title}|${r.dueAt.toISOString()}|${r.subjectCode || ""}`;
    if (seen.has(key)) console.log("  DUP of:", seen.get(key), "→", r.id, r.title.slice(0, 50));
    else seen.set(key, r.id);
  }
}
const activeOverdue = all.filter(r => r.status === "ACTIVE" && r.dueAt < now);
console.log("\nACTIVE+overdue count:", activeOverdue.length, "of", all.filter(r => r.status === "ACTIVE").length, "active");

// All ACTIVE with externalId
console.log("\nACTIVE reminders extIds:");
for (const r of all.filter(x => x.status === "ACTIVE")) console.log(" ", r.id.slice(-8), "ext:", r.externalId?.slice(0, 50) || "-", "due:", r.dueAt.toISOString().slice(0, 10), r.title.slice(0, 55));

// Status distribution
const dist = {};
for (const r of all) dist[r.status] = (dist[r.status] || 0) + 1;
console.log("\nReminder status dist:", JSON.stringify(dist), "total:", all.length);

// Subjects: check COURSE artifact
const subj = await p.subject.findMany({ where: { active: true }, orderBy: { code: "asc" } });
console.log("\nACTIVE subjects with present/total:");
for (const s of subj) console.log(`  ${s.code.padEnd(24)} sem=${s.semester ?? "-"} present=${s.present}/${s.total} ${s.name.slice(0, 45)}`);
const inactive = await p.subject.count({ where: { active: false } });
console.log("inactive subjects:", inactive);

await p.$disconnect();
