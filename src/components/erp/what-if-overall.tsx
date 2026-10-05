"use client";

/**
 * Overall what-if simulator — the aggregate sibling of the per-subject
 * WhatIfPlanner that lives in each subject drawer.
 *
 *   Attend n → (present+n)/(total+n)   "what if I show up for everything?"
 *   Skip n   →  present/(total+n)      "what if I bunk the next few?"
 *
 * Pure client-side projection over the CURRENT synced aggregate — the same
 * math the server uses for status thresholds (safe ≥ target, warning ≥
 * target−5), so the simulated grade matches what the app will show after it
 * actually happens. Verdict lines (classes-to-recover / skip buffer) are
 * recomputed on the POST-simulation numbers, because the pre-simulation
 * classesToTarget/canSkip go stale the moment n extra classes are recorded.
 *
 * Deep link: the command palette dispatches `erp:goto-whatif` (after the
 * attendance tab mounts) — the tab scrolls here and flashes the card ring.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { CalendarClock, GraduationCap, RotateCcw, Zap } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { attendanceStatus, classesCanSkip, classesToReachTarget } from "@/lib/attendance";
import { statusColors, StatusChip } from "./shared";
import { AnimatedNumber } from "./trend-chart";
import type { AttendanceView } from "./types";

const clampPct = (v: number) => Math.max(0, Math.min(100, v));

export function WhatIfOverall({ overall, target }: { overall: AttendanceView; target: number }) {
  const [mode, setMode] = useState<"attend" | "skip">("attend");
  const [n, setN] = useState(0);

  const futureTotal = overall.total + n;
  const projectedPresent = mode === "attend" ? overall.present + n : overall.present;
  const projected =
    n === 0 || futureTotal === 0 ? overall.percentage : (projectedPresent / futureTotal) * 100;
  const projectedStatus = attendanceStatus(projected, target, futureTotal || 1);
  const c = statusColors(projectedStatus);
  const delta = projected - overall.percentage;
  const active = n > 0;

  /* Post-simulation verdicts — recomputed on the PROJECTED counts. */
  const recover = classesToReachTarget(projectedPresent, futureTotal, target);
  const spare = classesCanSkip(projectedPresent, futureTotal, target);
  const atTarget = projected >= target;

  const stageTone =
    active && mode === "attend"
      ? "border-emerald-500/30 bg-emerald-500/[0.06]"
      : active && mode === "skip"
        ? "border-red-500/30 bg-red-500/[0.06]"
        : "border-border/60 bg-muted/40";

  return (
    <Card
      id="what-if-simulator"
      data-noprint
      className={cn(
        "scroll-mt-24 rounded-xl border-border/60 transition-colors duration-300",
        active && c.border
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base tracking-tight">
              <Zap className="size-4 text-amber-500" aria-hidden="true" />
              What-if simulator
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                overall
              </span>
            </CardTitle>
            <CardDescription className="mt-0.5">
              Fast-forward the aggregate — drag to see where the next classes land you
            </CardDescription>
          </div>
          <div
            className="flex rounded-full border border-border/60 bg-background p-0.5"
            role="group"
            aria-label="Simulation mode"
          >
            {(["attend", "skip"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  if (mode === m) {
                    setN(0); // clicking the active mode again resets the slider
                    return;
                  }
                  setMode(m);
                  setN(0);
                }}
                aria-pressed={mode === m}
                className={cn(
                  "relative rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  mode === m
                    ? m === "attend"
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-red-700 dark:text-red-400"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {mode === m && (
                  <motion.span
                    layoutId="whatif-overall-thumb"
                    className={cn(
                      "absolute inset-0 rounded-full",
                      m === "attend" ? "bg-emerald-500/15" : "bg-red-500/15"
                    )}
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
                <span className="relative z-10">{m === "attend" ? "Attend" : "Skip"}</span>
              </button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Simulation stage — tints green/red while a scenario is active */}
        <div className={cn("rounded-lg border p-3 transition-colors duration-300", stageTone)}>
          <p className="text-sm text-muted-foreground">
            If I{" "}
            <b
              className={
                mode === "attend"
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-red-700 dark:text-red-400"
              }
            >
              {mode === "attend" ? "attend" : "miss"}
            </b>{" "}
            the next <b className="tabular-nums text-foreground">{n}</b>{" "}
            {n === 1 ? "class" : "classes"}, overall attendance lands at
          </p>

          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className={cn("text-3xl font-bold tracking-tight tabular-nums", c.text)}>
              <AnimatedNumber value={projected} suffix="%" />
            </span>
            {active && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                  delta >= 0
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "bg-red-500/10 text-red-700 dark:text-red-400"
                )}
              >
                {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(2)} pts
              </span>
            )}
            <StatusChip status={projectedStatus} target={target} className="ml-auto" />
          </div>

          {/* 0–100 projection track: ghost marker = now, solid = projected,
              dashed tick = target. Decorative — the numbers above carry the data. */}
          <div className="mt-4" aria-hidden="true">
            <div className="relative h-2 w-full rounded-full bg-muted">
              <motion.div
                className={cn("h-full rounded-full", c.bar)}
                initial={false}
                animate={{ width: `${clampPct(projected)}%` }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              />
              {target > 0 && target < 100 && (
                <span
                  className="absolute inset-y-[-3px] w-0 border-l-2 border-dashed border-foreground/50"
                  style={{ left: `${target}%` }}
                />
              )}
              {overall.total > 0 && (
                <span
                  className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-muted-foreground/60 bg-background"
                  style={{ left: `${clampPct(overall.percentage)}%` }}
                />
              )}
              <motion.span
                className={cn(
                  "absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-sm ring-2 ring-background",
                  c.bar
                )}
                initial={false}
                animate={{ left: `${clampPct(projected)}%` }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
            <div className="mt-1.5 flex items-center gap-3 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-full border-2 border-muted-foreground/60 bg-background" />
                now {overall.percentage.toFixed(2)}%
              </span>
              {active && (
                <span className="inline-flex items-center gap-1">
                  <span className={cn("size-2 rounded-full", c.bar)} />
                  projected {projected.toFixed(2)}%
                </span>
              )}
              <span className="ml-auto inline-flex items-center gap-1">
                <span className="h-2.5 border-l-2 border-dashed border-foreground/50" />
                target {target}%
              </span>
            </div>
          </div>

          <Slider
            className={cn(
              "mt-4 [&_[data-slot=slider-range]]:bg-primary",
              active &&
                (mode === "attend"
                  ? "[&_[data-slot=slider-range]]:bg-emerald-500"
                  : "[&_[data-slot=slider-range]]:bg-red-500")
            )}
            value={[n]}
            min={0}
            max={10}
            step={1}
            aria-label={`Simulate ${mode === "attend" ? "attending" : "missing"} the next classes for the overall attendance`}
            onValueChange={(v) => setN(v[0] ?? 0)}
          />
          <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground/70">
            <span>0</span>
            <span>5</span>
            <span>10</span>
          </div>
        </div>

        {/* Verdicts — recomputed on the projected numbers, never the stale ones */}
        {active && (
          <div className="space-y-1.5 text-sm">
            {atTarget ? (
              <p className="flex items-start gap-1.5 text-emerald-600 dark:text-emerald-400">
                <GraduationCap className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  At/above the {target}% target
                  {spare > 0 && (
                    <>
                      {" "}
                      — a buffer of <b className="tabular-nums">{spare}</b>{" "}
                      {spare === 1 ? "class" : "classes"} you could still miss
                    </>
                  )}
                  .
                </span>
              </p>
            ) : recover > 0 ? (
              <p className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
                <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  Then attend <b className="tabular-nums">{recover}</b>{" "}
                  {recover === 1 ? "class" : "classes"} in a row to get back to {target}%.
                </span>
              </p>
            ) : (
              <p className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
                <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>Below the {target}% target — no classes recorded to recover with yet.</span>
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground/80">
          <p>
            Aggregate projection only — per-subject planning lives in each subject&apos;s drawer.
          </p>
          {active && (
            <button
              type="button"
              onClick={() => setN(0)}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RotateCcw className="size-3" aria-hidden="true" />
              Reset
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
