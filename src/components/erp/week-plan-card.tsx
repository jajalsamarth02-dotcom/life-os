"use client";

/**
 * This week's plan — the FORWARD-LOOKING twin of the Skip budget card.
 *
 * Skip budget answers "how many misses can I absorb standing still";
 * THIS card answers "what's actually left of the real week, and what
 * should I do with it". It joins the ERP Class Routine slots (synced
 * since Round 51) with the live per-subject attendance numbers:
 *
 *   left          — remaining classes this week per subject (today's
 *                   classes count only until their endMin passes)
 *   attendAllPct  — where the percentage lands if every remaining
 *                   class this week is attended
 *   canSkip       — how many of THOSE can be missed while still
 *                   ending the week at/above the subject's target:
 *                   (present + left − k) / (total + left) ≥ target
 *                   → k ≤ present + left − target·(total + left)
 *
 * The standing budget (skip-budget-card) stays the conservative
 * ceiling; this card is the weekly decision surface. Slots whose
 * subject is not on the attendance sheet yet (held back by the sync
 * engine) are counted in the day strip but disclosed — never silently
 * budgeted as if their attendance were free. Parallel-batch windows
 * (lab groups sharing one wall time) collapse to the student's pick
 * via lib/batch-picks — unresolved windows count every option and say
 * so, never silently.
 *
 * Weeks run Monday → Sunday (same WEEK_ORDER as the timetable card);
 * "remaining" is computed in device-local time to match every other
 * clock in the app.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { motion } from "framer-motion";
import { CalendarRange, CheckCircle2, GitMerge, Info, MousePointerClick, PartyPopper } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { classesToReachTarget } from "@/lib/attendance";
import { applyBatchPicks } from "@/lib/batch-picks";
import { fetchTimetable, qk } from "./api";
import { AnimatedNumber } from "./trend-chart";
import { DAY_NAMES_SHORT, hueColors, istNow, SkipPips } from "./shared";
import type { SubjectView, TimetableSlotRow } from "./types";

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"] as const;
/** Monday-first traversal of dayOfWeek values (0 = Sunday … 6 = Saturday). */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
/* r94: the local DAY_NAMES_SHORT copy retired — shared.tsx is the one names
   source for every surface. */

/** Monday=0 … Sunday=6 — makes "later this week" a plain comparison. */
function weekOffset(day: number): number {
  return (day + 6) % 7;
}

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

interface WeekRow {
  subject: SubjectView;
  /** Classes remaining this week for this subject. */
  left: number;
  /** Percentage if every remaining class this week is attended. */
  attendAllPct: number;
  /** How many of `left` can be missed while still ending ≥ target. */
  canSkip: number;
  /** Classes still needed AFTER this week if all are attended (below-target subjects). */
  stillShort: number;
  /** Earliest remaining slot — powers the "next: Fri 10:00" hint. */
  nextSlot: TimetableSlotRow;
  /** True when the next remaining slot is today. */
  nextIsToday: boolean;
}

export function WeekPlanCard({
  subjects,
  onOpenSubject,
  onResolvePicks,
  className,
}: {
  subjects: SubjectView[];
  /** Opens the subject drawer (same drawer the skip budget uses). */
  onOpenSubject?: (code: string) => void;
  /** Deep-link: opens the timetable's Manage dialog on the Parallel classes
   *  picker so the amber disclosure below is resolvable in one click. */
  onResolvePicks?: () => void;
  className?: string;
}) {
  const slotsQuery = useQuery({ queryKey: qk.timetable, queryFn: fetchTimetable });
  const tt = slotsQuery.data;
  const slots = tt?.slots;
  const picks = tt?.picks ?? {};
  const now = Date.now();
  /* IST, not the device clock — same shared helper as the timetable card,
     so every schedule surface agrees on "today" on ANY device timezone. */
  const { day: nowDay, min: nowMin } = istNow(now);
  const nowOff = weekOffset(nowDay);

  const plan = useMemo(() => {
    if (!slots) return null;
    if (slots.length === 0) return { kind: "empty" as const };

    // The student's real week: same-batch duplicates collapsed, picked
    // windows trimmed to the chosen class. Unpicked windows keep every
    // option (counted + disclosed below — never silent).
    const batch = applyBatchPicks(slots, picks);
    const attending = batch.attending;

    const isRemaining = (s: TimetableSlotRow) =>
      s.dayOfWeek === nowDay ? s.endMin > nowMin : weekOffset(s.dayOfWeek) > nowOff;

    const remaining = attending.filter(isRemaining);
    // Full-week shape for the day strip (past days show what the week held).
    const dayCounts: number[] = [];
    for (const d of WEEK_ORDER) {
      dayCounts.push(attending.filter((s) => s.dayOfWeek === d).length);
    }

    const byCode = new Map<string, TimetableSlotRow[]>();
    for (const s of remaining) {
      const list = byCode.get(s.subjectCode);
      if (list) list.push(s);
      else byCode.set(s.subjectCode, [s]);
    }

    const rows: WeekRow[] = [];
    let unmapped = 0;
    for (const subject of subjects) {
      const list = byCode.get(subject.code);
      if (!list) continue;
      byCode.delete(subject.code);
      const left = list.length;
      const t = subject.targetPct / 100;
      const futureTotal = subject.total + left;
      const attendAllPct = futureTotal > 0 ? ((subject.present + left) / futureTotal) * 100 : 0;
      // k ≤ present + left − target·(total + left), clamped into [0, left].
      const rawK = subject.present + left - t * futureTotal;
      const canSkip = Math.max(0, Math.min(left, Math.floor(rawK)));
      const stillShort =
        attendAllPct < subject.targetPct ? classesToReachTarget(subject.present + left, futureTotal, subject.targetPct) : 0;
      const nextSlot = [...list].sort((a, b) =>
        a.dayOfWeek === b.dayOfWeek ? a.startMin - b.startMin : weekOffset(a.dayOfWeek) - weekOffset(b.dayOfWeek)
      )[0];
      if (!nextSlot) continue; // unreachable (left ≥ 1), guards noUncheckedIndexedAccess
      rows.push({
        subject,
        left,
        attendAllPct,
        canSkip,
        stillShort,
        nextSlot,
        nextIsToday: nextSlot.dayOfWeek === nowDay,
      });
    }
    // Slots whose subject is not an active attendance subject (held back by sync).
    for (const list of byCode.values()) unmapped += list.length;

    rows.sort(
      (a, b) =>
        a.canSkip - b.canSkip ||
        a.attendAllPct - b.attendAllPct ||
        a.subject.name.localeCompare(b.subject.name)
    );

    return {
      kind: "plan" as const,
      remaining,
      dayCounts,
      rows,
      unmapped,
      unresolvedCount: batch.unresolvedCells.length,
      resolvedCount: batch.resolvedCells.length,
      excludedCount: batch.excluded.length,
    };
  }, [slots, picks, subjects, nowDay, nowMin, nowOff]);

  if (slotsQuery.isPending || slotsQuery.isError || !plan) return null;
  if (plan.kind === "empty") return null;

  const totalLeft = plan.remaining.length;
  const todayLeft = plan.remaining.filter((s) => s.dayOfWeek === nowDay).length;

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-400"
            aria-hidden="true"
          >
            <CalendarRange className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base tracking-tight">This week&apos;s plan</CardTitle>
            <CardDescription className="text-xs">
              What&apos;s left of the real class routine — and what you can safely miss.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {totalLeft === 0 ? (
          /* week done — everything the routine held has already ended */
          <div className="flex items-center gap-3 rounded-lg border border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-transparent px-4 py-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" aria-hidden="true">
              <PartyPopper className="size-4" />
            </span>
            <p className="text-xs leading-snug text-muted-foreground">
              <span className="font-semibold text-foreground">That&apos;s the week — no classes left on the routine.</span>{" "}
              {tt && tt.slots.length > 0 ? "The plan resets when the next one starts." : null}
            </p>
          </div>
        ) : (
          <>
            {/* hero — total left + the week's shape */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-sky-500/20 bg-gradient-to-br from-sky-500/10 via-indigo-500/5 to-transparent px-4 py-3">
              <div className="flex items-baseline gap-2">
                <AnimatedNumber
                  value={totalLeft}
                  decimals={0}
                  className="text-3xl font-bold tabular-nums tracking-tight text-sky-600 dark:text-sky-400"
                />
                <span className="text-sm font-medium text-muted-foreground">
                  {totalLeft === 1 ? "class" : "classes"} left this week
                </span>
              </div>
              <div className="flex items-end gap-3">
                {todayLeft > 0 && (
                  <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold text-sky-600 dark:text-sky-400">
                    {todayLeft} still {todayLeft === 1 ? "is" : "are"} today
                  </span>
                )}
                {/* week shape — Monday-first, past dimmed, today ringed */}
                <div
                  className="flex items-end gap-1"
                  role="img"
                  aria-label={`Classes per day, Monday through Sunday: ${plan.dayCounts.join(", ")}.`}
                >
                  {WEEK_ORDER.map((d, i) => {
                    const count = plan.dayCounts[i] ?? 0;
                    const isToday = d === nowDay;
                    const past = weekOffset(d) < nowOff && !isToday;
                    return (
                      <span
                        key={d}
                        className={cn(
                          "flex w-6 flex-col items-center gap-0.5 rounded-md py-1 transition-colors",
                          isToday && "bg-sky-500/15 ring-1 ring-sky-500/40",
                          past && "opacity-40"
                        )}
                      >
                        <span
                          className={cn(
                            "text-[9px] font-semibold uppercase leading-none",
                            isToday ? "text-sky-600 dark:text-sky-400" : "text-muted-foreground/70"
                          )}
                        >
                          {DAY_LETTERS[i]}
                        </span>
                        <span
                          className={cn(
                            "text-[11px] font-bold leading-none tabular-nums",
                            count === 0 ? "text-muted-foreground/40" : "text-foreground"
                          )}
                        >
                          {count > 0 ? count : "·"}
                        </span>
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* per-subject rows — scarcest allowance first, click opens the drawer */}
            {plan.rows.length > 0 && (
              <ul className="space-y-1" aria-label="Per-subject plan for the rest of this week, scarcest allowance first">
                {plan.rows.map((r, i) => {
                  const hue = hueColors(r.subject.code);
                  const safe = r.attendAllPct >= r.subject.targetPct;
                  const projTitle = [
                    `${r.left} ${r.left === 1 ? "class" : "classes"} left this week${
                      r.nextIsToday
                        ? ` — next today ${hhmm(r.nextSlot.startMin)}`
                        : ` — next ${DAY_NAMES_SHORT[r.nextSlot.dayOfWeek]} ${hhmm(r.nextSlot.startMin)}`
                    }.`,
                    `Attend all → ${r.attendAllPct.toFixed(2)}%`,
                    safe
                      ? `you could miss ${r.canSkip} and stay at or above ${r.subject.targetPct}%.`
                      : r.stillShort > 0
                        ? `still ${r.stillShort} ${r.stillShort === 1 ? "class" : "classes"} short after this week.`
                        : "attending everything closes the gap by week's end.",
                  ].join(" ");
                  return (
                    <motion.li
                      key={r.subject.code}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.04 * i, duration: 0.25, ease: "easeOut" }}
                    >
                      <button
                        type="button"
                        onClick={() => onOpenSubject?.(r.subject.code)}
                        className={cn(
                          "group flex w-full items-center gap-3 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors",
                          "hover:border-border/60 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        )}
                        aria-label={`${r.subject.name}: ${r.left} classes left this week. ${projTitle} Open details`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span
                              className="size-2 shrink-0 rounded-full"
                              style={{ backgroundColor: hue.bg, boxShadow: `0 0 0 1px ${hue.fg}` }}
                              aria-hidden="true"
                            />
                            <span className="truncate font-mono text-[11px] text-muted-foreground">{r.subject.code}</span>
                            <span className="shrink-0 text-[10px] text-muted-foreground/70">
                              {r.left} left · next {r.nextIsToday ? "today" : DAY_NAMES_SHORT[r.nextSlot.dayOfWeek]}{" "}
                              {hhmm(r.nextSlot.startMin)}
                            </span>
                          </span>
                          <span className="mt-0.5 flex items-center justify-between gap-2">
                            <span className="block truncate text-xs font-medium">{r.subject.name}</span>
                            <span
                              className={cn(
                                "shrink-0 text-[10px] tabular-nums",
                                safe ? "text-emerald-600/90 dark:text-emerald-400/90" : "text-amber-600/90 dark:text-amber-400/90"
                              )}
                            >
                              attend all → {r.attendAllPct.toFixed(r.attendAllPct >= 100 ? 0 : 1)}%
                            </span>
                          </span>
                        </span>
                        <SkipPips count={r.canSkip} title={projTitle} className="hidden sm:inline-flex" />
                        <span className="flex w-[86px] shrink-0 items-center justify-end">
                          {r.canSkip > 0 ? (
                            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                              miss {r.canSkip}
                            </span>
                          ) : (
                            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                              attend all
                            </span>
                          )}
                        </span>
                      </button>
                    </motion.li>
                  );
                })}
              </ul>
            )}

            {plan.rows.length === 0 && plan.unmapped > 0 && (
              <p className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-xs text-muted-foreground">
                {plan.unmapped} remaining {plan.unmapped === 1 ? "class belongs" : "classes belong"} to subjects the
                attendance sheet doesn&apos;t list yet — they join the plan automatically once they appear.
              </p>
            )}

            {plan.unresolvedCount > 0 && (
              <div className="flex items-start gap-2.5 rounded-lg border border-dashed border-amber-500/40 bg-amber-500/[0.05] px-3 py-2.5">
                <GitMerge className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <p className="text-[11px] leading-snug text-amber-800/90 dark:text-amber-300/80">
                  <span className="font-semibold">
                    {plan.unresolvedCount} parallel time {plan.unresolvedCount === 1 ? "window" : "windows"}
                  </span>{" "}
                  {plan.unresolvedCount === 1 ? "lists" : "list"} multiple classes (lab groups / batches) — the plan
                  counts every option until you pick yours{" "}
                  {onResolvePicks ? (
                    <button
                      type="button"
                      onClick={onResolvePicks}
                      className="inline-flex items-center gap-0.5 rounded-md px-1 font-semibold text-emerald-700 underline decoration-emerald-500/50 underline-offset-2 transition-colors hover:bg-emerald-500/10 hover:decoration-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-emerald-400"
                    >
                      Resolve now
                      <span aria-hidden="true">→</span>
                    </button>
                  ) : (
                    <span className="font-semibold">in Manage → Parallel classes</span>
                  )}
                  .
                </p>
              </div>
            )}

            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] leading-tight text-muted-foreground/70">
              <Info className="size-3 shrink-0" aria-hidden="true" />
              <span>
                From the synced ERP class routine × live attendance. Skipping assumes every other class this week is
                attended; the standing{" "}
                <span className="font-semibold text-foreground/70">skip budget</span> above stays the conservative
                ceiling.
              </span>
              {plan.unmapped > 0 && plan.rows.length > 0 && (
                <span className="text-muted-foreground/60">
                  · {plan.unmapped} unmapped {plan.unmapped === 1 ? "slot" : "slots"} not budgeted yet.
                </span>
              )}
              {plan.resolvedCount > 0 && (
                <span className="inline-flex items-center gap-1 text-emerald-700/80 dark:text-emerald-400/70">
                  <CheckCircle2 className="size-3 shrink-0" aria-hidden="true" />
                  attending your pick in {plan.resolvedCount} parallel {plan.resolvedCount === 1 ? "window" : "windows"}
                  {plan.excludedCount > 0
                    ? ` · ${plan.excludedCount} alternative${plan.excludedCount === 1 ? "" : "s"} hidden.`
                    : ""}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <MousePointerClick className="size-3 shrink-0" aria-hidden="true" />
                Tap a row for the exact math.
              </span>
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
