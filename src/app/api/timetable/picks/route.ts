import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { listSlots } from "@/lib/timetable";
import { getRawSetting, setRawSetting } from "@/lib/settings";
import {
  BATCH_PICKS_KEY,
  parallelCells,
  parseBatchPicks,
  validatePicks,
} from "@/lib/batch-picks";

export const dynamic = "force-dynamic";

/**
 * PUT /api/timetable/picks — resolve ONE parallel class window (the student
 * attends exactly one of ≥2 distinct classes sharing a wall time).
 * Body: { cellKey: "<day>-<startMin>-<endMin>", subjectCode: string | null }
 *
 * subjectCode null/"" clears the pick (the plan then counts every option for
 * that window again). Picks are stored content-derived (Round 53 lesson: slot
 * row ids churn on every sync, wall times don't) and pruned against the
 * current routine on every read/write, so a resync that moves a class simply
 * unresolves its window instead of ghost-filtering the plan. Clearing an
 * already-stale key is an idempotent no-op — stale UI state never wedges.
 */
export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const cellKey = typeof body.cellKey === "string" ? body.cellKey : "";
    const subjectCode = body.subjectCode;

    if (!/^\d+-\d+-\d+$/.test(cellKey)) {
      return NextResponse.json(
        { error: "cellKey must look like \"<day>-<startMin>-<endMin>\"" },
        { status: 400 }
      );
    }

    const slots = await listSlots();
    const cells = parallelCells(slots);
    const cell = cells.find((c) => c.key === cellKey);
    const picks = validatePicks(parseBatchPicks(await getRawSetting(BATCH_PICKS_KEY)), slots);

    if (subjectCode === null || subjectCode === undefined || subjectCode === "") {
      delete picks[cellKey];
    } else {
      if (typeof subjectCode !== "string") {
        return NextResponse.json(
          { error: "subjectCode must be a string or null" },
          { status: 400 }
        );
      }
      if (!cell) {
        return NextResponse.json(
          { error: "That time window has no parallel classes to pick between." },
          { status: 400 }
        );
      }
      if (!cell.options.includes(subjectCode)) {
        return NextResponse.json(
          { error: "Pick one of the parallel options for this window." },
          { status: 400 }
        );
      }
      picks[cellKey] = subjectCode;
    }

    if (Object.keys(picks).length > 0) {
      await setRawSetting(BATCH_PICKS_KEY, JSON.stringify(picks));
    } else {
      await db.setting.deleteMany({ where: { key: BATCH_PICKS_KEY } });
    }

    return NextResponse.json({ picks });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to save the pick" },
      { status: 500 }
    );
  }
}
