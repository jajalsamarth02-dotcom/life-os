import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDemoTimetable, listSlots, minutesFromHHMM } from "@/lib/timetable";

export const dynamic = "force-dynamic";

/**
 * GET /api/timetable — the weekly schedule (demo-seeded + personal slots).
 */
export async function GET() {
  try {
    await ensureDemoTimetable();
    const slots = await listSlots();
    return NextResponse.json({ slots });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load timetable" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/timetable — add a personal slot.
 * Body: { dayOfWeek: 0-6, start: "HH:MM", end: "HH:MM", subjectCode }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const dayOfWeek = Number(body.dayOfWeek);
    const start = typeof body.start === "string" ? body.start : "";
    const end = typeof body.end === "string" ? body.end : "";
    const subjectCode = typeof body.subjectCode === "string" ? body.subjectCode.trim() : "";

    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      return NextResponse.json({ error: "dayOfWeek must be 0 (Sun) – 6 (Sat)" }, { status: 400 });
    }
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
      return NextResponse.json({ error: "start/end must be HH:MM" }, { status: 400 });
    }
    const startMin = minutesFromHHMM(start);
    const endMin = minutesFromHHMM(end);
    if (endMin <= startMin) {
      return NextResponse.json({ error: "End time must be after start time" }, { status: 400 });
    }
    const subject = await db.subject.findUnique({ where: { code: subjectCode } });
    if (!subject) {
      return NextResponse.json({ error: "Unknown subject code" }, { status: 400 });
    }

    const slot = await db.timetableSlot.create({
      data: { dayOfWeek, startMin, endMin, subjectCode, source: "personal" },
    });
    return NextResponse.json({ slot }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create slot" },
      { status: 500 }
    );
  }
}
