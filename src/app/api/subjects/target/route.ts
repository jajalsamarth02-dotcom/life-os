import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { effectiveTarget, getSettings, updateSettings } from "@/lib/settings";
import { recomputeAttendanceWarnings } from "@/lib/sync/engine";

export const dynamic = "force-dynamic";

/**
 * PUT /api/subjects/target — per-subject attendance target override.
 * Body: { code: string, targetPct: number | null }
 *   - number  → custom target for this subject (clamped 1–100)
 *   - null    → back to the global target
 *
 * Stored in app settings (not on the Subject row) so overrides survive
 * subject removal + re-add and never collide with the sync engine's writes.
 */
export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!code) {
      return NextResponse.json({ error: "code is required" }, { status: 400 });
    }
    const subject = await db.subject.findUnique({ where: { code } });
    if (!subject) {
      return NextResponse.json({ error: `Unknown subject: ${code}` }, { status: 404 });
    }

    const raw = body.targetPct;
    let override: number | null = null;
    if (raw !== null && raw !== undefined) {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        return NextResponse.json({ error: "targetPct must be a number or null" }, { status: 400 });
      }
      override = Math.min(100, Math.max(1, Math.round(n)));
    }

    const current = await getSettings();
    const nextTargets: Record<string, number> = { ...(current.subjectTargets ?? {}) };
    if (override === null) {
      delete nextTargets[code];
    } else {
      nextTargets[code] = override;
    }

    const next = await updateSettings({ subjectTargets: nextTargets });

    // warnings for this subject may appear/disappear — recompute locally (no ERP call)
    await recomputeAttendanceWarnings(next.targetPercentage, {
      subjectTargets: next.subjectTargets,
    });

    return NextResponse.json({
      ok: true,
      code,
      hasCustomTarget: override !== null,
      targetPct: effectiveTarget(code, next),
      subjectTargets: next.subjectTargets,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to set subject target" },
      { status: 400 }
    );
  }
}
