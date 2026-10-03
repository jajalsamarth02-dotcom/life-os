import { NextRequest, NextResponse } from "next/server";
import {
  getWaStatus,
  saveWaConfig,
  setWaEnabled,
  setWaDigestTime,
  sendWhatsAppText,
  sendPendingDigest,
} from "@/lib/notify/whatsapp";
import { compactErrorText } from "@/lib/compact-error";

export const dynamic = "force-dynamic";

/** GET /api/notify/whatsapp — current configuration status (secrets never leave the server). */
export async function GET() {
  const status = await getWaStatus();
  return NextResponse.json(status);
}

/**
 * POST /api/notify/whatsapp — { action: "save" | "enable" | "setDigestTime" | "test" | "digest" }.
 * Nothing is ever sent while unconfigured or disabled — honest by design.
 */
export async function POST(req: NextRequest) {
  let body: { action?: string; phone?: string; apikey?: string; enabled?: boolean; time?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON body expected." }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "save": {
        if (!body.phone || !body.apikey) {
          return NextResponse.json({ error: "Phone and apikey are both required." }, { status: 400 });
        }
        await saveWaConfig({ phone: body.phone, apikey: body.apikey, enabled: body.enabled });
        const status = await getWaStatus();
        return NextResponse.json({ ok: true, status });
      }
      case "enable": {
        await setWaEnabled(Boolean(body.enabled));
        const status = await getWaStatus();
        return NextResponse.json({ ok: true, status });
      }
      case "setDigestTime": {
        const time = typeof body.time === "string" && body.time.trim() ? body.time.trim() : null;
        await setWaDigestTime(time);
        const status = await getWaStatus();
        return NextResponse.json({ ok: true, status });
      }
      case "test": {
        const status = await getWaStatus();
        if (!status.configured) {
          return NextResponse.json({ error: "Save your phone + apikey first." }, { status: 409 });
        }
        const res = await sendWhatsAppText("✅ ERP Sync test — WhatsApp alerts are working.");
        return NextResponse.json({ ok: res.ok, snippet: res.snippet });
      }
      case "digest": {
        const status = await getWaStatus();
        if (!status.configured) {
          return NextResponse.json({ error: "Save your phone + apikey first." }, { status: 409 });
        }
        const res = await sendPendingDigest("manual");
        return NextResponse.json({ ok: res.ok, snippet: res.snippet, text: res.text });
      }
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: compactErrorText(e instanceof Error ? e.message : "WhatsApp action failed") }, { status: 400 });
  }
}
