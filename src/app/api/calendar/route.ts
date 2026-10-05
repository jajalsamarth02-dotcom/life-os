import { NextRequest, NextResponse } from "next/server";
import { buildCalendarFeed, isCalendarTokenValid } from "@/lib/calendar-feed";

export const dynamic = "force-dynamic";

/**
 * GET /api/calendar?token=… — live ICS subscription feed.
 *
 * The token IS the credential: wrong/missing token returns a bland 404
 * (no existence leak), the right token returns text/calendar. Calendar apps
 * re-fetch this URL on their own schedule, so deadline changes flow to the
 * phone without any manual export.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const valid = await isCalendarTokenValid(token);
  if (!valid) {
    return new NextResponse("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  }

  try {
    const feed = await buildCalendarFeed();
    return new NextResponse(feed.text, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="erp-sync-deadlines.ics"',
        "Cache-Control": "no-store",
        "X-Feed-Events": String(feed.total),
      },
    });
  } catch {
    return new NextResponse("Feed unavailable", { status: 500, headers: { "Content-Type": "text/plain" } });
  }
}
