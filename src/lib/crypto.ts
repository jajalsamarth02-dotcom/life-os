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
 * never auto-persists the fallback (that would silently pin a weak key).
 *
 * r105 self-heal — the incident recurred (the r104 cron commit stripped .env
 * again AND the key file vanished mid-life): a keyless boot null-caches the
 * file probe, and that null was sticky, so restoring the file on disk could
 * not heal the RUNNING process — every scheduled sync failed until a manual
 * restart (39h outage). decryptSecret now invalidates the cached file probe
 * on failure and retries ONCE, so a file restored under a live server heals
 * on the next attempt with no restart. The env-correct path is untouched
 * (a failed env key re-derives the same env key and still throws the
 * original error).
 *
 * r116 hardening — the recurrence took a THIRD form: a keeper-respawned dev
 * server resolved a different key than the one that encrypted the stored
 * credentials (spawn-environment lottery: cwd/env not inherited the way the
 * previous boot had them), so its first scheduled sync failed with "key
 * changed?" while the app's data sat intact. decryptSecret no longer
 * depends on the priority lottery: it tries EVERY key candidate (env, file
 * fallback, documented deterministic fallback) — a record encrypted under
 * any historically valid key still decrypts; encryptSecret keeps writing
 * with the priority key. If literally nothing decrypts the payload, the
 * original error is preserved and the caller's message stays honest. */

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

/** Every key the app has ever legitimately used, in priority order. Used by
 *  decryptSecret's multi-candidate recovery (r116) — NEVER by encryptSecret,
 *  which must keep producing ciphertext under the single priority key. */
function candidateKeys(): Buffer[] {
  const keys: Buffer[] = [];
  const hex = process.env.APP_ENCRYPTION_KEY;
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) keys.push(Buffer.from(hex, "hex"));
  const fromFile = readKeyFile();
  if (fromFile) keys.push(fromFile);
  keys.push(crypto.createHash("sha256").update("erp-sync-student-app::fallback-key").digest());
  return keys;
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
  const attempt = (key: Buffer) => {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  };
  // r116 multi-candidate recovery: try every legitimate key this app may
  // have written the record under (env, file, deterministic fallback). The
  // first success wins; GCM auth failures just move to the next candidate.
  let firstErr: unknown = new Error("No key candidates resolved");
  for (const key of candidateKeys()) {
    try {
      return attempt(key);
    } catch (err) {
      if (firstErr instanceof Error && firstErr.message !== "No key candidates resolved") {
        /* keep the FIRST (priority-key) error for the honest message */
      } else {
        firstErr = err;
      }
    }
  }
  // r105 self-heal (kept from the original fix): the file probe may be a
  // sticky cache derived from a disk state that has since changed (file
  // restored / rewritten under a live server). Invalidate it once and
  // re-derive every candidate before giving up.
  cachedFileKey = undefined;
  for (const key of candidateKeys()) {
    try {
      return attempt(key);
    } catch {
      /* fall through to the original error */
    }
  }
  throw firstErr;
}
