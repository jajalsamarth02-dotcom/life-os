import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { submitAssignment, ALA_ACCEPT } from "@/lib/erp/live";
import { compactErrorText } from "@/lib/compact-error";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB — generous for ALA uploads
const ASSIGNMENT_EXT_PREFIX = "erp:assign:";

/**
 * POST /api/assignments/{id}/submit — upload ONE ALA to the ERP portal.
 *
 * Multipart form-data: file (optional) + link (optional). The ERP requires at
 * least one of them. This is ALWAYS user-initiated (per-row button + confirm
 * dialog) — the app never submits on its own. The ERP remains the source of
 * truth: success is only claimed when the ERP's own page shows
 * "Submission Status: Submitted" after the POST.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  // 1) the local mirror row must exist, be a real ERP assignment, not done
  const row = await db.reminder.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "ALA row not found." }, { status: 404 });
  if (row.type !== "ASSIGNMENT" || !row.externalId?.startsWith(ASSIGNMENT_EXT_PREFIX)) {
    return NextResponse.json({ error: "This row is not an ERP-tracked ALA/assignment." }, { status: 400 });
  }
  if (row.status === "DONE") {
    return NextResponse.json({ error: "This ALA is already marked as submitted." }, { status: 409 });
  }

  // 2) parse the upload
  let file: { name: string; type: string; data: Buffer } | undefined;
  let link: string | undefined;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f && typeof f !== "string") {
      if (f.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: "File too large — the limit is 10 MB." }, { status: 413 });
      }
      const lower = f.name.toLowerCase();
      if (!ALA_ACCEPT.some((ext) => lower.endsWith(ext))) {
        return NextResponse.json(
          { error: `File type not accepted by the ERP. Allowed: ${ALA_ACCEPT.join(" ")}` },
          { status: 415 }
        );
      }
      file = {
        name: f.name,
        type: f.type || "application/octet-stream",
        data: Buffer.from(await f.arrayBuffer()),
      };
    }
    const l = form.get("link");
    if (typeof l === "string" && l.trim()) link = l.trim();
  } catch {
    return NextResponse.json({ error: "Could not read the upload (multipart form expected)." }, { status: 400 });
  }
  if (!file && !link) {
    return NextResponse.json(
      { error: "Attach a file or provide a link — the ERP needs one of them." },
      { status: 400 }
    );
  }

  // 3) credentials (AES-256-GCM at rest — same as sync)
  const conn = await db.erpConnection.findFirst({ orderBy: { createdAt: "desc" } });
  if (!conn) {
    return NextResponse.json({ error: "No ERP connection configured." }, { status: 409 });
  }
  let password: string;
  let savedCookie: string | null = null;
  try {
    password = decryptSecret(conn.secretEnc);
    if (conn.sessionCookieEnc) savedCookie = decryptSecret(conn.sessionCookieEnc);
  } catch {
    return NextResponse.json({ error: "Stored credentials could not be decrypted." }, { status: 500 });
  }

  // 4) submit (3 polite ERP requests; explicit-only by design)
  const erpId = row.externalId.slice(ASSIGNMENT_EXT_PREFIX.length);
  try {
    const result = await submitAssignment(conn.username, password, savedCookie, {
      externalId: erpId,
      file,
      link,
    });
    if (result.sessionCookie) {
      await db.erpConnection.update({
        where: { id: conn.id },
        data: { sessionCookieEnc: encryptSecret(result.sessionCookie) },
      });
    }

    if (result.ok && result.confirmedSubmitted) {
      // Mirror exactly what the sync engine does when it sees "Submitted".
      await db.reminder.update({
        where: { id: row.id },
        data: { status: "DONE", updatedAt: new Date() },
      });
      await db.notification.create({
        data: {
          type: "ALA_SUBMITTED",
          title: `ALA submitted — ${row.title}`,
          message: `Uploaded to erp.gmiu.edu.in via the app and confirmed by the ERP page${
            file ? ` (file: ${file.name})` : link ? ` (link: ${link})` : ""
          }. The next sync will keep it consistent.`,
          severity: "success",
        },
      });
      return NextResponse.json({ ok: true, confirmed: true, message: result.message });
    }

    return NextResponse.json({ ok: false, confirmed: false, message: result.message }, { status: 502 });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return NextResponse.json(
      {
        ok: false,
        confirmed: false,
        error: compactErrorText(err?.message ?? "Submission failed"),
        code: err?.code ?? "UNKNOWN",
      },
      { status: 502 }
    );
  }
}
