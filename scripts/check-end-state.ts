/**
 * Pristine end-state checker (read-only): counts ChangeEvents, Notifications
 * and recent sync results in the last hour. Zero sends expected on QA rounds.
 * Run: cd /home/z/my-project && bun run scripts/check-end-state.ts
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const since = new Date(Date.now() - 3600e3);

const changes = await p.changeEvent.count({ where: { createdAt: { gte: since } } });
const notes = await p.notification.count({ where: { createdAt: { gte: since } } });
const syncs = await p.syncLog
  .findMany({ select: { status: true, trigger: true, changes: true, startedAt: true }, orderBy: { startedAt: "desc" }, take: 3 })
  .catch(() => "synclog-field-mismatch");

console.log("changeEvents(1h):", changes);
console.log("notifications(1h):", notes);
console.log("recentSyncs:", JSON.stringify(syncs));
await p.$disconnect();
