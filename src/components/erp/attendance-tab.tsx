"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { CheckCircle2, TrendingUp, Users, XCircle, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { fetchAttendance, qk } from "./api";
import {
  EmptyHero,
  fmtPct2,
  MiniBar,
  ProgressRing,
  statusColors,
  StatusChip,
} from "./shared";
import type { SubjectView } from "./types";

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

function SubjectCard({ s, target, index }: { s: SubjectView; target: number; index: number }) {
  const c = statusColors(s.status);
  const safe = s.status === "safe";
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.05, 0.3) }}
    >
      <Card className="flex h-full flex-col rounded-xl border-border/60 transition-colors hover:border-primary/30">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="truncate text-base tracking-tight">{s.name}</CardTitle>
              <CardDescription className="mt-0.5 font-mono text-xs">{s.code}</CardDescription>
            </div>
            <span className={cn("shrink-0 rounded-md px-2 py-1 text-sm font-bold tabular-nums", c.bg, c.text)}>
              {fmtPct2(s.percentage)}
            </span>
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
            <StatusChip status={s.status} target={target} />
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
                Attend next {s.classesToTarget} {s.classesToTarget === 1 ? "class" : "classes"} to reach {target}%
              </Badge>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            {safe
              ? `You can miss ${s.canSkip} more ${s.canSkip === 1 ? "class" : "classes"} and stay above the ${target}% target.`
              : `Attend the next ${s.classesToTarget} ${s.classesToTarget === 1 ? "class" : "classes"} to reach ${target}%.`}
          </p>

          <div className="mt-auto">
            <WhatIfSlider s={s} />
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export function AttendanceTab({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: qk.attendance,
    queryFn: fetchAttendance,
    refetchInterval: 20_000,
  });

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

  if (subjects.length === 0) {
    return (
      <EmptyHero
        title="No ERP data available yet."
        description="Once you connect your ERP account or the first sync completes, every subject appears here with per-class what-if planning."
        actionLabel="Connect / Sync ERP"
        onAction={onOpenSettings}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <Card className="rounded-xl border-border/60">
        <CardContent className="flex flex-wrap items-center gap-5 p-4 sm:gap-8 sm:p-6">
          <ProgressRing percentage={overall.percentage} target={target} size={104} stroke={9} />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight">Overall</h2>
              <Badge variant="outline" className="tabular-nums">Target {target}%</Badge>
              <StatusChip status={overall.status} target={target} />
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
        </CardContent>
      </Card>

      {/* Subject grid */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {subjects.map((s, i) => (
          <SubjectCard key={s.id} s={s} target={target} index={i} />
        ))}
      </div>
    </div>
  );
}
