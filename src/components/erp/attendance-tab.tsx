"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { CheckCircle2, GraduationCap, PanelRightOpen, Target, TrendingUp, Users, XCircle, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { fetchAttendance, fetchHistory, qk } from "./api";
import { HistoryHeatmap } from "./history-heatmap";
import { SubjectDrawer } from "./subject-drawer";
import {
  CustomTargetChip,
  EmptyHero,
  fmtPct2,
  MiniBar,
  ProgressRing,
  statusColors,
  StatusChip,
} from "./shared";
import { AnimatedNumber, ExportAttendanceButton, Sparkline, TrendSection } from "./trend-chart";
import type { HistoryResponse, SubjectView } from "./types";

const SUBJECT_LINE_COLORS = ["#10b981", "#f59e0b", "#84cc16", "#f97316", "#14b8a6", "#a8a29e", "#ef4444"];

/* What-if: attending the next N classes projects (present+N)/(total+N). */
function WhatIfSlider({ s }: { s: SubjectView }) {
  const [n, setN] = useState(0);
  const projected = n === 0 ? s.percentage : ((s.present + n) / (s.total + n)) * 100;
  return (
    <div className="mt-3 rounded-lg bg-muted/60 p-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
          <Zap className="size-3.5 text-amber-500" aria-hidden="true" />
          If I attend the next <b className="tabular-nums text-foreground">{n}</b>{" "}
          {n === 1 ? "class" : "classes"}
        </span>
        <span className={cn("font-semibold tabular-nums", n === 0 ? "text-foreground" : statusColors("safe").text)}>
          → {fmtPct2(projected)}
        </span>
      </div>
      <Slider
        className="mt-2.5"
        value={[n]}
        min={0}
        max={10}
        step={1}
        aria-label={`Simulate attending the next classes for ${s.name}`}
        onValueChange={(v) => setN(v[0] ?? 0)}
      />
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground/70 tabular-nums">
        <span>0</span>
        <span>5</span>
        <span>10</span>
      </div>
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
}: {
  s: SubjectView;
  target: number;
  index: number;
  history: HistoryResponse | undefined;
  onOpen: () => void;
  /** When no semester partition is active, mixed semesters are labeled on each card. */
  showSemester: boolean;
}) {
  const c = statusColors(s.status);
  const safe = s.status === "safe";
  const spark = history?.subjects[s.code] ?? [];
  const color = SUBJECT_LINE_COLORS[index % SUBJECT_LINE_COLORS.length];
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.05, 0.3) }}
    >
      <Card className="flex h-full flex-col rounded-xl border-border/60 transition-colors hover:border-primary/30">
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
              </CardDescription>
            </div>
            <div className="flex w-24 shrink-0 flex-col items-end gap-1">
              <span className={cn("shrink-0 rounded-md px-2 py-1 text-sm font-bold tabular-nums", c.bg, c.text)}>
                <AnimatedNumber value={s.percentage} suffix="%" />
              </span>
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

          <MiniBar percentage={s.percentage} status={s.status} />

          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={s.status} target={s.targetPct} />
            {s.hasCustomTarget && <CustomTargetChip target={s.targetPct} />}
            {safe ? (
              s.canSkip > 0 ? (
                <Badge variant="outline" className="gap-1 border-emerald-500/30 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="size-3" aria-hidden="true" />
                  Can miss {s.canSkip} {s.canSkip === 1 ? "class" : "classes"}
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 border-emerald-500/30 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="size-3" aria-hidden="true" />
                  Exactly on target
                </Badge>
              )
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
              : `Attend the next ${s.classesToTarget} ${s.classesToTarget === 1 ? "class" : "classes"} to reach ${s.targetPct}%${s.hasCustomTarget ? " (custom target)" : ""}.`}
          </p>

          <div className="mt-auto space-y-2">
            <WhatIfSlider s={s} />
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

  /* Command palette → open a subject's detail drawer. The code is stored and
     resolved against fetched data, so the drawer also opens when the event
     arrives before the query has finished. */
  useEffect(() => {
    const handler = (e: Event) => {
      const code = (e as CustomEvent<string>).detail;
      if (typeof code === "string") setSelectedCode(code);
    };
    window.addEventListener("erp:open-subject", handler);
    return () => window.removeEventListener("erp:open-subject", handler);
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
          />
        ))}
      </div>
    </div>
  );
}
