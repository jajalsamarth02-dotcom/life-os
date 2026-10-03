import crypto from "crypto";
import fs from "fs";
import path from "path";

/**
 * AES-256-GCM encryption for ERP credentials at rest.
 * Key comes from APP_ENCRYPTION_KEY (hex). Never expose encrypted payloads to the client.
 *
 * r100 hardening — the key-residency incident: the cron tooling rewrote .env
 * without APP_ENCRYPTION_KEY (commit c582a7f captured the loss); the long-
 * lived server kept its in-memory key until the OOM restart (11:14 UTC),
 * after which every scheduled sync failed with "Stored credentials could
 * not be decrypted". Key sources, in priority order:
 *   1. APP_ENCRYPTION_KEY env (the documented contract)
 *   2. db/encryption.key file (survives .env rewrites; gitignored)
 *   3. deterministic fallback (last resort — flagged in the doc comment)
 * The file is WRITTEN by tooling when a historic key is recovered; the app
 * never auto-persists the fallback (that would silently pin a weak key). */

let cachedFileKey: Buffer | null | undefined;

function readKeyFile(): Buffer | null {
  if (cachedFileKey !== undefined) return cachedFileKey;
  try {
    const p = path.join(process.cwd(), "db", "encryption.key");
    const hex = fs.readFileSync(p, "utf8").trim();
    cachedFileKey = /^[0-9a-fA-F]{64}$/.test(hex) ? Buffer.from(hex, "hex") : null;
  } catch {
    cachedFileKey = null;
  }
  return cachedFileKey;
}

function getKey(): Buffer {
  const hex = process.env.APP_ENCRYPTION_KEY;
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) {
    return Buffer.from(hex, "hex");
  }
  const fromFile = readKeyFile();
  if (fromFile) return fromFile;
  // Deterministic fallback so data survives restarts even without env config.
  // Real deployments should always set APP_ENCRYPTION_KEY or db/encryption.key.
  return crypto.createHash("sha256").update("erp-sync-student-app::fallback-key").digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed encrypted payload");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
