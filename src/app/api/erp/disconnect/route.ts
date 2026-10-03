import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * POST /api/erp/disconnect — removes stored credentials.
 * Previously synchronized data is intentionally KEPT (read-only mirror);
 * demo mode can be toggled separately in Settings.
 */
export async function POST() {
  await db.erpConnection.deleteMany({});
  const settings = await getSettings();
  return NextResponse.json({ ok: true, demoMode: settings.demoMode });
}
