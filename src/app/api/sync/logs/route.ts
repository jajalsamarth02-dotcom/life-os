import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/sync/logs — synchronization audit history. */
export async function GET() {
  const logs = await db.syncLog.findMany({ orderBy: { startedAt: "desc" }, take: 50 });
  return NextResponse.json({ logs });
}
