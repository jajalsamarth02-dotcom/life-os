/**
 * r105 QA — read-only peek at SyncState (scheduler backoff state pre-fix).
 * No writes. usage: bun scripts/qa-r105-syncstate.ts
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const s = await (p as any).syncState.findFirst();
  console.log(JSON.stringify(s, (_k, v) => (typeof v === "bigint" ? String(v) : v), 2));
}

main()
  .catch((e) => console.log("ERR", e.message))
  .finally(() => p.$disconnect());
