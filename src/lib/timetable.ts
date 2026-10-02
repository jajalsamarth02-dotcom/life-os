import { db } from "@/lib/db";
import { getSettings, getRawSetting, setRawSetting } from "@/lib/settings";

/**
 * Weekly timetable helpers.
 * The demo ERP seeds a realistic Mon–Sat schedule once; students manage
 * their own slots via the API (source "personal"). A live ERP timetable
 * will be upserted by the sync connector once its page structure is known.
 */

export interface SlotRow {
  id: string;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  subjectCode: string;
  source: string;
}

const SEED_FLAG = "demo.timetableSeeded";

export function minutesFromHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  return h * 60 + m;
}

export function HHMMFromMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const DEMO_PERIODS: { start: string; end: string }[] = [
  { start: "09:00", end: "09:50" },
  { start: "10:00", end: "10:50" },
  { start: "11:00", end: "11:50" },
  { start: "12:00", end: "12:50" },
  { start: "14:00", end: "14:50" },
];

/** Deterministic subject rotation so the demo week looks real. */
function demoSubjectFor(day: number, periodIdx: number, codes: string[]): string {
  return codes[(day * 3 + periodIdx * 2) % codes.length];
}

/** Seed the demo timetable exactly once (Mon–Sat, 4–5 periods/day). */
export async function ensureDemoTimetable(): Promise<void> {
  const seeded = await getRawSetting(SEED_FLAG);
  if (seeded === "1") return;
  const settings = await getSettings();
  if (!settings.demoMode) {
    await setRawSetting(SEED_FLAG, "1"); // don't seed later after switching to live
    return;
  }
  const subjects = await db.subject.findMany({ where: { active: true }, orderBy: { code: "asc" } });
  if (subjects.length === 0) {
    return; // no subjects yet — try again on the next request
  }
  const codes = subjects.map((s) => s.code);
  const rows: { dayOfWeek: number; startMin: number; endMin: number; subjectCode: string; source: string }[] = [];
  for (let day = 1; day <= 6; day++) {
    const periods = DEMO_PERIODS.slice(0, day === 6 ? 3 : 4 + ((day * 7) % 2)); // Saturday shorter
    periods.forEach((p, idx) => {
      rows.push({
        dayOfWeek: day,
        startMin: minutesFromHHMM(p.start),
        endMin: minutesFromHHMM(p.end),
        subjectCode: demoSubjectFor(day, idx, codes),
        source: "demo",
      });
    });
  }
  await db.timetableSlot.createMany({ data: rows });
  await setRawSetting(SEED_FLAG, "1");
}

export async function listSlots(): Promise<SlotRow[]> {
  const slots = await db.timetableSlot.findMany({
    orderBy: [{ dayOfWeek: "asc" }, { startMin: "asc" }],
  });
  return slots.map((s) => ({
    id: s.id,
    dayOfWeek: s.dayOfWeek,
    startMin: s.startMin,
    endMin: s.endMin,
    subjectCode: s.subjectCode,
    source: s.source,
  }));
}

export interface SlotStatus {
  status: "ongoing" | "upcoming" | "done";
  minutesUntilStart?: number;
  minutesUntilEnd?: number;
}

/** Classify a slot against a "now" (minutes since midnight + day). */
export function classifySlot(
  slot: { dayOfWeek: number; startMin: number; endMin: number },
  nowDay: number,
  nowMin: number
): SlotStatus {
  if (slot.dayOfWeek !== nowDay) {
    return { status: slot.dayOfWeek > nowDay || (nowDay === 0 && slot.dayOfWeek === 6) ? "upcoming" : "done" };
  }
  if (nowMin >= slot.startMin && nowMin < slot.endMin) {
    return { status: "ongoing", minutesUntilEnd: slot.endMin - nowMin };
  }
  if (nowMin < slot.startMin) {
    return { status: "upcoming", minutesUntilStart: slot.startMin - nowMin };
  }
  return { status: "done" };
}
