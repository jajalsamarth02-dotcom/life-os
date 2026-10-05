/**
 * r105 QA — read-only peek at recent sync history (table + column discovery).
 * No writes. usage: bun scripts/qa-r105-synclog.ts
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const logs = await (p as any).syncLog.findMany({
    orderBy: { startedAt: "desc" },
    take: 10,
  });
  for (const l of logs) {
    const started = l.startedAt ? new Date(l.startedAt).toISOString() : "?";
    const dur = l.durationMs != null ? `${l.durationMs}ms` : "?";
    const err = (l.errorDetails || l.error || "").toString().slice(0, 70).replace(/\n/g, " ");
    console.log(`${started}  mode=${l.mode ?? "?"}  status=${l.status}  ${dur}  changes=${l.changes ?? "?"}  ${err}`);
  }
  if (logs.length === 0) console.log("(no syncLog rows)");
}

main()
  .catch((e) => console.log("ERR", e.message))
  .finally(() => p.$disconnect());
