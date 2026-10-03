"use client";

import { useMemo, useState } from "react";
import { CalendarClock, Download, Flame, Gauge, Rocket, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { downloadCsv, AnimatedNumber } from "./trend-chart";
import { statusColors } from "./shared";
import type { AttendanceView, HistoryPoint, HistoryResponse, SubjectView } from "./types";

/*
 * Recovery pace & ETA — derived purely from sync-snapshot history.
 *
 * The ERP tells us WHEN a class was held only indirectly: each sync snapshot
 * records cumulative (present, total). Deltas between consecutive snapshots
 * inside the last 14 days approximate "classes held / attended" in that
 * window, which yields the student's real pace (classes per week). Combining
 * pace with the server-computed classesToTarget gives a data-driven recovery
 * date — no manual config, no timetable dependency.
 */

const WINDOW_DAYS = 14;

interface Pace {
  attended: number;
  held: number;
  /** Held classes per week over the observation window. */
  perWeek: number;
  /** Snapshot deltas actually seen (history length ≥ 2). */
  hasData: boolean;
}

function paceFromPoints(points: HistoryPoint[], now: number): Pace {
  if (!points || points.length < 2) return { attended: 0, held: 0, perWeek: 0, hasData: false };
  const sorted = [...points].sort((a, b) => +new Date(a.t) - +new Date(b.t));
  const windowStart = now - WINDOW_DAYS * 86_400_000;

  let attended = 0;
  let held = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const tCur = +new Date(cur.t);
    if (tCur < windowStart) continue; // delta fully outside the window
    attended += Math.max(0, cur.present - prev.present);
    held += Math.max(0, cur.total - prev.total);
  }
  return { attended, held, perWeek: (held * 7) / WINDOW_DAYS, hasData: true };
}

function fmtShortDate(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(ms));
}

/**
 * Perfect-day streak over the FULL snapshot history: a day counts when every
 * class the ERP recorded that day was attended (held > 0, attended === held).
 * The streak walks backwards from the most recent day that had classes, so a
 * clean yesterday still counts even if today's classes haven't happened yet.
 */
function dayStreak(points: HistoryPoint[]): { streak: number; perfectDays: number; hasClasses: boolean } {
  if (!points || points.length < 2) return { streak: 0, perfectDays: 0, hasClasses: false };
  const sorted = [...points].sort((a, b) => +new Date(a.t) - +new Date(b.t));
  const perDay = new Map<string, { attended: number; held: number }>();
  for (let i = 1; i < sorted.length; i++) {
    const day = new Date(sorted[i].t).toDateString(); // device-local day bucket
    const attended = Math.max(0, sorted[i].present - sorted[i - 1].present);
    const held = Math.max(0, sorted[i].total - sorted[i - 1].total);
    if (held > 0) {
      const cur = perDay.get(day) ?? { attended: 0, held: 0 };
      cur.attended += attended;
      cur.held += held;
      perDay.set(day, cur);
    }
  }
  const days = [...perDay.entries()].sort((a, b) => +new Date(a[0]) - +new Date(b[0]));
  if (days.length === 0) return { streak: 0, perfectDays: 0, hasClasses: false };
  const perfectDays = days.filter(([, v]) => v.attended === v.held).length;
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const [, v] = days[i];
    if (v.attended === v.held) streak++;
    else break;
  }
  return { streak, perfectDays, hasClasses: true };
}

function fmtWeeks(weeks: number): string {
  if (weeks < 1) return "under a week";
  if (weeks < 9) return `≈ ${weeks.toFixed(1)} ${weeks === 1 ? "week" : "weeks"}`;
  return `≈ ${Math.round(weeks)} weeks`;
}

/** One worst-first subject row: classes-to-go + its own pace-derived ETA. */
function SubjectRecoveryRow({ s, history }: { s: SubjectView; history: HistoryResponse }) {
  const c = statusColors(s.status);
  const pace = paceFromPoints(history.subjects[s.code] ?? [], Date.now());
  const weeks = pace.perWeek > 0 ? s.classesToTarget / pace.perWeek : null;
  return (
    <li className="flex min-w-0 items-center gap-2 text-xs">
      <span className={cn("size-1.5 shrink-0 rounded-full", c.bar)} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-foreground/90" title={s.name}>
        {s.name}
      </span>
      <span className={cn("shrink-0 rounded px-1.5 py-0.5 font-semibold tabular-nums", c.bg, c.text)}>
        {s.classesToTarget} to go
      </span>
      {weeks !== null ? (
        <span
          className="w-24 shrink-0 text-right text-muted-foreground tabular-nums"
          title={`${s.name}: attending every scheduled class at ${pace.perWeek.toFixed(1)} classes/week`}
        >
          ~{fmtShortDate(Date.now() + weeks * 7 * 86_400_000)}
        </span>
      ) : (
        <span className="w-24 shrink-0 text-right text-muted-foreground/60">no pace yet</span>
      )}
    </li>
  );
}

export function RecoveryPlan({
  overall,
  subjects,
  target,
  history,
}: {
  overall: AttendanceView;
  subjects: SubjectView[];
  target: number;
  history: HistoryResponse | undefined;
}) {
  const [exported, setExported] = useState(false);

  const pace = useMemo(
    () => (history ? paceFromPoints(history.overall, Date.now()) : { attended: 0, held: 0, perWeek: 0, hasData: false }),
    [history]
  );
  const streakInfo = useMemo(
    () => (history ? dayStreak(history.overall) : { streak: 0, perfectDays: 0, hasClasses: false }),
    [history]
  );

  const recovering = overall.classesToTarget > 0;
  const c = statusColors(recovering ? overall.status : "safe");

  const weeksToTarget = recovering && pace.perWeek > 0 ? overall.classesToTarget / pace.perWeek : null;
  const cushionWeeks = !recovering && pace.perWeek > 0 ? overall.canSkip / pace.perWeek : null;

  const exportHistory = () => {
    if (!history) return;
    const rows = [...history.overall]
      .sort((a, b) => +new Date(a.t) - +new Date(b.t))
      .map((p) => [p.t, p.present, p.total, p.percentage.toFixed(2)]);
    downloadCsv("attendance-history.csv", ["snapshot_at", "present", "total", "percentage"], rows);
    setExported(true);
    window.setTimeout(() => setExported(false), 2000);
  };

  const busy = subjects.filter((s) => s.status !== "safe" && s.classesToTarget > 0).slice(0, 5);

  return (
    <Card className="rounded-xl border-border/60">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base tracking-tight">
              {recovering ? (
                <Rocket className="size-4 text-amber-500" aria-hidden="true" />
              ) : (
                <ShieldCheck className="size-4 text-emerald-500" aria-hidden="true" />
              )}
              Recovery pace
            </CardTitle>
            <CardDescription className="mt-0.5">
              Measured from the last {WINDOW_DAYS} days of sync snapshots — updates as the ERP records new classes
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs text-muted-foreground"
            onClick={exportHistory}
            disabled={!history || history.overall.length === 0}
            aria-label="Download full attendance snapshot history as CSV"
          >
            <Download className="size-3.5" aria-hidden="true" />
            {exported ? "Downloaded" : "History CSV"}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* 14-day measured pace */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-muted px-2 py-2">
            <p className="text-base font-semibold tabular-nums">
              <AnimatedNumber value={pace.attended} decimals={0} />
            </p>
            <p className="text-[11px] text-muted-foreground">Attended · 14d</p>
          </div>
          <div className="rounded-lg bg-muted px-2 py-2">
            <p className="text-base font-semibold tabular-nums">
              <AnimatedNumber value={pace.held} decimals={0} />
            </p>
            <p className="text-[11px] text-muted-foreground">Held · 14d</p>
          </div>
          <div className="rounded-lg bg-muted px-2 py-2">
            <p className="text-base font-semibold tabular-nums">{pace.perWeek.toFixed(1)}</p>
            <p className="text-[11px] text-muted-foreground">Classes / week</p>
          </div>
        </div>

        {/* Perfect-day streak (motivation) */}
        {streakInfo.hasClasses && (
          <div
            className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs"
            title="A perfect day = every class the ERP recorded that day was attended"
          >
            <Flame className="size-3.5 shrink-0 text-orange-500" aria-hidden="true" />
            <span>
              <b className="tabular-nums">{streakInfo.streak}</b> perfect {streakInfo.streak === 1 ? "day" : "days"} in a
              row
            </span>
            <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
              {streakInfo.perfectDays} perfect {streakInfo.perfectDays === 1 ? "day" : "days"} all-time
            </span>
          </div>
        )}

        {pace.held === 0 ? (
          <p className="rounded-lg border border-dashed border-border/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            {pace.hasData
              ? "No classes were recorded in the last 14 days (vacation, or the ERP hasn't published new attendance). The pace-based recovery date appears automatically once classes resume."
              : "Not enough sync snapshots yet to measure your pace — keep the app syncing and this plan fills in on its own."}
          </p>
        ) : recovering ? (
          <div className={cn("rounded-lg border p-3", c.border, c.bg)}>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <CalendarClock className={cn("size-4 self-center", c.text)} aria-hidden="true" />
              <p className={cn("text-sm font-semibold", c.text)}>
                Attend every class → back at {target}% around{" "}
                <span className="tabular-nums">
                  {fmtShortDate(Date.now() + (weeksToTarget ?? 0) * 7 * 86_400_000)}
                </span>
              </p>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              <b className="tabular-nums text-foreground">{overall.classesToTarget}</b> more attended{" "}
              {overall.classesToTarget === 1 ? "class" : "classes"} needed · {fmtWeeks(weeksToTarget ?? 0)} at your{" "}
              {pace.perWeek.toFixed(1)}-classes/week pace. Each miss pushes the date out.
            </p>
          </div>
        ) : (
          <div className={cn("rounded-lg border p-3", c.border, c.bg)}>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <Gauge className={cn("size-4 self-center", c.text)} aria-hidden="true" />
              <p className={cn("text-sm font-semibold", c.text)}>
                Cushion: you can miss up to{" "}
                <span className="tabular-nums">{overall.canSkip}</span>{" "}
                {overall.canSkip === 1 ? "class" : "classes"} and stay above {target}%
              </p>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              That is {fmtWeeks(cushionWeeks ?? 0)} of buffer at your current {pace.perWeek.toFixed(1)}-classes/week
              pace — spend it wisely.
            </p>
          </div>
        )}

        {/* Worst subjects first, each with its own pace-derived ETA */}
        {busy.length > 0 && pace.held > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Subject recovery dates
            </p>
            <ul className="space-y-1">
              {busy.map((s) => (
                <SubjectRecoveryRow key={s.id} s={s} history={history!} />
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
