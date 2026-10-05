// Round 115 read-only adoption probe: WA lastResult, wizard-save fingerprints, ALA wall, sync health
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const kv = async (k) => (await db.kVStore.findUnique({ where: { key: k } }))?.value ?? null;

try {
  // 1. Sync health
  const sync = await db.syncState.findFirst();
  console.log("== SYNC ==");
  console.log(JSON.stringify(sync, null, 1));

  // 2. Notify config (WA + ntfy) — do NOT print secrets, only shapes/lastResult
  const keys = await db.setting.findMany({ where: { key: { startsWith: "notify." } }, orderBy: { key: "asc" } });
  console.log("== NOTIFY SETTINGS ==", keys.map((k) => k.key).join(", ") || "(none)");
  for (const k of keys) {
    if (k.key.endsWith(".lastResult") || k.key.endsWith(".enabled") || k.key.endsWith(".lastAutoAt") || k.key.endsWith(".lastPendingCount")) {
      console.log(`${k.key}: ${k.value}  (updatedAt ${k.updatedAt.toISOString()})`);
    }
  }
  const waEnc = keys.find((k) => k.key === "notify.wa.enc");
  console.log("wa.enc present:", Boolean(waEnc), waEnc ? `(len ${waEnc.value.length}, updatedAt ${waEnc.updatedAt.toISOString()})` : "");

  // 3. ChangeEvents since r109 (Oct 5 09:30 UTC) — wizard saves / sweeps / anything student-authored
  const since = new Date("2026-10-05T09:30:00Z");
  const events = await db.changeEvent.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  console.log("== CHANGE EVENTS since r109 ==", events.length);
  for (const e of events) {
    console.log(`${e.createdAt.toISOString()} | ${e.kind} | ${e.subjectCode ?? ""} | ${(e.detail || "").slice(0, 140)}`);
  }

  // 4. ALA wall (same shape as /api/dashboard)
  const ASSIGNMENT_EXT_PREFIX = "erp:assign:";
  const alaPending = await db.reminder.count({
    where: { status: "ACTIVE", type: "ASSIGNMENT", externalId: { startsWith: ASSIGNMENT_EXT_PREFIX } },
  });
  const alaTotal = await db.reminder.count({
    where: { type: "ASSIGNMENT", externalId: { startsWith: ASSIGNMENT_EXT_PREFIX } },
  });
  console.log("== ALA ==", { total: alaTotal, pending: alaPending, done: alaTotal - alaPending });

  // 5. Notifications (student-visible surface activity)
  const notes = await db.notification.findMany({ orderBy: { createdAt: "desc" }, take: 5 });
  console.log("== NOTIFICATIONS (last 5) ==", notes.length);
  for (const n of notes) console.log(`${n.createdAt.toISOString()} | ${n.type} | ${n.severity} | ${n.title.slice(0, 60)}`);
} finally {
  await db.$disconnect();
}
