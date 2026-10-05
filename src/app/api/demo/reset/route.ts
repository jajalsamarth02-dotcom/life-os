import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { runSync } from "@/lib/sync/engine";

export const dynamic = "force-dynamic";

/**
 * POST /api/demo/reset — return the demo to its pristine baseline so the whole
 * pipeline can be demonstrated reproducibly:
 *
 *   • wipe timetable (re-seeded fresh on the next timetable request)
 *   • wipe attendance snapshots, change events, sync logs, notifications
 *   • wipe ERP-sourced reminders (demo exams re-arrive via sync with fresh dates)
 *   • wipe subject rows (recreated from the simulated ERP by the sync below)
 *   • reset the simulated ERP state (fresh attendance counters + exam dates)
 *
 * Kept: app settings (targets, cadence, notification prefs) and personal
 * reminders — those belong to the user, not to the demo dataset.
 */
export async function POST() {
  const settings = await getSettings();
  if (!settings.demoMode) {
    return NextResponse.json(
      { error: "Demo mode is off. Enable it in Settings first." },
      { status: 400 }
    );
  }

  const [timetableSlots, snapshots, changeEvents, syncLogs, notifications, erpReminders, subjects, alaNotes] =
    await db.$transaction([
      db.timetableSlot.deleteMany(),
      db.attendanceSnapshot.deleteMany(),
      db.changeEvent.deleteMany(),
      db.syncLog.deleteMany(),
      db.notification.deleteMany(),
      db.reminder.deleteMany({ where: { source: "ERP" } }),
      db.subject.deleteMany(),
      // Local ALA overlays die with the demo ERP rows that spawned them
      // (demo reset rebuilds a fresh simulated ERP — notes would orphan).
      db.alaNote.deleteMany(),
    ]);

  // Remove the simulator state + timetable seed flag; both consumers treat a
  // missing key as "first run" (initialState() / ensureDemoTimetable()).
  await db.setting.deleteMany({
    where: { key: { in: ["demo.erpState", "demo.timetableSeeded"] } },
  });

  const outcome = await runSync("manual");

  return NextResponse.json({
    ok: outcome.ok,
    message: outcome.ok
      ? "Demo data reset — fresh simulated ERP, timetable and history."
      : "Demo data was wiped but the first sync failed — press Sync Now to retry.",
    wiped: {
      timetableSlots: timetableSlots.count,
      snapshots: snapshots.count,
      changeEvents: changeEvents.count,
      syncLogs: syncLogs.count,
      notifications: notifications.count,
      erpReminders: erpReminders.count,
      subjects: subjects.count,
      alaNotes: alaNotes.count,
    },
  });
}
