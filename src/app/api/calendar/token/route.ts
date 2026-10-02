import { NextRequest, NextResponse } from "next/server";
import {
  createCalendarToken,
  deleteCalendarToken,
  getCalendarToken,
  rotateCalendarToken,
} from "@/lib/calendar-feed";
import { compactErrorText } from "@/lib/compact-error";

export const dynamic = "force-dynamic";

/** GET — { token: string | null, url: string | null } (null = no link created yet). */
export async function GET(req: NextRequest) {
  const token = await getCalendarToken();
  const origin = req.nextUrl.origin;
  return NextResponse.json({ token, url: token ? `${origin}/api/calendar?token=${token}` : null });
}

/**
 * POST — { action: "create" | "rotate" | "revoke" }.
 * create: only when no token exists yet (explicit user intent, no implicit state).
 * rotate: instant invalidation of every previously shared URL.
 * revoke: remove the token — the feed 404s until a new link is created.
 */
export async function POST(req: NextRequest) {
  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON body expected." }, { status: 400 });
  }

  try {
    const origin = req.nextUrl.origin;
    switch (body.action) {
      case "create": {
        const token = await createCalendarToken();
        if (!token) {
          return NextResponse.json({ error: "A subscription link already exists — rotate or revoke it instead." }, { status: 409 });
        }
        return NextResponse.json({ ok: true, token, url: `${origin}/api/calendar?token=${token}` });
      }
      case "rotate": {
        const token = await rotateCalendarToken();
        return NextResponse.json({ ok: true, token, url: `${origin}/api/calendar?token=${token}` });
      }
      case "revoke": {
        await deleteCalendarToken();
        return NextResponse.json({ ok: true, token: null, url: null });
      }
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: compactErrorText(e instanceof Error ? e.message : "Calendar token action failed") }, { status: 400 });
  }
}
