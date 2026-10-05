import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ASSIGNMENT_EXT_PREFIX } from "@/lib/sync/engine";

export const dynamic = "force-dynamic";

const MAX_NOTE_LEN = 2000;
const PRIORITIES = new Set([0, 1, 2, 3]);

function isValidExt(id: unknown): id is string {
  return typeof id === "string" && id.startsWith(ASSIGNMENT_EXT_PREFIX) && id.length > ASSIGNMENT_EXT_PREFIX.length;
}

/**
 * GET /api/ala-notes — the local-only note/priority overlay for ERP ALA rows.
 * Small table (one row per annotated assignment), returned whole.
 */
export async function GET() {
  try {
    const notes = await db.alaNote.findMany({ orderBy: { updatedAt: "desc" } });
    return NextResponse.json({ notes });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load ALA notes" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/ala-notes — upsert the overlay for one ALA row.
 * Body: { externalId, note?, priority? } — externalId is the Reminder's
 * stable `erp:assign:{id}`. Saving an empty note with priority 0 DELETES the
 * overlay row (a cleared annotation leaves no residue).
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      externalId?: unknown;
      note?: unknown;
      priority?: unknown;
    } | null;

    if (!body || !isValidExt(body.externalId)) {
      return NextResponse.json({ error: "A valid ERP assignment externalId is required" }, { status: 400 });
    }
    const externalId = body.externalId;

    // The row must exist in the local mirror — notes attach to real rows only.
    const row = await db.reminder.findUnique({ where: { externalId }, select: { id: true } });
    if (!row) {
      return NextResponse.json({ error: "No local ALA row matches that externalId" }, { status: 404 });
    }

    const note = typeof body.note === "string" ? body.note.trim().slice(0, MAX_NOTE_LEN) : "";
    const priority =
      typeof body.priority === "number" && Number.isInteger(body.priority) && PRIORITIES.has(body.priority)
        ? body.priority
        : 0;

    // Fully cleared annotation → remove the overlay row entirely.
    if (note === "" && priority === 0) {
      await db.alaNote.deleteMany({ where: { externalId } });
      return NextResponse.json({ ok: true, deleted: true, note: { externalId, note: "", priority: 0 } });
    }

    const saved = await db.alaNote.upsert({
      where: { externalId },
      create: { externalId, note, priority },
      update: { note, priority },
    });
    return NextResponse.json({ ok: true, note: saved });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to save ALA note" },
      { status: 500 }
    );
  }
}
