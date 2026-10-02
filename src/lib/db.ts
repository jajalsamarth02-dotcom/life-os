import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * Self-healing client: if the generated Prisma schema gained new models
 * while a stale client is cached on globalThis (hot-reload), drop it so a
 * fresh client with the new delegates is created. NOTE: after `db:push` a
 * dev-server restart may still be required because the bundler caches the
 * generated client module.
 */
const EXPECTED_MODELS = [
  "setting",
  "erpConnection",
  "syncState",
  "syncLog",
  "subject",
  "changeEvent",
  "reminder",
  "notification",
  "attendanceSnapshot",
  "timetableSlot",
] as const;

function hasAllModels(client: PrismaClient): boolean {
  const probe = client as unknown as Record<string, { findMany?: unknown } | undefined>;
  return EXPECTED_MODELS.every((m) => typeof probe[m]?.findMany === "function");
}

function getClient(): PrismaClient {
  const cached = globalForPrisma.prisma;
  if (cached && hasAllModels(cached)) return cached;
  return new PrismaClient({
    log: ['query'],
  });
}

export const db = getClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db