/**
 * r100 — the key-residency incident: the cron tooling rewrote .env without
 * APP_ENCRYPTION_KEY; the long-lived server kept its in-memory key until the
 * OOM restart (11:14 UTC), after which every scheduled sync failed with
 * "Stored credentials could not be decrypted (key changed?)" and the setup
 * checklist regressed 1/4 → 0/4 (notify.wa.enc was equally unreadable).
 * Fix: crypto.ts resolves the key env → db/encryption.key → deterministic
 * fallback. Pinned here (each case in a CLEAN process):
 *   • roundtrip under every source (env, file, fallback)
 *   • the file source survives an env-less process — the incident scenario
 *   • env wins over file when both exist (documented contract)
 *   • the REAL db ciphertext decrypts with the recovered key (the actual
 *     credentials are the fixture — read-only)
 * Note: child processes run with cwd = project root, matching next-server.
 */
import { execFileSync } from "child_process";
import { writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import path from "path";

const ROOT = "/home/z/my-project";
const KEY_FILE = path.join(ROOT, "db", "encryption.key");
const KEY = "0925ef65b7708880e3b7781b2168a685fbf25e0bc2021b6b2ad076c6f2fdd10e";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

const PROBE = `
const {encryptSecret, decryptSecret} = require("${ROOT}/src/lib/crypto.ts");
const secret = process.argv[1];
const enc = encryptSecret(secret);
process.stdout.write(decryptSecret(enc));
`;

function runProbe(secret: string, env: Record<string, string>, withKeyFile: boolean): string {
  const hadKeyFile = existsSync(KEY_FILE);
  const backup = hadKeyFile ? readFileSync(KEY_FILE, "utf8") : null;
  try {
    if (withKeyFile) writeFileSync(KEY_FILE, KEY, { mode: 0o600 });
    else if (existsSync(KEY_FILE)) rmSync(KEY_FILE);
    const out = execFileSync("bun", ["-e", PROBE, secret], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      encoding: "utf8",
      timeout: 30_000,
    });
    return out;
  } finally {
    // restore the production key file EXACTLY as it was
    if (backup !== null) writeFileSync(KEY_FILE, backup, { mode: 0o600 });
    else if (existsSync(KEY_FILE)) rmSync(KEY_FILE);
  }
}

const SECRET = "erp-student-password-r100-測試";

/* 1. env source (the documented contract) */
check("env: roundtrip", runProbe(SECRET, { APP_ENCRYPTION_KEY: KEY }, false) === SECRET);
check("env: wins over file", runProbe(SECRET, { APP_ENCRYPTION_KEY: KEY }, true) === SECRET);

/* 2. the incident scenario: no env, key FILE present */
check("file: roundtrip without env", runProbe(SECRET, {}, true) === SECRET);

/* 3. fallback: neither env nor file — deterministic, still roundtrips */
check("fallback: roundtrip", runProbe(SECRET, {}, false) === SECRET);

/* 4. the REAL ciphertext: decrypts with the recovered key (read-only) */
const { PrismaClient } = require(`${ROOT}/node_modules/@prisma/client`);
const p = new PrismaClient();
const real = await p.erpConnection.findFirst();
let realOk = false;
try {
  const out = execFileSync(
    "bun",
    ["-e", `const {decryptSecret} = require("${ROOT}/src/lib/crypto.ts"); process.stdout.write(decryptSecret(process.argv[1]));`, real.secretEnc],
    { cwd: ROOT, env: { ...process.env, APP_ENCRYPTION_KEY: KEY }, encoding: "utf8", timeout: 30_000 }
  );
  realOk = out.length > 0;
} catch (e) {
  realOk = false;
}
check("real ciphertext decrypts with recovered key", realOk);
const waRow = await p.setting.findUnique({ where: { key: "notify.wa.enc" } });
let waOk = false;
try {
  const out = execFileSync(
    "bun",
    ["-e", `const {decryptSecret} = require("${ROOT}/src/lib/crypto.ts"); process.stdout.write(String(decryptSecret(process.argv[1]).length > 0));`, waRow.value],
    { cwd: ROOT, env: { ...process.env, APP_ENCRYPTION_KEY: KEY }, encoding: "utf8", timeout: 30_000 }
  );
  waOk = out.trim() === "true";
} catch {
  waOk = false;
}
check("real notify.wa.enc decrypts (checklist heals)", waOk);
await p.$disconnect();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
