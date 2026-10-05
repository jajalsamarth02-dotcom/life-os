/**
 * r116 — pinned tests for the multi-candidate decryptSecret recovery.
 * Run: bun scripts/test-crypto-multik-r116.ts
 *
 * Each scenario runs in a FRESH bun subprocess with a controlled cwd and
 * environment (the module caches its key-file probe per process, which is
 * exactly the behavior under test). Scenarios replay the r116 incident:
 * a spawn whose priority key resolution differed from the key that
 * encrypted the stored credentials must still decrypt, and a record that
 * NOTHING can decrypt must fail with the honest original error.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const ROOT = "/home/z/my-project";
const CRYPTO_TS = `${ROOT}/src/lib/crypto.ts`;
const FALLBACK_SEED = "erp-sync-student-app::fallback-key";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else {
    fail++;
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Encrypt a secret under a SPECIFIC hex key (mirrors encryptSecret). */
function encUnder(hexKey: string, plain: string): string {
  const out = execFileSync(
    "bun",
    ["-e", `
      import crypto from "crypto";
      const key = Buffer.from(process.argv[1], "hex");
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv("aes-256-gcm", key, iv);
      const enc = Buffer.concat([c.update(process.argv[2], "utf8"), c.final()]);
      process.stdout.write(iv.toString("base64") + ":" + c.getAuthTag().toString("base64") + ":" + enc.toString("base64"));
    `, hexKey, plain],
    { cwd: ROOT }
  ).toString();
  return out;
}

const FALLBACK_KEY_HEX = execFileSync(
  "bun",
  ["-e", `import crypto from "crypto"; process.stdout.write(crypto.createHash("sha256").update(${JSON.stringify(FALLBACK_SEED)}).digest("hex"));`],
  { cwd: ROOT }
).toString();

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);
const KEY_C = "c".repeat(64);
const SECRET = "s3cret-password-123";

/** Scenario runner: builds a temp cwd (with/without db/encryption.key),
 *  runs decryptSecret in a subprocess with the given env, returns the
 *  outcome. */
function runDecrypt(opts: {
  fileKey?: string | null; // write db/encryption.key unless null
  envKey?: string | null; // set APP_ENCRYPTION_KEY unless null
  payload: string;
}): { ok: boolean; out: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "r116-probe-"));
  try {
    if (opts.fileKey != null) {
      mkdirSync(path.join(dir, "db"), { recursive: true });
      writeFileSync(path.join(dir, "db", "encryption.key"), opts.fileKey);
    }
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    delete env.APP_ENCRYPTION_KEY;
    if (opts.envKey != null) env.APP_ENCRYPTION_KEY = opts.envKey;
    const script = `
      import { decryptSecret } from ${JSON.stringify(CRYPTO_TS)};
      try {
        const plain = decryptSecret(process.argv[1]);
        process.stdout.write("OK:" + plain);
      } catch (e) {
        process.stdout.write("THROW:" + (e instanceof Error ? e.message : String(e)));
      }
    `;
    const out = execFileSync("bun", ["-e", script, opts.payload], { cwd: dir, env }).toString();
    return { ok: out.startsWith("OK:"), out };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* 1. THE r116 INCIDENT: priority env key is WRONG, file key is RIGHT →
      must decrypt via the file candidate (pre-fix: threw "key changed?"). */
const p1 = encUnder(KEY_A, SECRET);
const r1 = runDecrypt({ fileKey: KEY_A, envKey: KEY_B, payload: p1 });
check("incident: wrong env + right file decrypts", r1.ok && r1.out === `OK:${SECRET}`, r1.out);

/* 2. right env, no file → priority env path (unchanged). */
const r2 = runDecrypt({ fileKey: null, envKey: KEY_A, payload: p1 });
check("right env + no file decrypts", r2.ok && r2.out === `OK:${SECRET}`, r2.out);

/* 3. no env, right file → file fallback (unchanged). */
const r3 = runDecrypt({ fileKey: KEY_A, envKey: null, payload: p1 });
check("no env + right file decrypts", r3.ok && r3.out === `OK:${SECRET}`, r3.out);

/* 4. record written under the DETERMINISTIC FALLBACK key (pre-hardening
      data), env + file both present but wrong → fallback candidate wins. */
const p4 = encUnder(FALLBACK_KEY_HEX, SECRET);
const r4 = runDecrypt({ fileKey: KEY_B, envKey: KEY_C, payload: p4 });
check("fallback-key record decrypts when env+file wrong", r4.ok && r4.out === `OK:${SECRET}`, r4.out);

/* 5. record under a key that NO source knows → honest original throw. */
const p5 = encUnder(KEY_C, SECRET);
const r5 = runDecrypt({ fileKey: KEY_A, envKey: KEY_B, payload: p5 });
check("unknown-key record throws honestly", !r5.ok && r5.out.startsWith("THROW:"), r5.out);

/* 6. same-process roundtrip unchanged (encrypt uses the priority key). */
const r6 = execFileSync(
  "bun",
  ["-e", `
    import { encryptSecret, decryptSecret } from ${JSON.stringify(CRYPTO_TS)};
    const enc = encryptSecret(${JSON.stringify(SECRET)});
    process.stdout.write("OK:" + decryptSecret(enc));
  `],
  { cwd: ROOT, env: { ...process.env } }
).toString();
check("same-process roundtrip", r6 === `OK:${SECRET}`, r6);

/* 7. LIVE REGRESSION — the real stored ERP credential (read-only) decrypts
      under the current sources. This is the record whose failure at
      13:28:45 UTC triggered the r116 hardening. */
const realScript = `
  import { PrismaClient } from ${JSON.stringify(`${ROOT}/node_modules/@prisma/client`)};
  import { decryptSecret } from ${JSON.stringify(CRYPTO_TS)};
  const db = new PrismaClient();
  const conn = await db.erpConnection.findFirst();
  await db.$disconnect();
  if (!conn) { process.stdout.write("SKIP:no-connection"); process.exit(0); }
  try {
    const u = decryptSecret(conn.secretEnc);
    process.stdout.write("OK:len" + u.length);
  } catch (e) {
    process.stdout.write("THROW:" + (e instanceof Error ? e.message : String(e)));
  }
`;
const r7 = execFileSync("bun", ["-e", realScript], { cwd: ROOT, env: { ...process.env } }).toString();
check("real credential decrypts (read-only)", r7.startsWith("OK:"), r7);

console.log(`\ncrypto-multik r116: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
