import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/export — full JSON backup of everything this app knows.
 *
 * Data ownership: the local database is a read-only mirror of the ERP plus the
 * user's own personal data. This endpoint exports it in one portable file.
 *
 * NEVER included: ErpConnection.secretEnc / sessionCookieEnc (encrypted
 * credentials), any *.enc setting row (e.g. notify.wa.enc - the encrypted
 * WhatsApp CallMeBot config) and internal demo-simulator state ("demo.*").
 */
export async function GET() {
  try {
    const [subjects, reminders, slots, syncLogs, changeEvents, notifications, settings, connections] =
      await Promise.all([
        db.subject.findMany({ orderBy: { code: "asc" } }),
        db.reminder.findMany({ orderBy: { dueAt: "asc" } }),
        db.timetableSlot.findMany({ orderBy: [{ dayOfWeek: "asc" }, { startMin: "asc" }] }),
        db.syncLog.findMany({ orderBy: { startedAt: "desc" }, take: 300 }),
        db.changeEvent.findMany({ orderBy: { createdAt: "desc" }, take: 300 }),
        db.notification.findMany({ orderBy: { createdAt: "desc" }, take: 300 }),
        db.setting.findMany({ orderBy: { key: "asc" } }),
        db.erpConnection.findMany(),
      ]);

    const conn = connections[0];

    const backup = {
      meta: {
        app: "erp-sync",
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        note: "Read-only mirror of the ERP + personal data. Encrypted credentials and *.enc settings are never exported.",
      },
      subjects: subjects.map((s) => ({
        code: s.code,
        name: s.name,
        present: s.present,
        total: s.total,
        active: s.active,
        addedAt: s.addedAt,
        updatedAt: s.updatedAt,
      })),
      reminders: reminders.map((r) => ({
        title: r.title,
        description: r.description,
        type: r.type,
        source: r.source,
        externalId: r.externalId,
        dueAt: r.dueAt,
        status: r.status,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
      timetable: slots.map((s) => ({
        dayOfWeek: s.dayOfWeek,
        start: s.startMin,
        end: s.endMin,
        subjectCode: s.subjectCode,
        source: s.source,
      })),
      syncLogs: syncLogs.map((l) => ({
        trigger: l.trigger,
        mode: l.mode,
        status: l.status,
        changes: l.changes,
        durationMs: l.durationMs,
        summary: l.summary,
        errorDetails: l.errorDetails,
        startedAt: l.startedAt,
        finishedAt: l.finishedAt,
      })),
      changeEvents: changeEvents.map((c) => ({
        kind: c.kind,
        subjectCode: c.subjectCode,
        detail: c.detail,
        createdAt: c.createdAt,
      })),
      notifications: notifications.map((n) => ({
        type: n.type,
        title: n.title,
        message: n.message,
        severity: n.severity,
        read: n.read,
        createdAt: n.createdAt,
      })),
      settings: settings
        .filter((s) => !s.key.startsWith("demo.") && !s.key.endsWith(".enc"))
        .map((s) => ({ key: s.key, value: s.value })),
      erpConnection: conn
        ? {
            username: conn.username,
            status: conn.status,
            lastVerifiedAt: conn.lastVerifiedAt,
            createdAt: conn.createdAt,
            // secretEnc / sessionCookieEnc intentionally omitted
          }
        : null,
    };

    const filename = `erp-sync-backup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
    return new NextResponse(JSON.stringify(backup, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to build backup" },
      { status: 500 }
    );
  }
}
