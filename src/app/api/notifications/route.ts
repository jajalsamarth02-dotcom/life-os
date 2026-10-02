import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/notifications — recent notifications. */
export async function GET() {
  const notifications = await db.notification.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const unreadCount = await db.notification.count({ where: { read: false } });
  return NextResponse.json({ notifications, unreadCount });
}

/** POST /api/notifications — body { ids?: string[], all?: boolean } mark-as-read. */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    if (body.all) {
      await db.notification.updateMany({ data: { read: true } });
    } else if (Array.isArray(body.ids) && body.ids.length > 0) {
      await db.notification.updateMany({ where: { id: { in: body.ids } }, data: { read: true } });
    }
    const unreadCount = await db.notification.count({ where: { read: false } });
    return NextResponse.json({ ok: true, unreadCount });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update notifications" },
      { status: 500 }
    );
  }
}
