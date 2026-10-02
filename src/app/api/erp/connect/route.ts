import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { fetchLiveSnapshot } from "@/lib/erp/live";
import { SyncError } from "@/lib/erp/types";
import { updateSettings, getSettings } from "@/lib/settings";
import { runSync } from "@/lib/sync/engine";

export const dynamic = "force-dynamic";

/**
 * POST /api/erp/connect
 * Body: { username, password }
 *
 * Verifies the credentials against the real ERP from the server side, stores
 * them AES-256-GCM encrypted, and disables demo mode. Never exposes the
 * password or session cookie back to the client.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || !password) {
      return NextResponse.json({ error: "ERP email and password are required." }, { status: 400 });
    }

    try {
      const result = await fetchLiveSnapshot(username, password, null);

      await db.erpConnection.deleteMany({});
      await db.erpConnection.create({
        data: {
          username,
          secretEnc: encryptSecret(password),
          sessionCookieEnc: result.sessionCookie ? encryptSecret(result.sessionCookie) : null,
          status: "connected",
          lastVerifiedAt: new Date(),
        },
      });
      await updateSettings({ demoMode: false });

      // apply the freshly fetched ERP data right away
      const sync = await runSync("manual");

      return NextResponse.json({
        ok: true,
        username,
        snapshotSubjects: result.snapshot?.subjects.length ?? 0,
        sync,
      });
    } catch (err) {
      if (err instanceof SyncError) {
        // store credentials even on auth/parse issues so the user can retry quickly,
        // but mark the connection status honestly
        const persist = err.code === "PARSE_FAILED" || err.code === "AUTH_FAILED";
        if (persist) {
          await db.erpConnection.deleteMany({});
          await db.erpConnection.create({
            data: {
              username,
              secretEnc: encryptSecret(password),
              status: "failed",
              lastError: err.message,
              lastVerifiedAt: new Date(),
            },
          });
        }
        return NextResponse.json(
          { ok: false, errorCode: err.code, error: err.message, details: err.details },
          { status: 401 }
        );
      }
      throw err;
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Connection failed" },
      { status: 500 }
    );
  }
}
