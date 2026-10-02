import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { getSyncState } from "@/lib/sync/engine";

export const dynamic = "force-dynamic";

/** GET /api/erp/status — connection + sync health for status pills/banners. */
export async function GET() {
  const settings = await getSettings();
  const state = await getSyncState();
  const conn = await db.erpConnection.findFirst({ orderBy: { createdAt: "desc" } });

  let liveAvailable: "unknown" | "yes" | "no" = "unknown";
  if (conn) liveAvailable = conn.status === "connected" ? "yes" : "no";

  return NextResponse.json({
    connected: !!conn,
    username: conn?.username ?? null,
    connectionStatus: conn?.status ?? null,
    lastVerifiedAt: conn?.lastVerifiedAt?.toISOString() ?? null,
    liveAvailable,
    demoMode: settings.demoMode,
    sync: {
      status: state.status,
      mode: state.mode,
      lastSyncAt: state.lastSyncAt?.toISOString() ?? null,
      lastSuccessAt: state.lastSuccessAt?.toISOString() ?? null,
      consecutiveFailures: state.consecutiveFailures,
      lastErrorCode: state.lastErrorCode,
      lastErrorMessage: state.lastErrorMessage,
      nextScheduledSyncAt: state.nextScheduledSyncAt?.toISOString() ?? null,
    },
  });
}
