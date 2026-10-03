import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";
import { fetchDemoSnapshot } from "@/lib/erp/demo";
import { runSync } from "@/lib/sync/engine";

export const dynamic = "force-dynamic";

/**
 * POST /api/demo/evolve — simulate an ERP-side change (demo mode only) and
 * immediately synchronize, so the full automatic pipeline can be observed:
 * ERP change → detection → recalculation → warnings → reminders.
 */
export async function POST() {
  const settings = await getSettings();
  if (!settings.demoMode) {
    return NextResponse.json(
      { error: "Demo mode is off. Enable it in Settings to simulate ERP changes." },
      { status: 400 }
    );
  }
  await fetchDemoSnapshot(true); // force at least one change in the simulated ERP
  const outcome = await runSync("manual");
  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 500 });
}
