import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withSubjectMeta, resolveSubjectCode } from "@/lib/reminders";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/reminders/:id
 * Body: { status?, dueAt?, subjectCode? }
 *
 * - status: works for both ERP and personal reminders (ERP ones are re-synced
 *   from the source of truth when the ERP changes them).
 * - dueAt (snooze/reschedule): PERSONAL reminders only — the ERP owns the due
 *   dates of its own reminders, so the app never rewrites them locally.
 * - subjectCode: PERSONAL reminders only — link/unlink a subject for the
 *   subject-wise view (null or "" clears the link).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}) as Record<string, unknown>);

    const status = typeof body.status === "string" ? body.status : undefined;
    if (status !== undefined && !["ACTIVE", "DONE", "DISMISSED"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const hasDueAt = body.dueAt !== undefined && body.dueAt !== null;
    let dueAtDate: Date | null = null;
    if (hasDueAt) {
      const t = new Date(String(body.dueAt));
      if (Number.isNaN(t.getTime())) {
        return NextResponse.json({ error: "dueAt must be a valid ISO date" }, { status: 400 });
      }
      dueAtDate = t;
    }

    const hasSubject = body.subjectCode !== undefined;
    let subjectCode: string | null = null;
    if (hasSubject) {
      const resolved = await resolveSubjectCode(body.subjectCode);
      if (!resolved.ok) {
        return NextResponse.json({ error: resolved.error }, { status: 400 });
      }
      subjectCode = resolved.code;
    }

    if (status === undefined && !hasDueAt && !hasSubject) {
      return NextResponse.json(
        { error: "Nothing to update: provide status, dueAt and/or subjectCode" },
        { status: 400 }
      );
    }

    const existing = await db.reminder.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Reminder not found" }, { status: 404 });
    }
    if (hasDueAt && existing.source !== "PERSONAL") {
      return NextResponse.json(
        { error: "ERP reminders are owned by synchronization — their due dates come from the ERP and cannot be changed manually." },
        { status: 400 }
      );
    }
    if (hasSubject && existing.source !== "PERSONAL") {
      return NextResponse.json(
        { error: "Only personal reminders can be linked to a subject — ERP reminders keep the subject the sync engine assigns." },
        { status: 400 }
      );
    }

    const reminder = await db.reminder.update({
      where: { id },
      data: {
        ...(status !== undefined ? { status } : {}),
        ...(dueAtDate ? { dueAt: dueAtDate } : {}),
        ...(hasSubject ? { subjectCode } : {}),
      },
    });
    return NextResponse.json({ reminder: (await withSubjectMeta([reminder]))[0] });
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
