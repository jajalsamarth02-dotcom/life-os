"use client";

/**
 * Skip budget — one card answering the student's most practical question:
 * "how many classes can I afford to miss right now?"
 *
 * Per-subject skip budget (classesToTarget math already computed by the
 * sync engine from LIVE ERP numbers) consolidated into a single total,
 * with the scarcest subjects first. Zero-buffer subjects surface at the
 * top with an "attend" hint instead of hiding inside an average.
 *
 * Rows deep-link into the subject drawer (same drawer as the subject
 * list) so the budget number is always one click away from its math.
 */

import { Footprints, MousePointerClick } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { MiniBar, SkipPips } from "./shared";
import { AnimatedNumber } from "./trend-chart";
import type { SubjectView } from "./types";

export function SkipBudgetCard({
  subjects,
  onOpenSubject,
  className,
}: {
  subjects: SubjectView[];
  /** Opens the subject drawer (dashboard's selectedCode state). */
  onOpenSubject?: (code: string) => void;
  className?: string;
}) {
  const withClasses = subjects.filter((s) => s.total > 0);
  const totalBudget = withClasses.reduce((n, s) => n + s.canSkip, 0);
  const withBuffer = withClasses.filter((s) => s.canSkip > 0).length;
  const tight = withClasses.length - withBuffer;

  /* Scarcest first — the subject closest to losing its buffer leads the list. */
  const rows = [...withClasses].sort(
    (a, b) => a.canSkip - b.canSkip || a.percentage - b.percentage || a.code.localeCompare(b.code)
  );

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
            aria-hidden="true"
          >
            <Footprints className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base tracking-tight">Skip budget</CardTitle>
            <CardDescription className="text-xs">
              Classes you can miss and still stay at or above each subject&apos;s target.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* hero total */}
        <div className="flex items-end justify-between gap-3 rounded-lg border border-indigo-500/20 bg-gradient-to-br from-indigo-500/10 via-violet-500/5 to-transparent px-4 py-3">
          <div className="flex items-baseline gap-2">
            <AnimatedNumber
              value={totalBudget}
              decimals={0}
              className="text-3xl font-bold tabular-nums tracking-tight text-indigo-600 dark:text-indigo-400"
            />
            <span className="text-sm font-medium text-muted-foreground">
              safe {totalBudget === 1 ? "skip" : "skips"} left
            </span>
          </div>
          <p className="text-right text-[11px] leading-tight text-muted-foreground">
            {withClasses.length > 0 ? (
              <>
                <span className="font-semibold text-foreground/80">{withBuffer}</span> of{" "}
                {withClasses.length} subjects have buffer
                {tight > 0 && (
                  <>
                    {" · "}
                    <span className="font-semibold text-amber-600 dark:text-amber-400">{tight}</span>{" "}
                    need attendance
                  </>
                )}
              </>
            ) : (
              "no classes recorded yet"
            )}
          </p>
        </div>

        {/* per-subject rows — scarcest first, click opens the drawer */}
        {rows.length > 0 && (
          <ul className="space-y-1" aria-label="Per-subject skip budget, scarcest first">
            {rows.map((s) => (
              <li key={s.code}>
                <button
                  type="button"
                  onClick={() => onOpenSubject?.(s.code)}
                  className={cn(
                    "group flex w-full items-center gap-3 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors",
                    "hover:border-border/60 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  )}
                  aria-label={`${s.name}: skip budget ${s.canSkip}. ${s.canSkip > 0 ? `You could miss ${s.canSkip} more ${s.canSkip === 1 ? "class" : "classes"} and stay at or above ${s.targetPct} percent.` : `No buffer — missing even 1 class would drop you below ${s.targetPct} percent.`} Open details`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">{s.code}</span>
                    <span className="block truncate text-xs font-medium">{s.name}</span>
                  </span>
                  <MiniBar percentage={s.percentage} status={s.status} target={s.targetPct} className="hidden w-24 shrink-0 sm:block" />
                  <SkipPips
                    count={s.canSkip}
                    title={
                      s.canSkip > 0
                        ? `Skip budget: you could miss ${s.canSkip} more ${s.canSkip === 1 ? "class" : "classes"} and stay at/above ${s.targetPct}% (${s.present}/${s.total} now)`
                        : `No skip buffer — missing even 1 class would drop you below ${s.targetPct}%`
                    }
                    className="hidden sm:inline-flex"
                  />
                  <span className="flex w-14 shrink-0 items-center justify-end gap-1 text-right">
                    <span
                      className={cn(
                        "text-sm font-bold tabular-nums",
                        s.canSkip === 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground"
                      )}
                    >
                      {s.canSkip}
                    </span>
                    {s.canSkip === 0 && (
                      <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">attend</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {rows.length === 0 && (
          <p className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-xs text-muted-foreground">
            Once classes appear on the ERP attendance sheet, their skip budgets show up here.
          </p>
        )}

        <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
          <MousePointerClick className="size-3 shrink-0" aria-hidden="true" />
          <span>
            Budget = misses allowed before the subject falls below its target ({rows.some((s) => s.hasCustomTarget) ? "custom targets respected" : "global target applies"}). Tap a row for the exact math.
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
