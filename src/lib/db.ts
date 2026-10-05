import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * Self-healing client: if the generated Prisma schema gained new models OR new
 * scalar fields while a stale client is cached on globalThis (hot-reload after
 * `db:push` + `prisma generate`), drop it so a fresh client with the new
 * delegates/fields is created. NOTE: when the bundler itself caches the old
 * generated client module, a dev-server restart is still required.
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
  "alaNote",
] as const;

/** Fields that must exist on the cached client (guards schema evolution). */
const EXPECTED_FIELDS: [model: keyof typeof probe0, field: string][] = [
  ["reminder", "subjectCode"],
  ["subject", "semester"],
];
const probe0 = { reminder: 0, subject: 0 };

function hasAllModels(client: PrismaClient): boolean {
  const probe = client as unknown as Record<string, { findMany?: unknown } | undefined>;
  return EXPECTED_MODELS.every((m) => typeof probe[m]?.findMany === "function");
}

function hasExpectedFields(client: PrismaClient): boolean {
  const probe = client as unknown as Record<string, { fields?: Record<string, unknown> } | undefined>;
  return EXPECTED_FIELDS.every(
    ([m, f]) => !!probe[m]?.fields && f in (probe[m].fields as Record<string, unknown>)
  );
}

function getClient(): PrismaClient {
  const cached = globalForPrisma.prisma;
  if (cached && hasAllModels(cached) && hasExpectedFields(cached)) return cached;
  return new PrismaClient({
    /* Query logging is a DEV tool only — in production (Vercel serverless
       included) it would log one line per query against log quotas and slow
       hot paths. Same client behavior either way. */
    log: process.env.NODE_ENV === "development" ? ['query'] : [],
  });
}

export const db = getClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db