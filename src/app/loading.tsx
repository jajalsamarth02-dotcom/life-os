/* Route-level loading skeleton (App Router convention: src/app/loading.tsx).
   Mirrors the real dashboard geometry — header bar, tab strip, attendance ring
   card and stat tiles — so the first paint doesn't jolt. Uses the app's
   erp-shimmer utility with a prefers-reduced-motion fallback already defined
   in globals.css. */

import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="relative mx-auto w-full max-w-6xl px-4 py-4 sm:py-6" aria-busy="true" aria-label="Loading the app">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-3 pb-5">
        <div className="flex items-center gap-2.5">
          <Skeleton className="size-9 rounded-xl" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-20 rounded-lg" />
          <Skeleton className="size-8 rounded-lg" />
        </div>
      </div>

      {/* Tab strip */}
      <Skeleton className="mb-4 h-12 w-full rounded-xl" />

      {/* Main card: ring + summary tiles */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Skeleton className="relative col-span-full h-64 overflow-hidden rounded-2xl lg:col-span-3 erp-shimmer" />
        <div className="col-span-full grid grid-cols-2 gap-4 lg:col-span-2">
          <Skeleton className="h-[7.5rem] rounded-2xl" />
          <Skeleton className="h-[7.5rem] rounded-2xl" />
          <Skeleton className="h-[7.5rem] rounded-2xl" />
          <Skeleton className="h-[7.5rem] rounded-2xl" />
        </div>
      </div>

      {/* Secondary strip */}
      <Skeleton className="mt-4 h-20 w-full rounded-2xl" />
    </div>
  );
}
