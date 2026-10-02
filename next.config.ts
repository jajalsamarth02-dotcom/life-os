import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  /*
   * Ops stability (added after the 2026-10-02 memory incident): the sandbox
   * supervisor silently SIGTERMs next-server once its RSS crosses a watermark
   * (~1.35–1.6 GB observed). Turbopack's native heap is NOT capped by
   * NODE_OPTIONS --max-old-space-size, so it is capped here instead to keep
   * the dev server well under the kill line. This does not affect app code.
   */
  turbopack: {
    memoryLimit: 768,
  },
};

export default nextConfig;
