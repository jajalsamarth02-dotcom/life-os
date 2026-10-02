/* 404 surface (App Router convention: src/app/not-found.tsx). Rendered inside
   the root layout, so the normal theme and fonts apply. Deep links into the
   single-route app always resolve to "/", so this only appears for genuinely
   mistyped paths — keep it friendly and pointed back home. */

import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="relative flex min-h-[60vh] flex-1 items-center justify-center overflow-hidden px-4">
      {/* Ambient gradient matching the app shell */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/3 h-64 w-[36rem] -translate-x-1/2 rounded-full bg-emerald-500/[0.06] blur-3xl" />
        <div className="absolute -left-16 bottom-10 h-40 w-40 rounded-full bg-amber-500/[0.05] blur-3xl" />
      </div>

      <div className="relative w-full max-w-md rounded-2xl border border-border/60 bg-card/80 p-6 text-center shadow-sm backdrop-blur sm:p-8">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10">
          <Compass className="size-7 text-emerald-500" aria-hidden="true" />
        </div>

        <p
          className="font-mono text-5xl font-bold tracking-tighter text-foreground/90 tabular-nums"
          aria-hidden="true"
        >
          404
        </p>
        <h1 className="mt-2 text-lg font-semibold tracking-tight text-foreground">
          Page not found
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          This app lives on a single page. The dashboard — with your attendance,
          recovery plan and reminders — is right where you left it.
        </p>

        <Button asChild className="mt-5 gap-1.5" aria-label="Return to the dashboard">
          <Link href="/">Back to Dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
