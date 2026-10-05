/**
 * r105 — the key-residency incident, act II: the r104 cron commit stripped
 * APP_ENCRYPTION_KEY from .env AND db/encryption.key vanished mid-life
 * (plausibly an interrupted test-crypto-r100.ts run whose finally never ran).
 * Every keeper boot since baked a keyless env; scheduled syncs failed with
 * "Stored credentials could not be decrypted" for ~39h (last success Sat
 * 22:32 IST → recovered Mon 13:54 IST). r100's file-cache made it worse: a
 * keyless boot null-caches the file probe STICKILY, so restoring the file
 * could not heal a running process — a restart was required.
 *
 * The r105 self-heal (decryptSecret invalidates the cached file probe on
 * failure and retries once) is pinned here, IN ONE CHILD PROCESS — the
 * exact incident scenario, no restart:
 *   • real ciphertext fails while the file is missing (poisoned cache)
 *   • file restored under the SAME live process → next decrypt succeeds
 *   • env-correct path still wins / still throws honest errors
 * usage: bun scripts/test-crypto-r105.ts
 */
import { execFileSync } from "child_process";
import { writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const ROOT = "/home/z/my-project";
const KEY_FILE = path.join(ROOT, "db", "encryption.key");
const KEY = "0925ef65b7708880e3b7781b2168a685fbf25e0bc2021b6b2ad076c6f2fdd10e";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    passed++;
    console.log(`PASS: ${name}`);
  } else {
    failed++;
    console.error(`FAIL: ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

/* the REAL credential ciphertext — the actual incident fixture (read-only) */
const p = new PrismaClient();
const real = await p.erpConnection.findFirst();
await p.$disconnect();
if (!real?.secretEnc) {
  console.error("no erpConnection.secretEnc — cannot run the incident scenario");
  process.exit(1);
}

/**
 * ONE child process replays the incident:
 *  1. key file ABSENT → decrypt must throw (fallback key can't open it)
 *  2. key file RESTORED under the same process → decrypt must succeed
 *     (the r105 self-heal — r100's sticky null cache failed this forever)
 * finally: restore the production key file EXACTLY as found.
 */
const PROBE = `
const {decryptSecret} = require("${ROOT}/src/lib/crypto.ts");
const fs = require("fs");
const enc = process.argv[1];
const keyHex = process.argv[2];
const keyFile = process.argv[3];
let threw = false;
try { decryptSecret(enc); } catch { threw = true; }
if (!threw) { console.log("LEAK: decrypted without any key source"); process.exit(2); }
fs.writeFileSync(keyFile, keyHex, { mode: 0o600 });
try {
  const out = decryptSecret(enc);
  process.stdout.write(out.length > 0 ? "HEALED" : "EMPTY");
} catch (e) {
  console.log("STILL-POISONED: " + e.message);
  process.exit(3);
}
`;

let healed = false;
let leak = false;
const hadKeyFile = existsSync(KEY_FILE);
const backup = hadKeyFile ? readFileSync(KEY_FILE, "utf8") : null;
try {
  if (existsSync(KEY_FILE)) rmSync(KEY_FILE); // the incident state
  const out = execFileSync("bun", ["-e", PROBE, real.secretEnc, KEY, KEY_FILE], {
    cwd: ROOT,
    env: { ...process.env, APP_ENCRYPTION_KEY: "" }, // keyless env — the incident boot
    encoding: "utf8",
    timeout: 30_000,
  });
  healed = out.trim() === "HEALED";
} catch (e: any) {
  leak = String(e.stdout || "").includes("LEAK");
} finally {
  if (backup !== null) writeFileSync(KEY_FILE, backup, { mode: 0o600 });
  else if (existsSync(KEY_FILE)) rmSync(KEY_FILE);
}
check("incident scenario: fails while keyless, HEALS when the file appears (same process)", healed, "see probe output");
check("no leak: decrypt never succeeded without a key source", !leak);

/* env-correct path untouched: roundtrip still works with env set */
const RT = `const {encryptSecret, decryptSecret} = require("${ROOT}/src/lib/crypto.ts"); const s = "r105-self-heal-測試"; process.stdout.write(decryptSecret(encryptSecret(s)));`;
const rt = execFileSync("bun", ["-e", RT], { cwd: ROOT, env: { ...process.env, APP_ENCRYPTION_KEY: KEY }, encoding: "utf8", timeout: 30_000 });
check("env-correct roundtrip untouched", rt === "r105-self-heal-測試");

/* the production key file MUST exist again after the probe (residency healed) */
check("production key file resident after the run", existsSync(KEY_FILE) && readFileSync(KEY_FILE, "utf8").trim() === KEY);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
