"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  Activity,
  ArrowRight,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Footprints,
  History,
  Hourglass,
  Loader2,
  RotateCcw,
  Target,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
import { applyBatchPicks } from "@/lib/batch-picks";
import { matchStoryCode, subjectStories } from "@/lib/results-summary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { ApiError, createSlot, fetchAssignments, fetchDashboard, fetchHistory, fetchResults, fetchTimetable, putSubjectTarget, qk, type RetryFocusHandoff, type SlotConflict } from "./api";
import { AnimatedNumber } from "./trend-chart";
import { CustomTargetChip, erpAssignmentUrl, fmtDT, istNow, MiniBar, SkipPips, statusColors, StatusChip, useNow, ago } from "./shared";
import type { AssignmentRow, AttendanceStatus, HistoryResponse, ResultsResponse, SubjectView, TimetableSlotRow } from "./types";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TARGET_PRESETS = [60, 65, 70, 75, 80, 85];

function hhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Subject deadlines — open ALAs linked to THIS subject                 */
/* ------------------------------------------------------------------ */

function SubjectDeadlines({
  items,
  loading,
  onJump,
}: {
  items: AssignmentRow[];
  loading: boolean;
  onJump: (title: string) => void;
}) {
  const now = useNow(30_000);
  const overdue = items.filter((a) => new Date(a.dueAt).getTime() < now).length;
  return (
    <section
      aria-label="Active deadlines for this subject"
      className="rounded-xl border border-border/60 bg-card/50 p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <CalendarDays className="size-3.5" aria-hidden="true" />
          Active deadlines
        </h3>
        <span className="flex items-center gap-1.5">
          {overdue > 0 && (
            <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-600 dark:text-red-400">
              {overdue} overdue
            </span>
          )}
          <span
            className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground"
            aria-label={`${items.length} open deadlines`}
          >
            {items.length}
          </span>
        </span>
      </div>

      {loading && items.length === 0 ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" aria-hidden="true" /> Loading deadlines…
        </p>
      ) : items.length === 0 ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          No open ALA/assignment deadlines are linked to this subject right now. Deadlines appear here as soon as
          the ERP queue records them.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.map((a) => {
            const due = new Date(a.dueAt).getTime();
            const isOverdue = due < now;
            const soon = !isOverdue && due - now <= 48 * 3_600_000;
            const portalUrl = erpAssignmentUrl(a.externalId);
            return (
              <li key={a.id}>
                <div className="flex items-stretch">
                  <button
                    type="button"
                    onClick={() => onJump(a.title)}
                    className={cn(
                      "group/ala flex min-w-0 flex-1 items-start gap-2 rounded-l-lg border-l-2 bg-background/60 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-primary",
                      isOverdue ? "border-red-500/70" : soon ? "border-amber-500/70" : "border-border"
                    )}
                    title="Open in the Reminders tab"
                  >
                    <span className="mt-0.5 shrink-0" aria-hidden="true">
                      {isOverdue ? (
                        <TriangleAlert className="size-3.5 text-red-500" />
                      ) : soon ? (
                        <Hourglass className="size-3.5 text-amber-500" />
                      ) : (
                        <CalendarDays className="size-3.5 text-muted-foreground" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-foreground group-hover/ala:underline">
                        {a.title}
                      </span>
                      <span
                        className={cn(
                          "mt-0.5 block text-[10px]",
                          isOverdue
                            ? "font-semibold text-red-600 dark:text-red-400"
                            : soon
                              ? "font-semibold text-amber-600 dark:text-amber-400"
                              : "text-muted-foreground"
                        )}
                      >
                        {isOverdue ? `Overdue · due ${fmtDT(a.dueAt)}` : soon ? `Due soon · ${fmtDT(a.dueAt)}` : `Due ${fmtDT(a.dueAt)}`}
                      </span>
                    </span>
                    <ChevronRight
                      className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60 transition-transform group-hover/ala:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </button>
                  {portalUrl && (
                    <a
                      href={portalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open ${a.title} in the ERP portal (new tab)`}
                      title="Open in the ERP portal — submissions happen there (this app is a read-only mirror)"
                      className="flex w-9 shrink-0 items-center justify-center rounded-r-lg border-l border-border/40 bg-background/60 text-muted-foreground/70 transition-all hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
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
            {s.total === 0 && n === 0 ? (
              <span
                className={cn("text-2xl font-bold tabular-nums", pc.text)}
                title="No classes held yet — the ERP has not recorded attendance for this subject"
              >
                —
              </span>
            ) : (
              <span className={cn("text-2xl font-bold tabular-nums", pc.text)}>
                {n === 0 ? s.percentage.toFixed(2) : projected.toFixed(2)}
                <span className="text-sm font-semibold">%</span>
              </span>
            )}
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
          {s.total === 0 && n === 0 ? (
            <p className="text-xs font-medium italic text-muted-foreground">No classes yet</p>
          ) : projectedStatus === "safe" ? (
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
/* Per-subject target editor                                           */
/* ------------------------------------------------------------------ */

function SubjectTargetEditor({ s, globalTarget }: { s: SubjectView; globalTarget: number }) {
  const qc = useQueryClient();
  const [justSet, setJustSet] = useState<number | null>(null);

  const mutation = useMutation({
    mutationFn: (v: number | null) => putSubjectTarget(s.code, v),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: qk.attendance });
      qc.invalidateQueries({ queryKey: qk.dashboard });
      qc.invalidateQueries({ queryKey: qk.settings });
      setJustSet(res.targetPct);
      window.setTimeout(() => setJustSet(null), 1600);
      toast.success(
        res.hasCustomTarget
          ? `Target for ${s.code} set to ${res.targetPct}%`
          : `${s.code} reset to the global target (${res.targetPct}%)`
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save the target"),
  });

  const isActive = (p: number) => (s.hasCustomTarget ? s.targetPct === p : p === globalTarget);

  return (
    <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
          <Target className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          Target for this subject
        </p>
        {s.hasCustomTarget ? (
          <CustomTargetChip target={s.targetPct} />
        ) : (
          <Badge variant="outline" className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            global {globalTarget}%
          </Badge>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Different subjects can have different requirements (e.g. labs at 70%, theory at 75%). This changes the
        status colors, warnings and what-if math for <b className="text-foreground">{s.code}</b> only.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label={`Attendance target for ${s.code}`}>
        {TARGET_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            disabled={mutation.isPending}
            onClick={() => {
              if (!isActive(p)) mutation.mutate(p);
            }}
            aria-pressed={isActive(p)}
            className={cn(
              "h-8 min-w-11 rounded-lg border px-2 text-xs font-semibold tabular-nums transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
              isActive(p)
                ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                : "border-border/70 bg-background text-muted-foreground hover:border-emerald-500/40 hover:text-foreground"
            )}
          >
            {p}%
          </button>
        ))}
        <Button
          variant="outline"
          size="sm"
          disabled={mutation.isPending || !s.hasCustomTarget}
          className="h-8 gap-1 border-dashed text-xs text-muted-foreground"
          onClick={() => mutation.mutate(null)}
          aria-label={`Reset ${s.code} target to the global ${globalTarget}%`}
        >
          {mutation.isPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RotateCcw className="size-3.5" aria-hidden="true" />
          )}
          Default ({globalTarget}%)
        </Button>
        {justSet !== null && (
          <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400" role="status">
            <CheckCircle2 className="size-3.5" aria-hidden="true" /> saved — {justSet}%
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Subject trend mini chart (pure SVG, no deps)                        */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Recent ERP changes for this subject (from the change feed)          */
/* ------------------------------------------------------------------ */

function SubjectChanges({ code }: { code: string }) {
  // Shares the header's dashboard cache (same query key) — no extra fetch.
  const dash = useQuery({ queryKey: qk.dashboard, queryFn: fetchDashboard, enabled: true });
  const items = (dash.data?.changes ?? [])
    .filter((c) => c.subjectCode === code)
    .slice(0, 5);

  return (
    <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
        <History className="size-4 text-sky-500" aria-hidden="true" />
        Recent ERP changes
      </p>
      {items.length === 0 ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          No recorded changes for this subject yet — events appear here when the sync engine detects a
          difference on the ERP (a class held, a mark changed, the subject added or removed).
        </p>
      ) : (
        <ul className="mt-2.5 space-y-2">
          {items.map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-xs">
              <span className="mt-1 size-1.5 shrink-0 rounded-full bg-sky-500" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="leading-snug">{c.detail}</p>
                <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {c.kind.toLowerCase().replace(/_/g, " ")} · {ago(c.createdAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
/* Weekly classes for this subject + quick add                         */
/* ------------------------------------------------------------------ */

function SubjectTimetable({
  slots,
  subjectCode,
  subjectName,
  dimmedIds,
}: {
  slots: TimetableSlotRow[];
  subjectCode: string;
  subjectName: string;
  /** Row ids the student's parallel picks exclude — rendered dimmed + dashed. */
  dimmedIds?: Set<string>;
}) {
  const now = useNow();
  /* istNow — the "today" default for a NEW manual slot must follow the
     student's IST day, not the device's (a parent abroad adding a slot at
     20:00 IST on a UTC device would otherwise default to yesterday). */
  const today = istNow(now).day;
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [day, setDay] = useState<string>(String(today));
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [conflicts, setConflicts] = useState<SlotConflict[] | null>(null);

  const addMutation = useMutation({
    mutationFn: (force: boolean) =>
      createSlot({ dayOfWeek: Number(day), start, end, subjectCode, force }),
    onSuccess: (_res, force) => {
      qc.invalidateQueries({ queryKey: qk.timetable });
      qc.invalidateQueries({ queryKey: qk.dashboard });
      toast.success(
        force
          ? `${DAY_SHORT[Number(day)]} ${start}–${end} added for ${subjectCode} (overlap accepted)`
          : `${DAY_SHORT[Number(day)]} ${start}–${end} added for ${subjectCode}`
      );
      setConflicts(null);
      setAdding(false);
      setStart("");
      setEnd("");
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409 && Array.isArray(e.body.conflicts)) {
        setConflicts(e.body.conflicts as SlotConflict[]);
        return;
      }
      setConflicts(null);
      toast.error(e instanceof Error ? e.message : "Could not add the class");
    },
  });

  const valid = /^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end) && start < end;
  const resetConflicts = () => setConflicts(null);

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
      <div className="flex items-center gap-1.5">
        <p className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
          <CalendarDays className="size-4 text-emerald-500" aria-hidden="true" />
          Weekly classes
        </p>
        <Badge variant="secondary" className="ml-auto tabular-nums">{slots.length}/week</Badge>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
          onClick={() => setAdding((v) => !v)}
          aria-expanded={adding}
          aria-label={adding ? "Cancel adding a class" : `Add a weekly class for ${subjectName}`}
        >
          {adding ? <X className="size-3.5" aria-hidden="true" /> : <CalendarPlus className="size-3.5" aria-hidden="true" />}
          {adding ? "Cancel" : "Add"}
        </Button>
      </div>

      {adding && (
        <div className="mt-3 rounded-lg border border-border/60 bg-background p-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label htmlFor="slot-day" className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Day
              </label>
              <Select value={day} onValueChange={(v) => { setDay(v); resetConflicts(); }}>
                <SelectTrigger id="slot-day" className="h-9 text-xs" aria-label="Day of the week">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                    <SelectItem key={d} value={String(d)} className="text-xs">
                      {DAY_SHORT[d]}
                      {d === today ? " · today" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label htmlFor="slot-start" className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Start
              </label>
              <Input
                id="slot-start"
                type="time"
                value={start}
                onChange={(e) => { setStart(e.target.value); resetConflicts(); }}
                className="h-9 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="slot-end" className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                End
              </label>
              <Input
                id="slot-end"
                type="time"
                value={end}
                onChange={(e) => { setEnd(e.target.value); resetConflicts(); }}
                className="h-9 text-xs"
              />
            </div>
          </div>
          {conflicts && conflicts.length > 0 && (
            <div role="alert" className="mt-2.5 rounded-lg border border-amber-500/50 bg-amber-500/[0.08] p-2.5">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
                Time conflict — overlaps {conflicts.length === 1 ? "1 class" : `${conflicts.length} classes`}
              </p>
              <ul className="mt-1.5 space-y-1">
                {conflicts.map((c) => (
                  <li key={c.id} className="flex items-center gap-1.5 text-[11px] text-amber-800 dark:text-amber-300/90">
                    <span className="size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
                    <span className="font-mono font-semibold">{c.subjectCode}</span>
                    <span className="tabular-nums">{c.start}–{c.end}</span>
                    {c.source === "demo" && <span className="text-amber-700/60 dark:text-amber-400/50">· demo</span>}
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 border-amber-500/50 px-2.5 text-[11px] text-amber-700 hover:bg-amber-500/15 dark:text-amber-400"
                  disabled={addMutation.isPending}
                  onClick={() => addMutation.mutate(true)}
                >
                  {addMutation.isPending ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : <CalendarPlus className="size-3" aria-hidden="true" />}
                  Add anyway
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2.5 text-[11px] text-muted-foreground"
                  onClick={resetConflicts}
                >
                  Pick another time
                </Button>
              </div>
            </div>
          )}
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              {valid ? "Looks good — saved locally, never written to the ERP." : "Pick a day and a start/end time (end must be after start)."}
            </p>
            <Button
              size="sm"
              className="h-8 gap-1 text-xs"
              disabled={!valid || addMutation.isPending}
              onClick={() => addMutation.mutate(false)}
            >
              {addMutation.isPending && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
              Add class
            </Button>
          </div>
        </div>
      )}

      {slots.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          No timetable slots recorded for this subject{adding ? "." : " — use the Add button above to record one."}
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {orderedDays.map((d) => (
            <li key={d} className="flex items-center gap-2.5">
              <span
                className={cn(
                  "w-10 shrink-0 rounded-md px-1.5 py-0.5 text-center text-[11px] font-semibold",
                  d === today ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"
                )}
              >
                {DAY_SHORT[d]}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {byDay.get(d)!.map((slot) => {
                  const isAlt = dimmedIds?.has(slot.id) ?? false;
                  return (
                    <span
                      key={slot.id}
                      className={cn(
                        "rounded-md border px-2 py-0.5 text-[11px] tabular-nums",
                        isAlt
                          ? "border-dashed border-border/50 bg-muted/40 text-muted-foreground/70"
                          : "border-border/60 bg-background text-foreground/80"
                      )}
                      title={
                        isAlt
                          ? "Alternative batch — you picked a different class for this window"
                          : undefined
                      }
                    >
                      {hhmm(slot.startMin)}–{hhmm(slot.endMin)}
                    </span>
                  );
                })}
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
  globalTarget,
  open,
  onOpenChange,
}: {
  subject: SubjectView | null;
  target: number;
  globalTarget: number;
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
  /* The full ALA/assignment queue — deduped with the page-level badge poll via the
     shared qk.assignments cache (zero extra traffic). Filtered per subject below
     using the ERP course-code → name map, because ALA rows carry real university
     course codes (BETCE15315) while tracked subjects use slug codes. */
  const assignmentsQ = useQuery({
    queryKey: qk.assignments,
    queryFn: fetchAssignments,
    enabled: open,
    refetchInterval: 60_000,
  });

  const myDeadlines = useMemo(() => {
    if (!subject) return [] as AssignmentRow[];
    const res = assignmentsQ.data;
    if (!res?.assignments) return [] as AssignmentRow[];
    const name = subject.name.trim().toLowerCase();
    const codes = new Set(
      Object.entries(res.courseNames ?? {})
        .filter(([, n]) => (n ?? "").trim().toLowerCase() === name)
        .map(([c]) => c)
    );
    return res.assignments
      .filter((a) => a.status === "ACTIVE" && a.subjectCode != null && codes.has(a.subjectCode))
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  }, [assignmentsQ.data, subject]);

  // Parallel-pick awareness: rows this subject lost to a resolved parallel
  // window render dimmed + dashed in the timetable panel too (same math as
  // the week plan and the timetable card — one source of truth).
  // NOTE: stays ABOVE the `if (!subject) return null` early return — hooks
  // must run unconditionally (a conditional useMemo crashed the drawer).
  const altSlotIds = useMemo(
    () => new Set(applyBatchPicks(timetable.data?.slots ?? [], timetable.data?.picks ?? {}).excluded.map((s) => s.id)),
    [timetable.data]
  );
  /* Retry-story awareness — READ-ONLY cache join (enabled:false never
     fetches): the dashboard's academic-record card already loaded the exam
     results, so this just asks "does THIS subject have a roll-up retry
     story?". Drifted/unknown codes gate to null → no affordance, same
     honesty contract as everywhere else. */
  const resultsQ = useQuery<ResultsResponse | null>({
    queryKey: qk.results,
    queryFn: () => fetchResults(),
    enabled: false,
  });
  const retryStory = useMemo(
    () =>
      subject && resultsQ.data
        ? matchStoryCode(subject.code, subjectStories(resultsQ.data.exams))
        : null,
    [resultsQ.data, subject]
  );
  const queryClient = useQueryClient();

  if (!subject) return null;
  const c = statusColors(subject.status);
  const mySlots = (timetable.data?.slots ?? []).filter((s) => s.subjectCode === subject.code);

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
              subject.status === "safe"
                ? "bg-emerald-500"
                : subject.status === "warning"
                  ? "bg-amber-500"
                  : subject.status === "danger"
                    ? "bg-red-500"
                    : "bg-slate-400"
            )}
          />
          <div className="relative flex items-start justify-between gap-3 pr-10 sm:pr-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("rounded-md bg-background/70 px-2 py-0.5 font-mono text-[11px] font-bold backdrop-blur", c.text)}>
                  {subject.code}
                </span>
                <StatusChip status={subject.status} target={subject.targetPct} />
                {subject.hasCustomTarget && <CustomTargetChip target={subject.targetPct} />}
              </div>
              <h2 className="mt-1.5 truncate text-lg font-semibold tracking-tight">{subject.name}</h2>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <History className="size-3" aria-hidden="true" />
                Updated {fmtDT(subject.updatedAt)}
              </p>
            </div>
            <div className="shrink-0 text-right">
              {subject.status === "none" ? (
                <p
                  className={cn("text-3xl font-bold tracking-tight tabular-nums", c.text)}
                  title="No classes held yet — the ERP has not recorded attendance for this subject"
                >
                  —
                </p>
              ) : (
                <p className={cn("text-3xl font-bold tracking-tight tabular-nums", c.text)}>
                  <AnimatedNumber value={subject.percentage} suffix="%" />
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                target {subject.targetPct}%{subject.hasCustomTarget ? " · custom" : ""}
              </p>
            </div>
          </div>
          <MiniBar percentage={subject.percentage} status={subject.status} target={subject.targetPct} className="relative mt-3.5 h-2.5" />
          {subject.status === "safe" && (
            <div className="mt-2 flex items-center justify-end gap-2">
              <SkipPips
                count={subject.canSkip}
                title={
                  subject.canSkip > 0
                    ? `Skip budget: you could miss ${subject.canSkip} more ${
                        subject.canSkip === 1 ? "class" : "classes"
                      } and stay at/above ${subject.targetPct}% (${subject.present}/${subject.total} now)`
                    : `No skip buffer — missing even 1 class would drop you below ${subject.targetPct}%`
                }
              />
              <span className="text-[11px] text-muted-foreground">
                {subject.canSkip > 0
                  ? `can miss ${subject.canSkip} more ${subject.canSkip === 1 ? "class" : "classes"}`
                  : "no skip buffer"}
              </span>
            </div>
          )}
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
                  subject.total === 0
                    ? "text-muted-foreground"
                    : subject.classesToTarget > 0
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-emerald-600 dark:text-emerald-400"
                )}
              >
                {subject.total === 0 ? "—" : subject.classesToTarget > 0 ? subject.classesToTarget : "✓"}
              </p>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {subject.total === 0 ? "No data" : subject.classesToTarget > 0 ? "To reach" : "On target"}
              </p>
            </div>
          </div>

          {/* Retry story — this subject's published grade timeline lives in
              the academic-record card. Only shown when the gate finds the
              story (exact code match); the jump closes the drawer, then
              hands off via the shared cache so the card opens + spotlights. */}
          {retryStory && (
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                window.setTimeout(() => {
                  queryClient.setQueryData<RetryFocusHandoff>(qk.retryFocus, {
                    code: retryStory.code,
                    nonce: Date.now(),
                  });
                }, 120);
              }}
              aria-label={`Open the retry story for ${subject.code} in the academic record card — grade timeline, oldest to latest`}
              className="group flex w-full items-center gap-2.5 rounded-lg border border-violet-500/30 bg-violet-500/5 px-3 py-2 text-left transition-colors hover:bg-violet-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
            >
              <History className="size-3.5 shrink-0 text-violet-600 dark:text-violet-400" aria-hidden="true" />
              <span className="min-w-0 flex-1 text-xs leading-snug">
                <span className="font-medium text-violet-700 dark:text-violet-300">Retry story</span>
                <span className="text-muted-foreground">
                  {" "}
                  — {retryStory.attempts.length} attempt{retryStory.attempts.length === 1 ? "" : "s"}, latest{" "}
                  {retryStory.latestGrade ?? "—"}
                  {retryStory.cleared ? " · cleared" : " · not cleared"}
                </span>
              </span>
              <ArrowRight
                className="size-3.5 shrink-0 text-violet-500 opacity-0 transition-opacity duration-150 group-hover:opacity-60 group-focus-visible:opacity-60"
                aria-hidden="true"
              />
            </button>
          )}

          <SubjectDeadlines
            items={myDeadlines}
            loading={assignmentsQ.isPending && open}
            onJump={(title) => {
              onOpenChange(false);
              window.location.hash = "reminders";
              window.setTimeout(() => {
                window.dispatchEvent(new CustomEvent("erp:focus-ala", { detail: title }));
              }, 150);
            }}
          />

          <WhatIfPlanner key={subject.id} s={subject} target={subject.targetPct} />

          <SubjectTargetEditor s={subject} globalTarget={globalTarget} />

          <SubjectTrend history={history.data} code={subject.code} />

          <SubjectChanges code={subject.code} />

          <SubjectTimetable
            slots={mySlots}
            subjectCode={subject.code}
            subjectName={subject.name}
            dimmedIds={altSlotIds}
          />

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
