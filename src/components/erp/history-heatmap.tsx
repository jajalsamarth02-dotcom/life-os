"use client";

import * as React from "react";
import { format, startOfWeek } from "date-fns";
import { CalendarDays } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { HistoryPoint } from "./types";

/**
 * GitHub-style heatmap of daily overall attendance built from sync-time
 * snapshots (last snapshot of each day wins). Weeks run Mon → Sun.
 */

const WEEKS = 12;
const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

interface DayCell {
  key: string; // yyyy-MM-dd
  date: Date;
  point: HistoryPoint | null;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function cellColor(pct: number, target: number): string {
  if (pct < target - 10) return "bg-red-500/85 hover:bg-red-500";
  if (pct < target) return "bg-amber-500/85 hover:bg-amber-500";
  if (pct < target + 5) return "bg-emerald-500/60 hover:bg-emerald-500/80";
  return "bg-emerald-500/90 hover:bg-emerald-500";
}

export function HistoryHeatmap({
  overall,
  target,
  focusKey = null,
  onSelectDay,
  anchorDate = null,
  archive = false,
}: {
  overall: HistoryPoint[];
  target: number;
  /** Day key (yyyy-MM-dd) highlighted from outside — e.g. a trend-chart click. */
  focusKey?: string | null;
  /** Click a day cell to select/deselect it (cross-links with the trend chart). */
  onSelectDay?: (key: string | null) => void;
  /** r114 — ISO day the grid ENDS at (the archive's last day); null = today. */
  anchorDate?: string | null;
  /** r114 — archived surface: amber-accented title, honest about its era. */
  archive?: boolean;
}) {
  const [hover, setHover] = React.useState<DayCell | null>(null);

  /* last snapshot per local day */
  const byDay = React.useMemo(() => {
    const map = new Map<string, HistoryPoint>();
    for (const p of overall) map.set(dayKey(new Date(p.t)), p); // points arrive ascending
    return map;
  }, [overall]);

  /* grid: weeks × 7 days, ending with the current week — or, in archive
     mode, ending at the archive's final week (a record of a finished era
     must not trail off into empty future cells). */
  const weeks = React.useMemo(() => {
    const anchor = anchorDate ? new Date(`${anchorDate}T00:00:00`) : new Date();
    const lastMonday = startOfWeek(anchor, { weekStartsOn: 1 });
    const cols: DayCell[][] = [];
    for (let w = WEEKS - 1; w >= 0; w--) {
      const colStart = new Date(lastMonday);
      colStart.setDate(colStart.getDate() - w * 7);
      const col: DayCell[] = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(colStart);
        date.setDate(date.getDate() + d);
        const key = dayKey(date);
        const point = date <= anchor ? (byDay.get(key) ?? null) : null;
        col.push({ key, date, point });
      }
      cols.push(col);
    }
    return cols;
  }, [byDay, anchorDate]);

  /* month labels: mark a column that CONTAINS the 1st of a new month
     (handles months that start mid-week, e.g. Oct 1 on a Wednesday) */
  const monthLabels = React.useMemo(() => {
    const labels: (string | null)[] = weeks.map(() => null);
    let lastLabeled = -1;
    weeks.forEach((col, i) => {
      const firstOfMonth = col.find((c) => c.date.getDate() === 1);
      if (firstOfMonth) {
        const m = firstOfMonth.date.getMonth();
        if (m !== lastLabeled) {
          labels[i] = format(firstOfMonth.date, "MMM");
          lastLabeled = m;
        }
      }
    });
    return labels;
  }, [weeks]);

  const daysWithData = weeks.flat().filter((c) => c.point).length;
  const latest = weeks.flat().filter((c) => c.point).at(-1)?.point ?? null;
  const focusedCell = weeks.flat().find((c) => c.key === focusKey && c.point) ?? null;
  const caption = hover?.point ?? focusedCell?.point ?? latest;

  return (
    <Card className={cn("rounded-xl", archive ? "border-amber-500/25" : "border-border/60")}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base tracking-tight">
          <CalendarDays className={cn("size-4", archive ? "text-amber-600 dark:text-amber-400" : "text-primary")} aria-hidden="true" />
          {archive && anchorDate
            ? `Archived attendance — ${WEEKS} weeks to ${format(new Date(`${anchorDate}T00:00:00`), "d MMM yyyy")}`
            : `Attendance history — last ${WEEKS} weeks`}
        </CardTitle>
        <CardDescription>
          {archive
            ? "Daily overall attendance from the archived term's sync snapshots (read-only)"
            : "Daily overall attendance from every sync snapshot"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {daysWithData === 0 ? (
          <p className="rounded-lg border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
            No history yet — the calendar fills in as the ERP is synchronized. In live mode history accrues honestly,
            one sync at a time.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto pb-1">
              <div className="inline-flex min-w-0 flex-col gap-1">
                {/* month labels */}
                <div className="flex gap-1 ps-8">
                  {monthLabels.map((m, i) => (
                    <div key={i} className="relative h-3 w-3.5">
                      {m && i > 0 && (
                        <span className="absolute left-0 top-0 whitespace-nowrap text-[9px] font-medium leading-none text-muted-foreground">
                          {m}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex gap-1">
                  {/* day-of-week labels */}
                  <div className="flex w-7 shrink-0 flex-col gap-1" aria-hidden="true">
                    {DAY_LABELS.map((d, i) => (
                      <div key={i} className="flex h-3.5 items-center text-[9px] leading-none text-muted-foreground">
                        {d}
                      </div>
                    ))}
                  </div>
                  {/* cells */}
                  <div className="flex gap-1" role="img" aria-label={`Attendance calendar for the last ${WEEKS} weeks`}>
                    {weeks.map((col, wi) => (
                      <div key={wi} className="flex flex-col gap-1">
                        {col.map((cell) => {
                          const pct = cell.point?.percentage ?? null;
                          const future = cell.date > (anchorDate ? new Date(`${anchorDate}T23:59:59`) : new Date());
                          const focused = focusKey != null && cell.key === focusKey;
                          const clickable =
                            onSelectDay != null && cell.point != null && !future;
                          return (
                            <div
                              key={cell.key}
                              title={
                                cell.point
                                  ? `${format(cell.date, "d MMM yyyy")} — ${pct!.toFixed(2)}% (${cell.point.present}/${cell.point.total} classes)${clickable ? " — click to focus" : ""}`
                                  : `${format(cell.date, "d MMM yyyy")} — no data`
                              }
                              onMouseEnter={() => setHover(cell)}
                              onMouseLeave={() => setHover(null)}
                              onClick={clickable ? () => onSelectDay!(focusKey === cell.key ? null : cell.key) : undefined}
                              style={{ animationDelay: `${wi * 24}ms` }}
                              aria-label={
                                cell.point
                                  ? `${format(cell.date, "d MMM yyyy")} attendance ${pct!.toFixed(2)}%${focused ? " (focused)" : ""}`
                                  : undefined
                              }
                              className={cn(
                                "erp-heat-cell size-3.5 rounded-[3px] transition-all",
                                future
                                  ? "bg-transparent"
                                  : cell.point
                                    ? cellColor(pct!, target)
                                    : "bg-muted hover:bg-muted/70",
                                clickable && "cursor-pointer",
                                focused &&
                                  "z-10 scale-[1.35] ring-2 ring-primary ring-offset-1 ring-offset-background"
                              )}
                            />
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* caption + legend */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-h-4 flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums" aria-live="polite">
                {focusedCell && !hover && (
                  <span className="inline-flex size-1.5 rounded-full bg-primary" aria-hidden="true" />
                )}
                {caption
                  ? `${format(new Date(caption.t), "EEE d MMM")} — ${caption.percentage.toFixed(2)}% (${caption.present}/${caption.total} classes)`
                  : "Hover a day for details"}
                {focusedCell && !hover && (
                  <button
                    type="button"
                    onClick={() => onSelectDay?.(null)}
                    className="ml-1 rounded px-1 text-[10px] font-medium text-primary underline-offset-2 hover:underline"
                  >
                    clear
                  </button>
                )}
              </p>
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="tabular-nums">target {target}%</span>
                <span>less</span>
                <span className="size-3 rounded-[3px] bg-red-500/85" aria-hidden="true" />
                <span className="size-3 rounded-[3px] bg-amber-500/85" aria-hidden="true" />
                <span className="size-3 rounded-[3px] bg-emerald-500/60" aria-hidden="true" />
                <span className="size-3 rounded-[3px] bg-emerald-500/90" aria-hidden="true" />
                <span>more</span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
