"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { GraduationCap, Inbox, PanelRightOpen, Target, TrendingUp, Users, XCircle, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { attendanceStatus, classesToReachTarget } from "@/lib/attendance";
import { fetchAssignments, fetchAttendance, fetchHistory, qk, type SubjectFocusHandoff } from "./api";
import { HistoryHeatmap } from "./history-heatmap";
import { RecoveryPlan } from "./recovery-plan";
import { SubjectDrawer } from "./subject-drawer";
import {
  AlaStatChip,
  collectAlaStats,
  CustomTargetChip,
  EmptyHero,
  fmtPct2,
  MiniBar,
  ProgressRing,
  SkipPips,
  statusColors,
  StatusChip,
  useNow,
  type SubjectAlaStat,
} from "./shared";
import { AnimatedNumber, ExportAttendanceButton, Sparkline, TrendSection } from "./trend-chart";
import type { HistoryResponse, SubjectView } from "./types";
import { WhatIfOverall } from "./what-if-overall";

const SUBJECT_LINE_COLORS = ["#10b981", "#f59e0b", "#84cc16", "#f97316", "#14b8a6", "#a8a29e", "#ef4444"];

/*
 * What-if planner: simulate the next classes two ways —
 *   Attend n → (present+n)/(total+n)
 *   Skip n   →  present/(total+n)
 * The projection re-uses the server's status thresholds (safe ≥ target,
 * warning ≥ target−5, danger below), so what you see here is exactly how
 * the app will grade the result after it happens.
 */
function WhatIfPlanner({ s }: { s: SubjectView }) {
  const [mode, setMode] = useState<"attend" | "skip">("attend");
  const [n, setN] = useState(0);
  const futureTotal = s.total + n;
  const projected =
    n === 0 || futureTotal === 0
      ? s.percentage
      : mode === "attend"
        ? ((s.present + n) / futureTotal) * 100
        : (s.present / futureTotal) * 100;
  const projectedStatus = attendanceStatus(projected, s.targetPct, futureTotal || 1);
  const c = statusColors(projectedStatus);
  const delta = projected - s.percentage;
  const active = n > 0;
  /* Recovery hint must reflect the POST-simulation numbers: after skipping n
     classes the old classesToTarget is stale (it ignores the skips). */
  const recoverClasses = classesToReachTarget(
    mode === "attend" ? s.present + n : s.present,
    futureTotal,
    s.targetPct
  );

  return (
    <div
      className={cn(
        "mt-3 rounded-lg border p-3 transition-colors duration-300",
        active ? cn(c.border, c.bg) : "border-border/60 bg-muted/60"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Zap className="size-3.5 text-amber-500" aria-hidden="true" />
          What-if planner
        </span>
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
                setMode(m);
                setN(0);
              }}
              aria-pressed={mode === m}
              className={cn(
                "relative rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                mode === m
                  ? m === "attend"
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-red-700 dark:text-red-400"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {mode === m && (
                <motion.span
                  layoutId={`whatif-thumb-${s.id}`}
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

      <p className="mt-2 text-xs text-muted-foreground">
        If I <b className={mode === "attend" ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}>
          {mode === "attend" ? "attend" : "miss"}
        </b>{" "}
        the next <b className="tabular-nums text-foreground">{n}</b> {n === 1 ? "class" : "classes"}
      </p>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        {s.total === 0 && n === 0 ? (
          <span
            className={cn("text-lg font-bold tabular-nums", c.text)}
            title="No classes held yet — the ERP has not recorded attendance for this subject"
          >
            —
          </span>
        ) : (
          <span className={cn("text-lg font-bold tabular-nums", c.text)}>
            <AnimatedNumber value={projected} suffix="%" />
          </span>
        )}
        {n > 0 && (
          <span className={cn("text-[11px] font-medium tabular-nums", c.text)}>
            ({delta >= 0 ? "+" : "−"}{Math.abs(delta).toFixed(2)} pts)
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">target {s.targetPct}%</span>
      </div>

      <Slider
        className="mt-2.5"
        value={[n]}
        min={0}
        max={10}
        step={1}
        aria-label={`Simulate ${mode === "attend" ? "attending" : "skipping"} the next classes for ${s.name}`}
        onValueChange={(v) => setN(v[0] ?? 0)}
      />
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground/70 tabular-nums">
        <span>0</span>
        <span>5</span>
        <span>10</span>
      </div>

      {n > 0 && (
        <p className={cn("mt-2 text-[11px] leading-snug", c.text)}>
          {projectedStatus === "safe"
            ? mode === "attend"
              ? `Back on track — ${s.targetPct}% target met with ${n} attended.`
              : `Still at/above the ${s.targetPct}% target.`
            : projectedStatus === "warning"
              ? `Within 5 pts of the ${s.targetPct}% target — close, not safe.`
              : recoverClasses > 0
                ? `Below the ${s.targetPct}% target — ${recoverClasses} attended ${recoverClasses === 1 ? "class" : "classes"} needed to recover.`
                : `Below the ${s.targetPct}% target — no class schedule to recover with yet.`}
        </p>
      )}
    </div>
  );
}

function SubjectCard({
  s,
  target,
  index,
  history,
  onOpen,
  showSemester,
  alaStat,
}: {
  s: SubjectView;
  target: number;
  index: number;
  history: HistoryResponse | undefined;
  onOpen: () => void;
  /** When no semester partition is active, mixed semesters are labeled on each card. */
  showSemester: boolean;
  /** Open ALA/assignment deadlines for this subject (amber when any overdue). */
  alaStat?: SubjectAlaStat;
}) {
  const c = statusColors(s.status);
  const safe = s.status === "safe";
  const spark = history?.subjects[s.code] ?? [];
  const color = SUBJECT_LINE_COLORS[index % SUBJECT_LINE_COLORS.length];
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2, transition: { duration: 0.15 } }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.05, 0.3) }}
    >
      <Card className="flex h-full flex-col rounded-xl border-border/60 transition-all duration-200 hover:border-primary/30 hover:shadow-md hover:shadow-black/5 dark:hover:shadow-black/20">
        <CardHeader className="pb-2">
          {/* min-w-0: this row is a grid child of CardHeader — without it a long
              unwrapped title pushes the sparkline column past the card edge. */}
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <CardTitle className="truncate text-base tracking-tight">{s.name}</CardTitle>
              <CardDescription className="mt-0.5 flex items-center gap-1.5 font-mono text-xs">
                <span className="truncate">{s.code}</span>
                {showSemester && s.semester != null && (
                  <span
                    className="shrink-0 rounded bg-muted px-1 font-sans text-[10px] font-semibold text-muted-foreground"
                    title={`Semester ${s.semester} (as reported by the ERP)`}
                  >
                    S{s.semester}
                  </span>
                )}
                <AlaStatChip stat={alaStat} />
              </CardDescription>
            </div>
            <div className="flex w-24 shrink-0 flex-col items-end gap-1">
              {s.status === "none" ? (
                <span
                  className={cn("shrink-0 rounded-md px-2 py-1 text-sm font-bold tabular-nums", c.bg, c.text)}
                  title="No classes held yet — the ERP has not recorded attendance for this subject"
                >
                  —
                </span>
              ) : (
                <span className={cn("shrink-0 rounded-md px-2 py-1 text-sm font-bold tabular-nums", c.bg, c.text)}>
                  <AnimatedNumber value={s.percentage} suffix="%" />
                </span>
              )}
              {spark.length >= 2 && (
                <Sparkline
                  points={spark.map((p) => p.percentage)}
                  stroke={color}
                  width={84}
                  height={20}
                  target={s.targetPct}
                  className="max-w-full opacity-80"
                  ariaLabel={`${s.name} attendance trend with target marker`}
                />
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-3">
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg bg-emerald-500/10 px-2 py-1.5">
              <p className="text-base font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">{s.present}</p>
              <p className="text-[11px] text-muted-foreground">Present</p>
            </div>
            <div className="rounded-lg bg-muted px-2 py-1.5">
              <p className="text-base font-semibold tabular-nums">{s.total}</p>
              <p className="text-[11px] text-muted-foreground">Total</p>
            </div>
            <div className="rounded-lg bg-red-500/10 px-2 py-1.5">
              <p className="text-base font-semibold text-red-700 dark:text-red-400 tabular-nums">{s.absent}</p>
              <p className="text-[11px] text-muted-foreground">Absent</p>
            </div>
          </div>

          <MiniBar percentage={s.percentage} status={s.status} target={s.targetPct} />

          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={s.status} target={s.targetPct} />
            {s.hasCustomTarget && <CustomTargetChip target={s.targetPct} />}
            {safe ? (
              s.canSkip > 0 ? (
                <Badge variant="outline" className="gap-1.5 border-emerald-500/30 text-emerald-700 dark:text-emerald-400">
                  <SkipPips
                    count={s.canSkip}
                    max={8}
                    title={`You could miss ${s.canSkip} more ${
                      s.canSkip === 1 ? "class" : "classes"
                    } and stay at/above ${s.targetPct}%`}
                  />
                  Can miss {s.canSkip} {s.canSkip === 1 ? "class" : "classes"}
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1.5 border-emerald-500/30 text-emerald-700 dark:text-emerald-400">
                  <SkipPips
                    count={0}
                    title={`No skip buffer — missing even 1 class would drop you below ${s.targetPct}%`}
                  />
                  No skip buffer
                </Badge>
              )
            ) : s.status === "none" ? (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <Inbox className="size-3" aria-hidden="true" />
                No classes yet
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400">
                <TrendingUp className="size-3" aria-hidden="true" />
                Attend next {s.classesToTarget} {s.classesToTarget === 1 ? "class" : "classes"} to reach {s.targetPct}%
              </Badge>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            {safe
              ? `You can miss ${s.canSkip} more ${s.canSkip === 1 ? "class" : "classes"} and stay above the ${s.targetPct}% target${s.hasCustomTarget ? " (custom)" : ""}.`
              : s.status === "none"
                ? `No classes held yet — targets and planning hints appear once the ERP records the first class.`
                : `Attend the next ${s.classesToTarget} ${s.classesToTarget === 1 ? "class" : "classes"} to reach ${s.targetPct}%${s.hasCustomTarget ? " (custom target)" : ""}.`}
          </p>

          <div className="mt-auto space-y-2">
            <WhatIfPlanner s={s} />
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-full gap-1.5 text-xs"
              onClick={onOpen}
              aria-label={`Open details, trend and weekly classes for ${s.name}`}
            >
              <PanelRightOpen className="size-3.5" aria-hidden="true" />
              Details · trend · weekly classes
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export function AttendanceTab({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  /* Command palette → open a subject's detail drawer via the qk.subjectFocus
     handoff (READ-ONLY join, enabled:false never fetches). Unlike the old
     window CustomEvent this survives tab unmounts: the palette writes the
     handoff even before this tab mounts, and the effect consumes it on
     arrival — no more dropped "open subject" commands. */
  const subjectFocus = useQuery<SubjectFocusHandoff | null>({
    queryKey: qk.subjectFocus,
    queryFn: () => null,
    enabled: false,
  });
  const queryClient = useQueryClient();
  useEffect(() => {
    const handoff = subjectFocus.data;
    if (!handoff) return;
    setSelectedCode(handoff.code);
    queryClient.setQueryData(qk.subjectFocus, null);
  }, [subjectFocus.data, queryClient]);
  // Day focused jointly by the trend chart and the history heatmap.
  const [focusDay, setFocusDay] = useState<string | null>(null);
  const { data, isPending, isError, error } = useQuery({
    queryKey: qk.attendance,
    queryFn: fetchAttendance,
    refetchInterval: 20_000,
  });
  const history = useQuery({
    queryKey: qk.history,
    queryFn: fetchHistory,
    refetchInterval: 60_000,
  });
  /* Full ALA queue — deduped with the page-level badge poll via the shared
     qk.assignments cache. Feeds the per-subject "N ALAs" chips on subject cards
     (amber when any deadline is overdue); each card's drawer lists them. */
  const alaQ = useQuery({
    queryKey: qk.assignments,
    queryFn: fetchAssignments,
    refetchInterval: 60_000,
  });
  const nowMs = useNow(60_000);
  const alaStats = useMemo(
    () => collectAlaStats(alaQ.data?.assignments, alaQ.data?.courseNames, nowMs),
    [alaQ.data, nowMs]
  );

  /* (The old erp:open-subject CustomEvent listener was replaced by the
     qk.subjectFocus handoff above — the palette is its only sender.) */

  /* Command palette → deep-link to the overall what-if simulator: scroll it
     into view and flash the card ring so the target is obvious. */
  const simRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const goto = () => {
      const el = simRef.current;
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary/50", "ring-offset-2", "ring-offset-background");
      window.setTimeout(
        () => el.classList.remove("ring-2", "ring-primary/50", "ring-offset-2", "ring-offset-background"),
        1800
      );
    };
    window.addEventListener("erp:goto-whatif", goto);
    return () => window.removeEventListener("erp:goto-whatif", goto);
  }, []);

  const selectedSubject = data?.subjects.find((x) => x.code === selectedCode) ?? null;

  if (isPending) {
    return (
      <div className="space-y-4">
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-64 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Card className="rounded-xl border-red-500/30 bg-red-500/5">
        <CardContent className="flex items-center gap-3 p-6 text-sm text-red-600 dark:text-red-400">
          <XCircle className="size-5 shrink-0" aria-hidden="true" />
          Could not load attendance: {error?.message ?? "unknown error"}
        </CardContent>
      </Card>
    );
  }

  const { overall, subjects, target } = data;
  const customCount = subjects.filter((s) => s.hasCustomTarget).length;
  const semesterActive = data.semester !== "all";

  if (subjects.length === 0) {
    return (
      <EmptyHero
        title={
          semesterActive
            ? `No subjects for Semester ${data.semester} yet.`
            : "No ERP data available yet."
        }
        description={
          semesterActive
            ? `The ERP hasn't synchronized any subjects for Semester ${data.semester}. Switch the semester in Settings (or choose All) to see the rest of your synchronized data.`
            : "Once you connect your ERP account or the first sync completes, every subject appears here with per-class what-if planning."
        }
        actionLabel="Open semester settings"
        onAction={onOpenSettings}
      />
    );
  }

  return (
    <div className="space-y-4">
      <SubjectDrawer
        subject={selectedSubject}
        target={target}
        globalTarget={target}
        open={selectedSubject !== null}
        onOpenChange={(o) => {
          if (!o) setSelectedCode(null);
        }}
      />

      {/* Summary strip */}
      <Card className="rounded-xl border-border/60">
        <CardContent className="flex flex-wrap items-center gap-5 p-4 sm:gap-8 sm:p-6">
          <ProgressRing percentage={overall.percentage} target={target} size={104} stroke={9} />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight">Overall</h2>
              {semesterActive && (
                <Badge
                  variant="outline"
                  className="gap-1 border-primary/40 text-primary"
                  title="A semester partition is active — only this semester's ERP subjects are counted"
                >
                  <GraduationCap className="size-3" aria-hidden="true" />
                  Sem {data.semester}
                </Badge>
              )}
              <Badge variant="outline" className="tabular-nums">Target {target}%</Badge>
              {overall.status === "danger" && (
                <span className="relative flex size-2" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-red-500" />
                </span>
              )}
              <StatusChip status={overall.status} target={target} />
              {customCount > 0 && (
                <Badge
                  variant="outline"
                  className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400"
                  title="Some subjects use their own attendance target — see each subject card"
                >
                  <Target className="size-3" aria-hidden="true" />
                  {customCount} custom {customCount === 1 ? "target" : "targets"}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground tabular-nums">
              <span className="inline-flex items-center gap-1">
                <Users className="size-3.5" aria-hidden="true" />
                {overall.present} present · {overall.absent} absent · {overall.total} total classes
              </span>
            </p>
            {overall.classesToTarget > 0 ? (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                Attend the next <b className="tabular-nums">{overall.classesToTarget}</b>{" "}
                {overall.classesToTarget === 1 ? "class" : "classes"} to reach {target}%.
              </p>
            ) : (
              <p className="text-sm text-emerald-600 dark:text-emerald-400">
                You can miss <b className="tabular-nums">{overall.canSkip}</b>{" "}
                {overall.canSkip === 1 ? "class" : "classes"} and stay above {target}%.
              </p>
            )}
          </div>
          {/* Full-width row under the ring+text on mobile, right-aligned on larger screens */}
          <div className="ms-auto w-full sm:w-auto">
            <ExportAttendanceButton subjects={subjects} />
          </div>
        </CardContent>
      </Card>

      {/* Overall what-if simulator (aggregate sibling of the drawer planner) */}
      <div ref={simRef} className="scroll-mt-24 rounded-xl">
        <WhatIfOverall overall={overall} target={target} />
      </div>

      {/* Recovery pace & ETA, measured from sync snapshots */}
      <RecoveryPlan overall={overall} subjects={subjects} target={target} history={history.data} />

      {/* Trend chart (from sync snapshots) */}
      <TrendSection
        history={history.data}
        subjects={subjects}
        target={target}
        focusDay={focusDay}
        onFocusDay={setFocusDay}
      />

      {/* Daily history heatmap (from sync snapshots) */}
      {history.data && history.data.overall.length > 0 && (
        <HistoryHeatmap
          overall={history.data.overall}
          target={target}
          focusKey={focusDay}
          onSelectDay={setFocusDay}
        />
      )}

      {/* Subject grid */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {subjects.map((s, i) => (
          <SubjectCard
            key={s.id}
            s={s}
            target={target}
            index={i}
            history={history.data}
            showSemester={!semesterActive}
            onOpen={() => setSelectedCode(s.code)}
            alaStat={alaStats.get(s.name.trim().toLowerCase())}
          />
        ))}
      </div>
    </div>
  );
}
