import type { NextConfig } from "next";

/*
 * Deploy-target awareness (2026-10-05, Vercel-compat pass):
 * - LOCAL / self-host (Docker-style runtimes): `output: "standalone"` powers
 *   `bun run start` (.next/standalone/server.js).
 * - VERCEL: standalone is deliberately OMITTED — Vercel performs its own
 *   serverless packaging and the Next docs recommend not setting it there.
 *   Vercel injects VERCEL=1 into every build, so the switch is automatic.
 */
const isVercel = process.env.VERCEL === "1";

const nextConfig: NextConfig = {
  ...(isVercel ? {} : { output: "standalone" as const }),
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  /* Dev-only: force a config-driven server restart after prisma generate +
     .next/dev cache wipe (2026-10-03), so the bundler reloads the regenerated
     Prisma client (adds the AlaNote delegate). Harmless in production. */
  env: {
    NEXT_PUBLIC_SCHEMA_REV: "2026-10-03-ala-notes",
  },
  /*
   * Vercel-compat: the app's runtime state lives in FILES — the SQLite
   * database (db/custom.db) and the at-rest encryption key
   * (db/encryption.key, with APP_ENCRYPTION_KEY as the env-first
   * alternative — see src/lib/crypto.ts). Next's output file tracing only
   * follows imports, so runtime fs reads like these would be MISSING from
   * the serverless bundle and crash every API route on a fresh deploy.
   * This pins the whole db/ directory into the traced bundle for every
   * route (~230 KB today — trivial). NOTE on Vercel the filesystem is
   * read-only outside /tmp: point DATABASE_URL at a writable file (e.g.
   * file:/tmp/custom.db) and set APP_ENCRYPTION_KEY — full guide in
   * DEPLOY.md.
   */
  outputFileTracingIncludes: {
    "/**": ["./db/**/*"],
  },
  /*
   * Prisma's query engine is a native binary resolved at runtime; keep the
   * client external to the bundler so the traced engine binary is used
   * as-is instead of being processed (the standard Next + Prisma recipe).
   */
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
  /*
   * Ops stability (added after the 2026-10-02 memory incident): the sandbox
   * supervisor silently SIGTERMs next-server once its RSS crosses a watermark
   * (~1.35–1.6 GB observed). Turbopack's native heap is NOT capped by
   * NODE_OPTIONS --max-old-space-size, so it is capped here instead to keep
   * the dev server well under the kill line. This does not affect app code.
   * (Fixed 2026-10-03: in Next 16 the option lives at experimental.
   * turbopackMemoryLimit — the old turbopack.memoryLimit was silently
   * ignored, so the cap was never actually applied.)
   */
  experimental: {
    turbopackMemoryLimit: 768,
  },
};

export default nextConfig;
