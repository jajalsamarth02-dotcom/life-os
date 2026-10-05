"use client";

/* Route-segment error boundary (App Router convention: src/app/error.tsx).
   Catches runtime errors inside the page subtree and offers in-place
   recovery instead of the raw framework crash screen. The last synced
   data lives in SQLite on the server, so a client crash never loses it. */

import { useEffect } from "react";
import { LifeBuoy, RefreshCw, RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    /* Surface the real stack in devtools for diagnosis; never swallow it. */
    console.error("ERP Sync render error:", error);
  }, [error]);

  return (
    <div className="relative flex min-h-[60vh] flex-1 items-center justify-center overflow-hidden px-4">
      {/* Ambient gradient matching the app shell */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/3 h-64 w-[36rem] -translate-x-1/2 rounded-full bg-red-500/[0.06] blur-3xl" />
        <div className="absolute -right-16 bottom-10 h-40 w-40 rounded-full bg-emerald-500/[0.05] blur-3xl" />
      </div>

      <div className="relative w-full max-w-md rounded-2xl border border-border/60 bg-card/80 p-6 text-center shadow-sm backdrop-blur sm:p-8">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10">
          <TriangleAlert className="size-7 text-red-500" aria-hidden="true" />
        </div>

        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          The interface hit an unexpected error while rendering. Your synced
          attendance data is safe on the server — nothing was lost.
        </p>

        {error.digest ? (
          <p className="mx-auto mt-3 inline-block max-w-full truncate rounded-md border border-border/50 bg-muted/50 px-2 py-1 font-mono text-[11px] text-muted-foreground">
            ref: {error.digest}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row">
          <Button onClick={reset} className="w-full gap-1.5 sm:w-auto" aria-label="Retry rendering the app">
            <RefreshCw className="size-4" aria-hidden="true" />
            Try again
          </Button>
          <Button
            variant="outline"
            onClick={() => window.location.reload()}
            className="w-full gap-1.5 sm:w-auto"
            aria-label="Reload the whole page"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            Reload page
          </Button>
        </div>

        <p className="mt-4 flex items-start gap-1.5 text-left text-xs leading-relaxed text-muted-foreground/80">
          <LifeBuoy className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            If this keeps happening, the sync server may be restarting — wait
            about 30&nbsp;seconds and reload. It comes back automatically.
          </span>
        </p>
      </div>
    </div>
  );
}
