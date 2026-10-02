import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDemoTimetable, listSlots, minutesFromHHMM, HHMMFromMinutes } from "@/lib/timetable";
import {
  BATCH_PICKS_KEY,
  parseBatchPicks,
  validatePicks,
} from "@/lib/batch-picks";
import { getRawSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/timetable — the weekly schedule (demo-seeded + personal slots)
 * plus the student's parallel-class picks (validated against the current
 * routine; stale entries from a resync are dropped server-side so every
 * consumer of the shared cache sees the same clean map).
 */
export async function GET() {
  try {
    await ensureDemoTimetable();
    const [slots, picksRaw] = await Promise.all([
      listSlots(),
      getRawSetting(BATCH_PICKS_KEY),
    ]);
    const picks = validatePicks(parseBatchPicks(picksRaw), slots);
    return NextResponse.json({ slots, picks });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load timetable" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/timetable — add a personal slot.
 * Body: { dayOfWeek: 0-6, start: "HH:MM", end: "HH:MM", subjectCode, force?: boolean }
 *
 * Conflict detection: overlapping slots on the same day are refused with 409
 * and the list of conflicts. The client may retry with force: true to accept
 * the overlap deliberately (e.g. lab tuts that share a time window).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const dayOfWeek = Number(body.dayOfWeek);
    const start = typeof body.start === "string" ? body.start : "";
    const end = typeof body.end === "string" ? body.end : "";
    const subjectCode = typeof body.subjectCode === "string" ? body.subjectCode.trim() : "";
    const force = body.force === true;

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

    const sameDay = await db.timetableSlot.findMany({
      where: { dayOfWeek },
      orderBy: { startMin: "asc" },
    });
    const conflicts = sameDay
      .filter((s) => startMin < s.endMin && endMin > s.startMin)
      .map((s) => ({
        id: s.id,
        subjectCode: s.subjectCode,
        start: HHMMFromMinutes(s.startMin),
        end: HHMMFromMinutes(s.endMin),
        source: s.source,
      }));

    if (!force && conflicts.length > 0) {
      return NextResponse.json(
        {
          error:
            conflicts.length === 1
              ? `This class overlaps ${conflicts[0].subjectCode} (${conflicts[0].start}–${conflicts[0].end}).`
              : `This class overlaps ${conflicts.length} scheduled classes.`,
          conflicts,
        },
        { status: 409 }
      );
    }

    const slot = await db.timetableSlot.create({
      data: { dayOfWeek, startMin, endMin, subjectCode, source: "personal" },
    });
    return NextResponse.json({ slot, conflicts }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create slot" },
      { status: 500 }
    );
  }
}
