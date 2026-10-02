import { NextResponse } from "next/server";
import { getSyncState, runSync } from "@/lib/sync/engine";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/sync — current sync state + recent logs.
 */
export async function GET() {
  const state = await getSyncState();
  const logs = await db.syncLog.findMany({ orderBy: { startedAt: "desc" }, take: 15 });
  return NextResponse.json({
    state: {
      status: state.status,
      mode: state.mode,
      lastSyncAt: state.lastSyncAt?.toISOString() ?? null,
      lastSuccessAt: state.lastSuccessAt?.toISOString() ?? null,
      consecutiveFailures: state.consecutiveFailures,
      lastErrorCode: state.lastErrorCode,
      lastErrorMessage: state.lastErrorMessage,
      nextScheduledSyncAt: state.nextScheduledSyncAt?.toISOString() ?? null,
    },
    logs,
  });
}

/**
 * POST /api/sync — [Sync Now] manual, authorized synchronization request.
 * Never erases previously synchronized data on failure.
 */
export async function POST() {
  const outcome = await runSync("manual");
  return NextResponse.json(outcome, { status: outcome.ok || outcome.skipped ? 200 : 502 });
}
