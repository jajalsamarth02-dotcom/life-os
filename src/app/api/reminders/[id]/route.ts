import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/reminders/:id — body { status: "ACTIVE" | "DONE" | "DISMISSED" }
 * Works for both ERP and personal reminders (ERP ones are re-synced from the
 * source of truth when the ERP changes them).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const status = body.status;
    if (!["ACTIVE", "DONE", "DISMISSED"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    const reminder = await db.reminder.update({
      where: { id },
      data: { status },
    });
    return NextResponse.json({ reminder });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update reminder" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/reminders/:id — personal reminders only.
 * ERP reminders are owned by the sync process (source of truth = ERP).
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const reminder = await db.reminder.findUnique({ where: { id } });
    if (!reminder) {
      return NextResponse.json({ error: "Reminder not found" }, { status: 404 });
    }
    if (reminder.source === "ERP") {
      return NextResponse.json(
        { error: "ERP reminders are managed by synchronization and cannot be deleted manually." },
        { status: 400 }
      );
    }
    await db.reminder.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to delete reminder" },
      { status: 500 }
    );
  }
}
