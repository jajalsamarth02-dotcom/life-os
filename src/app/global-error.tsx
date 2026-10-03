"use client";

/* Root-level error boundary (App Router convention: src/app/global-error.tsx).
   Only fires when the root layout itself fails — it must render its own
   <html>/<body>. Kept deliberately self-contained: it reads the persisted
   theme directly from localStorage (next-themes is not mounted here) so a
   dark-mode user still gets a dark recovery screen with zero providers. */

import { useEffect, useState } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    console.error("ERP Sync fatal error:", error);
    try {
      setDark(
        document.documentElement.classList.contains("dark") ||
          localStorage.getItem("theme") === "dark"
      );
    } catch {
      /* storage can throw in privacy modes — default to light */
    }
  }, [error]);

  return (
    <html lang="en" className={dark ? "dark" : undefined} suppressHydrationWarning>
      <body
        style={{
          fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
          background: dark ? "oklch(0.145 0 0)" : "oklch(1 0 0)",
          color: dark ? "oklch(0.985 0 0)" : "oklch(0.145 0 0)",
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          boxSizing: "border-box",
        }}
      >
        <main style={{ maxWidth: "26rem", textAlign: "center" }}>
          <div
            style={{
              width: "3.5rem",
              height: "3.5rem",
              margin: "0 auto 1rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "9999px",
              border: "1px solid rgba(239,68,68,0.3)",
              background: "rgba(239,68,68,0.12)",
              fontSize: "1.5rem",
            }}
            role="img"
            aria-label="Error"
          >
            !
          </div>
          <h1 style={{ fontSize: "1.15rem", fontWeight: 600, margin: "0 0 0.5rem" }}>
            ERP Sync can&apos;t start
          </h1>
          <p style={{ fontSize: "0.875rem", lineHeight: 1.6, opacity: 0.75, margin: "0 0 1.25rem" }}>
            A fatal error prevented the app shell from loading. Your attendance
            data is untouched — reloading usually fixes this.
          </p>
          {error.digest ? (
            <p
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: "0.7rem",
                opacity: 0.6,
                margin: "0 0 1.25rem",
              }}
            >
              ref: {error.digest}
            </p>
          ) : null}
          <button
            onClick={reset}
            style={{
              display: "inline-block",
              padding: "0.55rem 1.25rem",
              borderRadius: "0.75rem",
              border: "1px solid " + (dark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)"),
              background: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)",
              color: "inherit",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Reload app
          </button>
        </main>
      </body>
    </html>
  );
}
