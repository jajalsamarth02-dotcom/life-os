import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** DELETE /api/timetable/:id — remove a slot (demo or personal). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const existing = await db.timetableSlot.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Slot not found" }, { status: 404 });
    }
    await db.timetableSlot.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to delete slot" },
      { status: 500 }
    );
  }
}
