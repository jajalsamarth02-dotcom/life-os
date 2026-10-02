import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * Self-healing client: if the generated Prisma schema gained new models
 * while a stale client is cached on globalThis (hot-reload), drop it so a
 * fresh client with the new delegates is created.
 */
function hasAllModels(client: PrismaClient): boolean {
  const probe = client as unknown as Record<string, { findMany?: unknown } | undefined>;
  return typeof probe.attendanceSnapshot?.findMany === "function";
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