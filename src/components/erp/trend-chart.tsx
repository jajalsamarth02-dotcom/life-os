"use client";

import React, { useEffect, useMemo, useState } from "react";
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
import { Activity, Archive, CalendarCheck, Download, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { downloadTextFile } from "./download";
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
  /* r103: the anchor-click dance retired — the shared downloadTextFile is
     the ONE download path (byte-identical file, written once). */
  downloadTextFile(csv, filename, "text/csv");
}

/* ------------------------------------------------------------------ */
/* Subject trend chart (overall area + per-subject lines)              */
/* ------------------------------------------------------------------ */

const SUBJECT_COLORS = ["#10b981", "#f59e0b", "#84cc16", "#f97316", "#14b8a6", "#a8a29e", "#ef4444"];

/* r114 — the archive switch: a pressed-state pill, not a hidden toggle.
   Present in EVERY TrendSection state (loading, sparse, full) so the way
   back to the current term is always one tap away. */
function ArchiveSwitch({
  archive,
  className,
}: {
  archive: { on: boolean; onToggle: () => void };
  className?: string;
}) {
  const on = archive.on;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={archive.onToggle}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on
          ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
          : "border-border/60 text-muted-foreground hover:bg-muted/60",
        className
      )}
      title={
        on
          ? "Viewing the archived (pre-rollover) record — tap to return to the current term"
          : "Open the archived record of the subjects removed at the term rollover"
      }
    >
      <Archive className="size-3.5" aria-hidden="true" />
      {on ? "Back to current" : "Archive"}
    </button>
  );
}

export function TrendSection({
  history,
  subjects,
  target,
  focusDay = null,
  onFocusDay,
  archive,
}: {
  history: HistoryResponse | undefined;
  subjects: SubjectView[];
  target: number;
  /** Day key (yyyy-MM-dd) focused from outside — e.g. a heatmap cell click. */
  focusDay?: string | null;
  /** Click a chart point to focus that day (cross-links with the heatmap). */
  onFocusDay?: (key: string | null) => void;
  /** r114 — the archive shelf: read-only pre-rollover record. */
  archive?: {
    on: boolean;
    available: boolean;
    subtitle: string | null;
    onToggle: () => void;
  };
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [rangeDays, setRangeDays] = useState(14);
  const archiveOn = archive?.on ?? false;

  /* Scope flips reset the window: the archive spans a finished term, so it
     opens at "All"; the live trend returns to the 14-day habit. */
  useEffect(() => {
    setRangeDays(archiveOn ? 3650 : 14);
  }, [archiveOn]);

  /* In archive mode the selectable series are the REMOVED subjects' codes
     (current SubjectView rows don't exist for them) — the pill row and the
     default selection both follow the active scope. */
  const availableCodes = useMemo(
    () => (archiveOn ? Object.keys(history?.subjects ?? {}) : subjects.map((s) => s.code)),
    [archiveOn, history, subjects]
  );

  useEffect(() => {
    if (availableCodes.length > 0) {
      setSelected((prev) => {
        const next = prev.filter((c) => availableCodes.includes(c));
        return next.length > 0 ? next.slice(0, 3) : availableCodes.slice(0, 2);
      });
    }
  }, [availableCodes]);

  const chartRows = useMemo(() => {
    if (!history) return [];
    const cutoff = rangeDays >= 3650 ? 0 : Date.now() - rangeDays * 24 * 3600 * 1000;
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
        dayKey,
        overall: overallByT.get(t)?.percentage ?? null,
      };
      selected.forEach((code) => {
        row[code] = subjectByT.get(code)?.get(t)?.percentage ?? null;
      });
      return row;
    });
  }, [history, selected, rangeDays]);

  if (!history) {
    /* Archive payload still loading — never a silent fall-back to current
       data (that would flash the wrong era); an honest pulse instead. */
    if (archiveOn) {
      return (
        <Card className="rounded-xl border-amber-500/25">
          <CardContent className="p-6">
            <div className="animate-pulse space-y-3">
              <div className="h-4 w-1/3 rounded bg-muted" />
              <div className="h-32 w-full rounded bg-muted" />
            </div>
            {archive?.available !== false && archive && (
              <ArchiveSwitch archive={archive} className="mt-3" />
            )}
          </CardContent>
        </Card>
      );
    }
    return null;
  }
  if (history.overall.length < 2) {
    return (
      <Card className={cn("rounded-xl", archiveOn ? "border-amber-500/25" : "border-border/60")}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base tracking-tight">
            {archiveOn ? (
              <Archive className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            ) : (
              <Activity className="size-4 text-emerald-500" aria-hidden="true" />
            )}
            {archiveOn ? "Archived term" : "Attendance trend"}
          </CardTitle>
          <CardDescription className="text-xs">
            {archiveOn
              ? "The archived record is too sparse for a trend line."
              : "A trend line appears automatically once a second sync snapshot has been recorded."}
          </CardDescription>
        </CardHeader>
        {archive?.available && <CardContent className="pb-4"><ArchiveSwitch archive={archive} /></CardContent>}
      </Card>
    );
  }

  const colorFor = (code: string) => {
    const idx = availableCodes.indexOf(code);
    return idx >= 0
      ? SUBJECT_COLORS[idx % SUBJECT_COLORS.length]
      : SUBJECT_COLORS[subjects.findIndex((s) => s.code === code) % SUBJECT_COLORS.length];
  };
  const first = history.overall[0]?.percentage ?? 0;
  const last = history.overall[history.overall.length - 1]?.percentage ?? 0;
  const delta = last - first;

  // When exactly one subject is selected, the reference line reflects THAT
  // subject's effective target (global or custom) instead of the global one.
  const singleSubject = selected.length === 1 ? subjects.find((s) => s.code === selected[0]) ?? null : null;
  const targetLine = singleSubject ? singleSubject.targetPct : target;
  const targetLabel = singleSubject ? `${singleSubject.code} target ${singleSubject.targetPct}%` : `target ${target}%`;
  const targetIsCustom = singleSubject ? singleSubject.hasCustomTarget : false;

  // Cross-link: clicking a chart point focuses that DAY in the heatmap and
  // vice versa. Dots appear only for the focused day's points.
  const chartClick = (state: unknown) => {
    if (!onFocusDay) return;
    const payload = (state as { activePayload?: Array<{ payload?: { dayKey?: string } }> })
      ?.activePayload?.[0]?.payload;
    if (payload?.dayKey) onFocusDay(focusDay === payload.dayKey ? null : payload.dayKey);
  };
  const focusDot = (p: {
    cx?: number;
    cy?: number;
    payload?: { dayKey?: string };
    key?: React.Key;
  }) => {
    if (p.cx == null || p.cy == null) return <g key={p.key} />;
    const focused = focusDay != null && p.payload?.dayKey === focusDay;
    if (!focused) return <g key={p.key} />;
    return (
      <g key={p.key}>
        <circle cx={p.cx} cy={p.cy} r={6.5} fill="#10b981" fillOpacity={0.22} />
        <circle
          cx={p.cx}
          cy={p.cy}
          r={3.4}
          fill="#10b981"
          stroke="var(--background)"
          strokeWidth={1.5}
        />
      </g>
    );
  };

  return (
    <Card className={cn("overflow-hidden rounded-xl", archiveOn ? "border-amber-500/25" : "border-border/60")}>
      <CardHeader className="flex flex-col gap-3 pb-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base tracking-tight">
            {archiveOn ? (
              <Archive className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            ) : (
              <Activity className="size-4 text-emerald-500" aria-hidden="true" />
            )}
            {archiveOn ? "Archived term" : "Attendance trend"}
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
            {archiveOn
              ? archive?.subtitle ?? "Removed subjects' recorded history, before the term rollover."
              : `Overall ${last.toFixed(2)}% · ${singleSubject ? `${singleSubject.code} target ${singleSubject.targetPct}%${singleSubject.hasCustomTarget ? " (custom)" : ""}` : `target ${target}%`} · from sync snapshots`}
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {archive?.available && <ArchiveSwitch archive={archive} />}
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
          {archiveOn && (
            <button
              type="button"
              onClick={() => setRangeDays(3650)}
              className={cn(
                "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                rangeDays >= 3650
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border/60 text-muted-foreground hover:bg-muted/60"
              )}
              aria-pressed={rangeDays >= 3650}
            >
              All
            </button>
          )}
          {focusDay != null && (
            <span className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
              <CalendarCheck className="size-3" aria-hidden="true" />
              {format(new Date(`${focusDay}T00:00:00`), "d MMM")}
              {onFocusDay && (
                <button
                  type="button"
                  onClick={() => onFocusDay(null)}
                  className="ml-0.5 rounded-sm text-primary/70 transition-colors hover:text-primary"
                  aria-label="Clear focused day"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              )}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() =>
              setSelected((prev) => (prev.length === availableCodes.length ? [] : [...availableCodes]))
            }
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
              selected.length === availableCodes.length
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "border-border/60 text-muted-foreground hover:bg-muted/60"
            )}
          >
            {archiveOn ? "All archived" : "All subjects"}
          </button>
          {availableCodes.map((code) => {
            const active = selected.includes(code);
            return (
              <button
                key={code}
                type="button"
                onClick={() =>
                  setSelected((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]))
                }
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  active ? "border-border bg-muted/70" : "border-border/50 text-muted-foreground hover:bg-muted/40"
                )}
                aria-pressed={active}
                title={
                  archiveOn
                    ? "Removed from the ERP at the term rollover — archived history"
                    : undefined
                }
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: active ? colorFor(code) : "var(--muted-foreground)" }}
                  aria-hidden="true"
                />
                {code}
              </button>
            );
          })}
        </div>

        <div className="h-56 w-full sm:h-64" style={{ cursor: onFocusDay ? "pointer" : undefined }}>
          <ResponsiveContainer width="100%" height="100%">
            {selected.length === 0 ? (
              <AreaChart data={chartRows} margin={{ top: 6, right: 8, left: -18, bottom: 0 }} onClick={chartClick}>
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
                  dot={onFocusDay ? focusDot : false}
                  activeDot={{ r: 4 }}
                  connectNulls
                />
              </AreaChart>
            ) : (
              <LineChart data={chartRows} margin={{ top: 6, right: 8, left: -18, bottom: 0 }} onClick={chartClick}>
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
                <Line type="monotone" dataKey="overall" stroke="#10b981" strokeWidth={3} dot={onFocusDay ? focusDot : false} activeDot={{ r: 4 }} connectNulls />
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
