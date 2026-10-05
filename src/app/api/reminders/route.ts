import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withSubjectMeta, resolveSubjectCode } from "@/lib/reminders";
import { ASSIGNMENT_EXT_PREFIX } from "@/lib/sync/engine";

export const dynamic = "force-dynamic";

/**
 * GET /api/reminders?filter=all|erp|personal&includeDone=true
 *
 * ERP-synced ALA/assignment rows (externalId `erp:assign:*`) are excluded —
 * they have their own subject-wise view via GET /api/assignments.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const filter = url.searchParams.get("filter") ?? "all";
    const includeDone = url.searchParams.get("includeDone") === "true";

    const where: Record<string, unknown> = {};
    if (filter === "erp") where.source = "ERP";
    if (filter === "personal") where.source = "PERSONAL";
    if (!includeDone) where.status = "ACTIVE";
    // Hide ALA/assignment rows (they have their own view) — null-safe: a bare
    // NOT + startsWith would silently drop every row with externalId = null
    // (SQL three-valued logic), i.e. ALL personal reminders.
    where.OR = [
      { externalId: null },
      { NOT: { externalId: { startsWith: ASSIGNMENT_EXT_PREFIX } } },
    ];

    const reminders = await db.reminder.findMany({
      where,
      orderBy: { dueAt: "asc" },
      take: 200,
    });
    return NextResponse.json({ reminders: await withSubjectMeta(reminders) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load reminders" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/reminders — create a PERSONAL reminder.
 * Body: { title, type?, description?, dueAt (ISO string), subjectCode? }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    const dueAt = new Date(body.dueAt);
    if (Number.isNaN(dueAt.getTime())) {
      return NextResponse.json({ error: "A valid due date/time is required" }, { status: 400 });
    }
    const allowedTypes = ["EXAM", "PRACTICAL_EXAM", "VIVA", "ASSIGNMENT", "SUBMISSION", "OTHER"];
    const type = allowedTypes.includes(body.type) ? body.type : "OTHER";

    const subject = await resolveSubjectCode(body.subjectCode);
    if (!subject.ok) {
      return NextResponse.json({ error: subject.error }, { status: 400 });
    }

    const reminder = await db.reminder.create({
      data: {
        source: "PERSONAL",
        type,
        title,
        description: typeof body.description === "string" ? body.description.trim() || null : null,
        subjectCode: subject.code,
        dueAt,
      },
    });
    return NextResponse.json(
      { reminder: (await withSubjectMeta([reminder]))[0] },
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create reminder" },
      { status: 500 }
    );
  }
}
