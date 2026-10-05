import { NextRequest, NextResponse } from "next/server";
import { runSync, getSyncState } from "@/lib/sync/engine";

export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/sync — the serverless-friendly sync trigger.
 *
 * WHY THIS EXISTS: the in-process scheduler (src/instrumentation.ts →
 * startScheduler) only ticks while a long-lived server is alive. On Vercel's
 * serverless runtime there is no always-on process, so the 15-minute cadence
 * must be driven from OUTSIDE — Vercel Cron hitting this endpoint (see
 * vercel.crons.example.json and DEPLOY.md).
 *
 * AUTH: Vercel Cron automatically sends `Authorization: Bearer $CRON_SECRET`
 * when the CRON_SECRET environment variable is configured on the project.
 * Without a configured secret this endpoint is a hard 503 — an open,
 * unauthenticated sync trigger on a public URL would be a spam/DoS handle.
 * (Manual sync stays on POST /api/sync from the app UI.)
 *
 * CONCURRENCY: runSync("scheduled") is guarded by the engine's own lock —
 * an overlapping cron hit reports skipped/SYNC_IN_PROGRESS instead of
 * double-syncing. Never erases previously synchronized data on failure.
 */

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

function unauthorized() {
  return NextResponse.json(
    {
      ok: false,
      error: "UNAUTHORIZED",
      message:
        "Set CRON_SECRET in the deployment environment and let Vercel Cron send it as a Bearer token (or call with Authorization: Bearer $CRON_SECRET).",
    },
    { status: 503 }
  );
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return unauthorized();
  const outcome = await runSync("scheduled");
  const state = await getSyncState();
  return NextResponse.json(
    { ...outcome, state: { status: state.status, lastSuccessAt: state.lastSuccessAt?.toISOString() ?? null } },
    { status: outcome.ok || outcome.skipped ? 200 : 502 }
  );
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return unauthorized();
  const outcome = await runSync("scheduled");
  return NextResponse.json(outcome, { status: outcome.ok || outcome.skipped ? 200 : 502 });
}
