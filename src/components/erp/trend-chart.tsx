"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, useSpring, useTransform } from "framer-motion";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format } from "date-fns";
import { Activity, Download } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { HistoryPoint, HistoryResponse, SubjectView } from "./types";

/* ------------------------------------------------------------------ */
/* Animated number (spring-smoothed)                                   */
/* ------------------------------------------------------------------ */

export function AnimatedNumber({
  value,
  decimals = 2,
  suffix = "",
  className,
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  className?: string;
}) {
  const spring = useSpring(value, { stiffness: 70, damping: 18, mass: 0.8 });
  useEffect(() => {
    spring.set(value);
  }, [spring, value]);
  const display = useTransform(spring, (v) => `${v.toFixed(decimals)}${suffix}`);
  return <motion.span className={cn("tabular-nums", className)}>{display}</motion.span>;
}

/* ------------------------------------------------------------------ */
/* Sparkline (dependency-free inline SVG)                              */
/* ------------------------------------------------------------------ */

export function Sparkline({
  points,
  stroke,
  width = 220,
  height = 40,
  className,
  ariaLabel,
  target,
}: {
  points: number[];
  stroke: string;
  width?: number;
  height?: number;
  className?: string;
  ariaLabel?: string;
  /** Optional attendance-target % — drawn as a faint dashed tick when inside the data range. */
  target?: number;
}) {
  const path = useMemo(() => {
    if (points.length < 2) return null;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const span = max - min || 1;
    const stepX = width / (points.length - 1);
    const coords = points.map((p, i) => {
      const x = i * stepX;
      const y = height - 4 - ((p - min) / span) * (height - 8);
      return [x, y] as const;
    });
    const d = coords.reduce((acc, [x, y], i) => (i === 0 ? `M ${x},${y}` : `${acc} L ${x},${y}`), "");
    const targetY =
      target !== undefined && target >= min && target <= max
        ? height - 4 - ((target - min) / span) * (height - 8)
        : null;
    return { d, targetY };
  }, [points, width, height, target]);

  if (!path) return null;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={ariaLabel ?? "attendance trend"}
    >
      {path.targetY !== null && (
        <line
          x1={0}
          x2={width}
          y1={path.targetY}
          y2={path.targetY}
          stroke="var(--muted-foreground)"
          strokeWidth={1}
          strokeDasharray="2 3"
          opacity={0.45}
        />
      )}
      <path d={path.d} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* CSV export                                                          */
/* ------------------------------------------------------------------ */

export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/* Subject trend chart (overall area + per-subject lines)              */
/* ------------------------------------------------------------------ */

const SUBJECT_COLORS = ["#10b981", "#f59e0b", "#84cc16", "#f97316", "#14b8a6", "#a8a29e", "#ef4444"];

export function TrendSection({
  history,
  subjects,
  target,
}: {
  history: HistoryResponse | undefined;
  subjects: SubjectView[];
  target: number;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [rangeDays, setRangeDays] = useState(14);

  useEffect(() => {
    if (subjects.length > 0) {
      setSelected((prev) => {
        const codes = subjects.map((s) => s.code);
        const next = prev.filter((c) => codes.includes(c));
        return next.length > 0 ? next.slice(0, 3) : codes.slice(0, 2);
      });
    }
  }, [subjects]);

  const chartRows = useMemo(() => {
    if (!history) return [];
    const cutoff = Date.now() - rangeDays * 24 * 3600 * 1000;
    const overallFiltered = history.overall.filter((p) => new Date(p.t).getTime() >= cutoff);
    const timeSet = new Set<string>();
    overallFiltered.forEach((p) => timeSet.add(p.t));
    selected.forEach((code) => {
      (history.subjects[code] ?? []).forEach((p) => {
        if (new Date(p.t).getTime() >= cutoff) timeSet.add(p.t);
      });
    });
    const times = [...timeSet].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    const overallByT = new Map(overallFiltered.map((p) => [p.t, p]));
    const subjectByT = new Map<string, Map<string, HistoryPoint>>();
    selected.forEach((code) => {
      subjectByT.set(code, new Map((history.subjects[code] ?? []).map((p) => [p.t, p])));
    });
    let prevDay = "";
    return times.map((t) => {
      const d = new Date(t);
      const dayKey = format(d, "yyyy-MM-dd");
      // first point of a day shows the date; later points the same day show the time
      const label = dayKey === prevDay ? format(d, "HH:mm") : format(d, "d MMM");
      prevDay = dayKey;
      const row: Record<string, number | string | null> = {
        t,
        label,
        overall: overallByT.get(t)?.percentage ?? null,
      };
      selected.forEach((code) => {
        row[code] = subjectByT.get(code)?.get(t)?.percentage ?? null;
      });
      return row;
    });
  }, [history, selected, rangeDays]);

  if (!history) return null;
  if (history.overall.length < 2) {
    return (
      <Card className="rounded-xl border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base tracking-tight">
            <Activity className="size-4 text-emerald-500" aria-hidden="true" />
            Attendance trend
          </CardTitle>
          <CardDescription className="text-xs">
            A trend line appears automatically once a second sync snapshot has been recorded.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const colorFor = (code: string) => SUBJECT_COLORS[subjects.findIndex((s) => s.code === code) % SUBJECT_COLORS.length];
  const first = history.overall[0]?.percentage ?? 0;
  const last = history.overall[history.overall.length - 1]?.percentage ?? 0;
  const delta = last - first;

  // When exactly one subject is selected, the reference line reflects THAT
  // subject's effective target (global or custom) instead of the global one.
  const singleSubject = selected.length === 1 ? subjects.find((s) => s.code === selected[0]) ?? null : null;
  const targetLine = singleSubject ? singleSubject.targetPct : target;
  const targetLabel = singleSubject ? `${singleSubject.code} target ${singleSubject.targetPct}%` : `target ${target}%`;
  const targetIsCustom = singleSubject ? singleSubject.hasCustomTarget : false;

  return (
    <Card className="overflow-hidden rounded-xl border-border/60">
      <CardHeader className="flex flex-col gap-3 pb-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base tracking-tight">
            <Activity className="size-4 text-emerald-500" aria-hidden="true" />
            Attendance trend
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                delta >= 0 ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400"
              )}
            >
              {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(2)} pts
            </span>
          </CardTitle>
          <CardDescription className="text-xs">
            Overall {last.toFixed(2)}% · {singleSubject ? `${singleSubject.code} target ${singleSubject.targetPct}%${singleSubject.hasCustomTarget ? " (custom)" : ""}` : `target ${target}%`} · from sync snapshots
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setRangeDays(d)}
              className={cn(
                "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                rangeDays === d
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border/60 text-muted-foreground hover:bg-muted/60"
              )}
              aria-pressed={rangeDays === d}
            >
              {d}d
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setSelected((prev) => (prev.length === subjects.length ? [] : subjects.map((s) => s.code)))}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
              selected.length === subjects.length
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "border-border/60 text-muted-foreground hover:bg-muted/60"
            )}
          >
            All subjects
          </button>
          {subjects.map((s) => {
            const active = selected.includes(s.code);
            return (
              <button
                key={s.code}
                type="button"
                onClick={() =>
                  setSelected((prev) => (prev.includes(s.code) ? prev.filter((c) => c !== s.code) : [...prev, s.code]))
                }
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  active ? "border-border bg-muted/70" : "border-border/50 text-muted-foreground hover:bg-muted/40"
                )}
                aria-pressed={active}
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: active ? colorFor(s.code) : "var(--muted-foreground)" }}
                  aria-hidden="true"
                />
                {s.code}
              </button>
            );
          })}
        </div>

        <div className="h-56 w-full sm:h-64">
          <ResponsiveContainer width="100%" height="100%">
            {selected.length === 0 ? (
              <AreaChart data={chartRows} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="overallFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <ReferenceLine
                  y={targetLine}
                  stroke={targetIsCustom ? "#f59e0b" : "var(--muted-foreground)"}
                  strokeDasharray="5 5"
                  strokeOpacity={targetIsCustom ? 0.8 : 0.55}
                  label={{
                    value: targetLabel,
                    position: "insideTopRight",
                    fontSize: 10,
                    fill: targetIsCustom ? "#f59e0b" : "var(--muted-foreground)",
                  }}
                />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} domain={["auto", "auto"]} unit="%" width={52} tickCount={5} />
                <Tooltip
                  formatter={(v: number | string) => [`${Number(v).toFixed(2)}%`, "Overall"]}
                  labelStyle={{ fontSize: 12 }}
                  contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", background: "var(--card)", fontSize: 12 }}
                />
                <Area
                  type="monotone"
                  dataKey="overall"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  fill="url(#overallFill)"
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls
                />
              </AreaChart>
            ) : (
              <LineChart data={chartRows} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <ReferenceLine
                  y={targetLine}
                  stroke={targetIsCustom ? "#f59e0b" : "var(--muted-foreground)"}
                  strokeDasharray="5 5"
                  strokeOpacity={targetIsCustom ? 0.8 : 0.55}
                  label={{
                    value: targetLabel,
                    position: "insideTopRight",
                    fontSize: 10,
                    fill: targetIsCustom ? "#f59e0b" : "var(--muted-foreground)",
                  }}
                />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} domain={["auto", "auto"]} unit="%" width={52} tickCount={5} />
                <Tooltip
                  formatter={(v: number | string, name: string) => [`${Number(v).toFixed(2)}%`, name === "overall" ? "Overall" : name]}
                  labelStyle={{ fontSize: 12 }}
                  contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", background: "var(--card)", fontSize: 12 }}
                />
                <Line type="monotone" dataKey="overall" stroke="#10b981" strokeWidth={3} dot={false} activeDot={{ r: 4 }} connectNulls />
                {selected.map((code) => (
                  <Line
                    key={code}
                    type="monotone"
                    dataKey={code}
                    stroke={colorFor(code)}
                    strokeWidth={1.8}
                    dot={false}
                    connectNulls
                    strokeDasharray="5 3"
                  />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Export buttons                                                      */
/* ------------------------------------------------------------------ */

export function ExportAttendanceButton({ subjects }: { subjects: SubjectView[] }) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 w-full gap-1.5 text-xs sm:w-auto"
      onClick={() =>
        downloadCsv(
          `attendance-${format(new Date(), "yyyy-MM-dd")}.csv`,
          ["Code", "Subject", "Present", "Total", "Absent", "Percentage", "Status", "Target %", "Classes needed", "Can miss"],
          subjects.map((s) => [
            s.code,
            s.name,
            s.present,
            s.total,
            s.absent,
            s.percentage.toFixed(2),
            s.status,
            s.targetPct,
            s.classesToTarget,
            s.canSkip,
          ])
        )
      }
    >
      <Download className="size-3.5" aria-hidden="true" />
      Export CSV
    </Button>
  );
}
