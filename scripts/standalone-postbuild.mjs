#!/usr/bin/env node
/**
 * Standalone post-build step (2026-10-05, Vercel-compat pass).
 *
 * `output: "standalone"` produces .next/standalone/server.js WITHOUT the
 * static assets and the public/ folder — the documented Next recipe is to
 * copy them in after the build for self-hosted runs (see package.json
 * `start`). On VERCEL this is not wanted: Vercel does its own serverless
 * packaging and `.next/standalone` is not the deployed artifact, so copying
 * there would only bloat the build step (and on a read-only FS could fail).
 *
 * Rules:
 *   - VERCEL=1  → exit 0 immediately (Vercel handles packaging).
 *   - No .next/standalone → exit 0 with a note (nothing to assemble).
 *   - Otherwise → copy .next/static and public/ into the standalone dir
 *     (cross-platform, no shell dependency — replaces the old `cp -r …`
 *     chain so Windows developers can build too).
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

if (process.env.VERCEL === "1") {
  console.log("[postbuild] VERCEL detected — skipping standalone assembly (Vercel packages the app itself).");
  process.exit(0);
}

const standaloneDir = path.join(root, ".next", "standalone");
if (!existsSync(standaloneDir)) {
  console.log("[postbuild] no .next/standalone output — nothing to assemble (non-standalone build).");
  process.exit(0);
}

const jobs = [
  { from: path.join(root, ".next", "static"), to: path.join(standaloneDir, ".next", "static") },
  { from: path.join(root, "public"), to: path.join(standaloneDir, "public") },
];

for (const { from, to } of jobs) {
  if (!existsSync(from)) {
    console.warn(`[postbuild] WARN source missing, skipped: ${path.relative(root, from)}`);
    continue;
  }
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  console.log(`[postbuild] copied ${path.relative(root, from)} → ${path.relative(root, to)}`);
}

console.log("[postbuild] standalone assembly complete — run it with `npm run start` (or `bun run start`).");
