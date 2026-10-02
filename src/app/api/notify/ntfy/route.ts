import { NextRequest, NextResponse } from "next/server";
import {
  getNtfyStatus,
  saveNtfyConfig,
  setNtfyEnabled,
  setNtfyDigestTime,
  sendNtfyText,
  sendNtfyPendingDigest,
} from "@/lib/notify/ntfy";
import { compactErrorText } from "@/lib/compact-error";

export const dynamic = "force-dynamic";

/** GET /api/notify/ntfy — current configuration status (the topic never leaves the server unmasked). */
export async function GET() {
  const status = await getNtfyStatus();
  return NextResponse.json(status);
}

/**
 * POST /api/notify/ntfy — { action: "save" | "enable" | "setDigestTime" | "test" | "digest" }.
 * Nothing is ever sent while unconfigured or disabled — honest by design.
 */
export async function POST(req: NextRequest) {
  let body: { action?: string; topic?: string; server?: string; enabled?: boolean; time?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON body expected." }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "save": {
        if (!body.topic) {
          return NextResponse.json({ error: "A topic name is required." }, { status: 400 });
        }
        await saveNtfyConfig({ topic: body.topic, server: body.server, enabled: body.enabled });
        const status = await getNtfyStatus();
        return NextResponse.json({ ok: true, status });
      }
      case "enable": {
        await setNtfyEnabled(Boolean(body.enabled));
        const status = await getNtfyStatus();
        return NextResponse.json({ ok: true, status });
      }
      case "setDigestTime": {
        const time = typeof body.time === "string" && body.time.trim() ? body.time.trim() : null;
        await setNtfyDigestTime(time);
        const status = await getNtfyStatus();
        return NextResponse.json({ ok: true, status });
      }
      case "test": {
        const status = await getNtfyStatus();
        if (!status.configured) {
          return NextResponse.json({ error: "Save an ntfy topic first." }, { status: 409 });
        }
        const res = await sendNtfyText("✅ ERP Sync test — ntfy push is working.", "ERP Sync test");
        return NextResponse.json({ ok: res.ok, snippet: res.snippet });
      }
      case "digest": {
        const status = await getNtfyStatus();
        if (!status.configured) {
          return NextResponse.json({ error: "Save an ntfy topic first." }, { status: 409 });
        }
        const res = await sendNtfyPendingDigest("manual");
        return NextResponse.json({ ok: res.ok, snippet: res.snippet, text: res.text });
      }
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: compactErrorText(e instanceof Error ? e.message : "ntfy action failed") }, { status: 400 });
  }
}
