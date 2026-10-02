import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/sync/events — detected change feed (what the sync engine saw). */
export async function GET() {
  const events = await db.changeEvent.findMany({ orderBy: { createdAt: "desc" }, take: 60 });
  return NextResponse.json({ events });
}
