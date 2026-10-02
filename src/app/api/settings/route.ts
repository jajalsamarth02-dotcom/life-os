import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSettings, isNotifyType, updateSettings } from "@/lib/settings";
import { recomputeAttendanceWarnings } from "@/lib/sync/engine";
import { getSyncState } from "@/lib/sync/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json(settings);
}

/**
 * PUT /api/settings — update target %, sync interval, auto-sync, demo mode,
 * notification preferences. Changing the target recalculates warnings
 * immediately (no ERP call needed).
 */
export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const patch: Record<string, unknown> = {};

    if (typeof body.targetPercentage === "number" && Number.isFinite(body.targetPercentage)) {
      patch.targetPercentage = body.targetPercentage;
    }
    if (typeof body.syncIntervalMinutes === "number" && Number.isFinite(body.syncIntervalMinutes)) {
      patch.syncIntervalMinutes = body.syncIntervalMinutes;
    }
    if (typeof body.autoSyncEnabled === "boolean") patch.autoSyncEnabled = body.autoSyncEnabled;
    if (typeof body.demoMode === "boolean") patch.demoMode = body.demoMode;
    if (body.notifyPrefs && typeof body.notifyPrefs === "object" && !Array.isArray(body.notifyPrefs)) {
      const clean: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(body.notifyPrefs as Record<string, unknown>)) {
        if (isNotifyType(k) && typeof v === "boolean") clean[k] = v;
      }
      patch.notifyPrefs = clean;
    }

    const prev = await getSettings();
    const next = await updateSettings(patch);

    if (prev.targetPercentage !== next.targetPercentage) {
      await recomputeAttendanceWarnings(next.targetPercentage);
    }

    // apply the new cadence to the schedule without waiting a full cycle
    if (prev.syncIntervalMinutes !== next.syncIntervalMinutes || prev.autoSyncEnabled !== next.autoSyncEnabled) {
      const state = await getSyncState();
      await db.syncState.update({
        where: { id: state.id },
        data: {
          nextScheduledSyncAt: new Date(Date.now() + next.syncIntervalMinutes * 60 * 1000),
        },
      });
    }

    return NextResponse.json(next);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid settings payload" },
      { status: 400 }
    );
  }
}
