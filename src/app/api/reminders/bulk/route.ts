import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/reminders/bulk — the housekeeping sweep endpoint (r107).
 *
 * Body: { action: "dismiss" | "done" | "delete", ids: string[] }
 *
 * Rules (mirroring the single-item routes, so the bulk path can never do
 * what the row UI would refuse):
 *  - ATTENDANCE_WARNING rows are never touched: they are auto-managed by
 *    the attendance sync and each describes live risk, not dead homework.
 *  - "delete" applies to PERSONAL reminders only — an ERP row deleted here
 *    would be recreated by the next sync (source of truth = ERP). ERP rows
 *    swept from the housekeeping dialog arrive as "dismiss", which the
 *    assignment upsert respects (see reminder-hygiene.nextAssignmentStatus).
 *  - Unknown ids are skipped, not fatal: the client built the id list from
 *    a snapshot that may be seconds stale (a sync could have removed a row
 *    in between). The response reports every skip with its reason so the
 *    toast can be honest about what actually happened.
 *
 * Returns: { changed, perAction: {dismiss,done,delete}, skipped: [{id, reason}] }
 * A ChangeEvent row records the sweep for the audit trail (quiet — no
 * notification spam for a deliberate, student-initiated cleanup).
 */
const BULK_ACTIONS = ["dismiss", "done", "delete"] as const;
type BulkAction = (typeof BULK_ACTIONS)[number];

const STATUS_FOR: Record<Exclude<BulkAction, "delete">, string> = {
  dismiss: "DISMISSED",
  done: "DONE",
};

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}) as Record<string, unknown>);
    const action = body.action as BulkAction;
    if (!BULK_ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: "Invalid action — expected dismiss, done or delete" },
        { status: 400 }
      );
    }
    const ids = Array.isArray(body.ids)
      ? (body.ids as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: "No reminder ids supplied" }, { status: 400 });
    }
    if (ids.length > 200) {
      return NextResponse.json({ error: "Too many ids (max 200 per sweep)" }, { status: 400 });
    }

    const rows = await db.reminder.findMany({ where: { id: { in: ids } } });
    const byId = new Map(rows.map((r) => [r.id, r]));

    const skipped: { id: string; reason: string }[] = [];
    const toStatus: string[] = [];
    const toDelete: string[] = [];

    for (const id of ids) {
      const row = byId.get(id);
      if (!row) {
        skipped.push({ id, reason: "No longer exists (already synced away or deleted)" });
        continue;
      }
      if (row.type === "ATTENDANCE_WARNING") {
        skipped.push({ id, reason: "Attendance warnings are auto-managed by the sync" });
        continue;
      }
      if (action === "delete") {
        if (row.source !== "PERSONAL") {
          skipped.push({ id, reason: "ERP reminders are sync-owned — use Dismiss instead" });
          continue;
        }
        toDelete.push(id);
      } else {
        if (row.status === STATUS_FOR[action]) {
          skipped.push({ id, reason: `Already ${action === "done" ? "marked done" : "dismissed"}` });
          continue;
        }
        toStatus.push(id);
      }
    }

    // One transaction so a partial sweep can never persist.
    const result = await db.$transaction(async (tx) => {
      let statusChanged = 0;
      let deleted = 0;
      if (toStatus.length > 0) {
        const r = await tx.reminder.updateMany({
          where: { id: { in: toStatus } },
          data: { status: STATUS_FOR[action as Exclude<BulkAction, "delete">] },
        });
        statusChanged = r.count;
      }
      if (toDelete.length > 0) {
        // The source re-check in the WHERE keeps the PERSONAL-only rule
        // enforced at the database step, not just in the loop above.
        const r = await tx.reminder.deleteMany({
          where: { id: { in: toDelete }, source: "PERSONAL" },
        });
        deleted = r.count;
      }
      return { statusChanged, deleted };
    });

    const changed = result.statusChanged + result.deleted;
    if (changed > 0) {
      const detail =
        action === "delete"
          ? `${result.deleted} personal reminder${result.deleted === 1 ? "" : "s"} deleted via bulk cleanup`
          : `${result.statusChanged} reminder${result.statusChanged === 1 ? "" : "s"} marked ${action === "done" ? "done" : "dismissed"} via bulk cleanup`;
      await db.changeEvent.create({ data: { kind: "REMINDER_UPSERTED", subjectCode: null, detail } });
    }

    return NextResponse.json({
      changed,
      perAction: {
        dismiss: action === "dismiss" ? result.statusChanged : 0,
        done: action === "done" ? result.statusChanged : 0,
        delete: result.deleted,
      },
      skipped,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Bulk update failed" },
      { status: 500 }
    );
  }
}
