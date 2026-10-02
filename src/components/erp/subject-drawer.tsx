"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Activity,
  CalendarDays,
  CheckCircle2,
  Footprints,
  History,
  RotateCcw,
  Target,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { classesCanSkip, classesToReachTarget } from "@/lib/attendance";
import { fetchHistory, fetchTimetable, qk } from "./api";
import { AnimatedNumber } from "./trend-chart";
import { fmtDT, MiniBar, statusColors, StatusChip, useNow } from "./shared";
import type { AttendanceStatus, HistoryResponse, SubjectView, TimetableSlotRow } from "./types";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function hhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* What-if planner                                                     */
/* ------------------------------------------------------------------ */

type PlanMode = "attend" | "skip";

function WhatIfPlanner({ s, target }: { s: SubjectView; target: number }) {
  const [mode, setMode] = useState<PlanMode>("attend");
  const [n, setN] = useState(0);

  const toTarget = classesToReachTarget(s.present, s.total, target);
  const maxSkip = classesCanSkip(s.present, s.total, target);
  // NOTE: this component is remounted with key={s.id} when the subject changes,
  // so planner state resets naturally without effects.

  const projected = useMemo(() => {
    if (n === 0) return s.percentage;
    if (mode === "attend") return ((s.present + n) / (s.total + n)) * 100;
    return (s.present / (s.total + n)) * 100;
  }, [mode, n, s.present, s.total, s.percentage]);

  const delta = projected - s.percentage;
  const projectedStatus: AttendanceStatus =
    projected >= target ? "safe" : projected >= target - 5 ? "warning" : "danger";
  const pc = statusColors(projectedStatus);
  const c = statusColors(s.status);

  const setToTarget = () => {
    setMode("attend");
    setN(Math.max(1, toTarget));
  };
  const setToMaxSkip = () => {
    setMode("skip");
    setN(Math.max(1, maxSkip));
  };

  return (
    <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
          <Zap className="size-4 text-amber-500" aria-hidden="true" />
          What-if planner
        </p>
        {/* mode switch */}
        <div
          role="tablist"
          aria-label="Planning mode"
          className="flex rounded-lg border border-border/70 bg-background p-0.5"
        >
          {(
            [
              { key: "attend", label: "Attend", icon: Footprints },
              { key: "skip", label: "Skip", icon: TrendingDown },
            ] as const
          ).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={mode === key}
              onClick={() => {
                setMode(key);
                setN(0);
              }}
              className={cn(
                "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                mode === key
                  ? key === "attend"
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                    : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                  : "text-muted-foreground hover:bg-muted/60"
              )}
            >
              <Icon className="size-3.5" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-2.5 text-xs text-muted-foreground">
        {mode === "attend" ? (
          <>
            Simulate <b className="tabular-nums text-foreground">attending</b> the next classes of {s.code}. Each
            attended class adds to both present and total.
          </>
        ) : (
          <>
            Simulate <b className="tabular-nums text-foreground">skipping</b> the next classes of {s.code}. Skipped
            classes only increase the total — a fast way to see how fast attendance falls.
          </>
        )}
      </p>

      <div className="mt-3 flex items-center gap-3">
        <Slider
          value={[n]}
          min={0}
          max={40}
          step={1}
          aria-label={`Number of classes to ${mode} in the simulation`}
          onValueChange={(v) => setN(v[0] ?? 0)}
          className="flex-1"
        />
        <span className="w-14 shrink-0 rounded-lg border border-border/70 bg-background px-2 py-1 text-center text-sm font-bold tabular-nums">
          {n}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground"
          aria-label="Reset simulation"
          onClick={() => setN(0)}
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground/70 tabular-nums">
        <span>0</span>
        <span>10</span>
        <span>20</span>
        <span>30</span>
        <span>40</span>
      </div>

      {/* Projection result */}
      <div className={cn("mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3.5 py-3", pc.border, pc.bg)}>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Projected attendance
          </p>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className={cn("text-2xl font-bold tabular-nums", pc.text)}>
              {n === 0 ? s.percentage.toFixed(2) : projected.toFixed(2)}
              <span className="text-sm font-semibold">%</span>
            </span>
            {n > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                  delta >= 0 ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-red-500/15 text-red-700 dark:text-red-400"
                )}
              >
                {delta >= 0 ? "+" : ""}
                {delta.toFixed(2)} pts
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          {projectedStatus === "safe" ? (
            <p className="flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="size-3.5" aria-hidden="true" /> Above {target}% target
            </p>
          ) : (
            <p className="flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
              <Target className="size-3.5" aria-hidden="true" /> Below {target}% target
            </p>
          )}
          <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
            {mode === "attend"
              ? `${s.present + n} present of ${s.total + n}`
              : `${s.present} present of ${s.total + n}`}
          </p>
        </div>
      </div>

      {/* Shortcuts */}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {s.status !== "safe" && toTarget > 0 && (
          <Button variant="outline" size="sm" className="h-7 gap-1 border-emerald-500/40 px-2.5 text-[11px] text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-800 dark:text-emerald-400" onClick={setToTarget}>
            <TrendingUp className="size-3" aria-hidden="true" />
            Reach {target}% → attend {toTarget}
          </Button>
        )}
        {maxSkip > 0 && (
          <Button variant="outline" size="sm" className="h-7 gap-1 px-2.5 text-[11px]" onClick={setToMaxSkip}>
            <TrendingDown className="size-3" aria-hidden="true" />
            Max skips ({maxSkip}) — still {target}%
          </Button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Subject trend mini chart (pure SVG, no deps)                        */
/* ------------------------------------------------------------------ */

function SubjectTrend({ history, code }: { history: HistoryResponse | undefined; code: string }) {
  const points = history?.subjects[code] ?? [];
  const recent = points.slice(-30);

  return (
    <div className="rounded-xl border border-border/70 p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
        <Activity className="size-4 text-emerald-500" aria-hidden="true" />
        Attendance trend
      </p>
      {recent.length < 2 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          The trend line appears once the sync engine has recorded at least two snapshots for this subject.
        </p>
      ) : (
        <div className="mt-3">
          <MiniAreaChart points={recent.map((p) => p.percentage)} />
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{format(new Date(recent[0].t), "d MMM")}</span>
            <span className="font-medium text-foreground tabular-nums">
              {recent[0].percentage.toFixed(2)}% → {recent[recent.length - 1].percentage.toFixed(2)}%
            </span>
            <span>{format(new Date(recent[recent.length - 1].t), "d MMM")}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function MiniAreaChart({ points }: { points: number[] }) {
  const w = 320;
  const h = 64;
  const path = useMemo(() => {
    const min = Math.min(...points);
    const max = Math.max(...points);
    const span = max - min || 1;
    const stepX = w / (points.length - 1);
    const coords = points.map((p, i) => {
      const x = i * stepX;
      const y = h - 6 - ((p - min) / span) * (h - 12);
      return [x, y] as const;
    });
    const line = coords.reduce((acc, [x, y], i) => (i === 0 ? `M ${x},${y}` : `${acc} L ${x},${y}`), "");
    const area = `${line} L ${w},${h} L 0,${h} Z`;
    return { line, area };
  }, [points]);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full" role="img" aria-label="Subject attendance trend">
      <defs>
        <linearGradient id="drawerTrendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
          <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <path d={path.area} fill="url(#drawerTrendFill)" />
      <path d={path.line} fill="none" stroke="#10b981" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Weekly classes for this subject                                     */
/* ------------------------------------------------------------------ */

function SubjectTimetable({ slots }: { slots: TimetableSlotRow[] }) {
  const now = useNow();
  const today = new Date(now).getDay();
  const byDay = useMemo(() => {
    const m = new Map<number, TimetableSlotRow[]>();
    for (const s of slots) {
      const arr = m.get(s.dayOfWeek) ?? [];
      arr.push(s);
      m.set(s.dayOfWeek, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.startMin - b.startMin);
    return m;
  }, [slots]);

  const orderedDays = useMemo(() => {
    // Today first, then the rest of the week in order
    const days = [1, 2, 3, 4, 5, 6, 0].filter((d) => byDay.has(d));
    return days.sort((a, b) => ((a - today + 7) % 7) - ((b - today + 7) % 7));
  }, [byDay, today]);

  return (
    <div className="rounded-xl border border-border/70 p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
        <CalendarDays className="size-4 text-emerald-500" aria-hidden="true" />
        Weekly classes
        <Badge variant="secondary" className="ml-auto tabular-nums">{slots.length}/week</Badge>
      </p>
      {slots.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          No timetable slots recorded for this subject. You can add them from the schedule manager on the dashboard.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {orderedDays.map((day) => (
            <li key={day} className="flex items-center gap-2.5">
              <span
                className={cn(
                  "w-10 shrink-0 rounded-md px-1.5 py-0.5 text-center text-[11px] font-semibold",
                  day === today ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"
                )}
              >
                {DAY_SHORT[day]}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {byDay.get(day)!.map((slot) => (
                  <span
                    key={slot.id}
                    className="rounded-md border border-border/60 bg-background px-2 py-0.5 text-[11px] tabular-nums text-foreground/80"
                  >
                    {hhmm(slot.startMin)}–{hhmm(slot.endMin)}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Drawer                                                              */
/* ------------------------------------------------------------------ */

export function SubjectDrawer({
  subject,
  target,
  open,
  onOpenChange,
}: {
  subject: SubjectView | null;
  target: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const history = useQuery({
    queryKey: qk.history,
    queryFn: fetchHistory,
    enabled: open,
    refetchInterval: 60_000,
  });
  const timetable = useQuery({
    queryKey: qk.timetable,
    queryFn: fetchTimetable,
    enabled: open,
    refetchInterval: 120_000,
  });

  if (!subject) return null;
  const c = statusColors(subject.status);
  const mySlots = (timetable.data ?? []).filter((s) => s.subjectCode === subject.code);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-md md:max-w-lg">
        <div className="sr-only">
          <SheetHeader>
            <SheetTitle>{subject.name} attendance details</SheetTitle>
            <SheetDescription>
              Detailed statistics, what-if planning, trend and weekly schedule for {subject.code}.
            </SheetDescription>
          </SheetHeader>
        </div>

        {/* Status gradient header */}
        <div className={cn("relative overflow-hidden border-b p-5", c.bg, c.border)}>
          <div
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute -right-10 -top-14 size-40 rounded-full blur-2xl opacity-30",
              subject.status === "safe" ? "bg-emerald-500" : subject.status === "warning" ? "bg-amber-500" : "bg-red-500"
            )}
          />
          <div className="relative flex items-start justify-between gap-3 pr-10 sm:pr-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("rounded-md bg-background/70 px-2 py-0.5 font-mono text-[11px] font-bold backdrop-blur", c.text)}>
                  {subject.code}
                </span>
                <StatusChip status={subject.status} target={target} />
              </div>
              <h2 className="mt-1.5 truncate text-lg font-semibold tracking-tight">{subject.name}</h2>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <History className="size-3" aria-hidden="true" />
                Updated {fmtDT(subject.updatedAt)}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className={cn("text-3xl font-bold tracking-tight tabular-nums", c.text)}>
                <AnimatedNumber value={subject.percentage} suffix="%" />
              </p>
              <p className="text-[11px] text-muted-foreground">target {target}%</p>
            </div>
          </div>
          <MiniBar percentage={subject.percentage} status={subject.status} className="relative mt-3.5 h-2.5" />
        </div>

        <div className="space-y-4 p-5">
          {/* Stats */}
          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="rounded-lg border border-border/60 bg-card px-2 py-2.5">
              <p className="text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{subject.present}</p>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Present</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-card px-2 py-2.5">
              <p className="text-lg font-semibold tabular-nums text-red-700 dark:text-red-400">{subject.absent}</p>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Missed</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-card px-2 py-2.5">
              <p className="text-lg font-semibold tabular-nums">{subject.total}</p>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Total</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-card px-2 py-2.5">
              <p
                className={cn(
                  "text-lg font-semibold tabular-nums",
                  subject.classesToTarget > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"
                )}
              >
                {subject.classesToTarget > 0 ? subject.classesToTarget : "✓"}
              </p>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {subject.classesToTarget > 0 ? "To reach" : "On target"}
              </p>
            </div>
          </div>

          <WhatIfPlanner key={subject.id} s={subject} target={target} />

          <SubjectTrend history={history.data} code={subject.code} />
          <SubjectTimetable slots={mySlots} />

          <Separator />
          <p className="pb-2 text-center text-[11px] leading-relaxed text-muted-foreground">
            Numbers are recalculated from the ERP mirror on every sync — present ÷ total × 100. This panel never
            writes to the ERP.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
