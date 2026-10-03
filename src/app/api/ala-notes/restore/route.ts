import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ASSIGNMENT_EXT_PREFIX } from "@/lib/sync/engine";

export const dynamic = "force-dynamic";

const MAX_NOTE_LEN = 2000;
const PRIORITIES = new Set([0, 1, 2, 3]);
/** Never accept more than a sane number of rows in one restore call. */
const MAX_ROWS = 500;

interface RestoreEntry {
  externalId: string;
  note: string;
  priority: number;
}

/**
 * POST /api/ala-notes/restore — batch-restore the private ALA note/priority
 * overlay from a backup file (Settings → Data & backups).
 *
 * MERGE-ONLY by design: matching externalIds are overwritten, unknown-but-valid
 * ids are upserted, rows that no longer exist in the local ERP mirror are
 * skipped (reported). A wiped overlay is never implicitly erased here — a
 * deliberate delete stays a single-row UI action.
 *
 * Body: { notes: [{ externalId, note?, priority? }] }
 * Response: { ok, created, updated, cleared, skipped, skippedIds, invalid }
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      notes?: unknown;
    } | null;

    const raw = Array.isArray(body?.notes) ? body!.notes : null;
    if (!raw) {
      return NextResponse.json({ error: "A notes array is required" }, { status: 400 });
    }
    if (raw.length === 0) {
      return NextResponse.json({ error: "The backup file contains no annotations" }, { status: 400 });
    }
    if (raw.length > MAX_ROWS) {
      return NextResponse.json(
        { error: `Too many rows (${raw.length}) — the restore cap is ${MAX_ROWS}` },
        { status: 400 }
      );
    }

    // Validate + normalize every entry up-front; invalid ones are counted, not fatal.
    const valid: RestoreEntry[] = [];
    let invalid = 0;
    const seen = new Set<string>();
    for (const item of raw) {
      const rec = item as Record<string, unknown> | null;
      const externalId = typeof rec?.externalId === "string" ? rec.externalId : "";
      if (!externalId.startsWith(ASSIGNMENT_EXT_PREFIX) || externalId.length <= ASSIGNMENT_EXT_PREFIX.length) {
        invalid++;
        continue;
      }
      if (seen.has(externalId)) continue; // dedupe — keep first occurrence
      seen.add(externalId);
      const note = typeof rec?.note === "string" ? rec.note.trim().slice(0, MAX_NOTE_LEN) : "";
      const priority =
        typeof rec?.priority === "number" && Number.isInteger(rec.priority) && PRIORITIES.has(rec.priority)
          ? rec.priority
          : 0;
      valid.push({ externalId, note, priority });
    }

    // Which entries still have a local ERP row to attach to?
    const ids = valid.map((v) => v.externalId);
    const existing = await db.reminder.findMany({
      where: { externalId: { in: ids } },
      select: { externalId: true },
    });
    const existingSet = new Set(existing.map((r) => r.externalId));

    const applicable = valid.filter((v) => existingSet.has(v.externalId));
    const skippedIds = valid.filter((v) => !existingSet.has(v.externalId)).map((v) => v.externalId);

    let created = 0;
    let updated = 0;
    let cleared = 0;

    await db.$transaction(async (tx) => {
      for (const entry of applicable) {
        const isEmpty = entry.note === "" && entry.priority === 0;
        const prior = await tx.alaNote.findUnique({ where: { externalId: entry.externalId } });

        if (isEmpty) {
          // Cleared annotation in the backup → leave no residue (matches POST semantics).
          if (prior) {
            await tx.alaNote.delete({ where: { externalId: entry.externalId } });
            cleared++;
          }
          continue;
        }

        await tx.alaNote.upsert({
          where: { externalId: entry.externalId },
          create: { externalId: entry.externalId, note: entry.note, priority: entry.priority },
          update: { note: entry.note, priority: entry.priority },
        });
        if (prior) updated++;
        else created++;
      }
    });

    return NextResponse.json({
      ok: true,
      created,
      updated,
      cleared,
      skipped: skippedIds.length,
      skippedIds: skippedIds.slice(0, 10),
      invalid,
      total: raw.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to restore ALA notes" },
      { status: 500 }
    );
  }
}
