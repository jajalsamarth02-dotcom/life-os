"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { isToday } from "date-fns";
import {
  AlertTriangle,
  ArrowRight,
  ArrowDownUp,
  BellRing,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  FlaskConical,
  CalendarRange,
  Hourglass,
  Info,
  Layers,
  WifiOff,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { fetchDashboard, fetchHistory, qk } from "./api";
import { WeeklyDigestDialog } from "./digest-dialog";
import { SubjectDrawer } from "./subject-drawer";
import { TimetableCard } from "./timetable-card";
import {
  ago,
  dueGroup,
  EmptyHero,
  fmtDT,
  CustomTargetChip,
  KindIcon,
  MiniBar,
  ProgressRing,
  SourceBadge,
  statusColors,
  StatCard,
  StatusChip,
  TypeIcon,
  useNow,
} from "./shared";
import type { ChangeEvent, Reminder, SubjectView } from "./types";

/* ------------------------------------------------------------------ */

const SUBJECT_SORTS = [
  { key: "lowest", label: "Lowest attendance first" },
  { key: "highest", label: "Highest attendance first" },
  { key: "name", label: "Name A–Z" },
  { key: "recent", label: "Recently updated" },
] as const;

type SubjectSort = (typeof SUBJECT_SORTS)[number]["key"];

function sortSubjects(list: SubjectView[], sort: SubjectSort): SubjectView[] {
  const copy = [...list];
  switch (sort) {
    case "lowest":
      return copy.sort((a, b) => a.percentage - b.percentage);
    case "highest":
      return copy.sort((a, b) => b.percentage - a.percentage);
    case "name":
      return copy.sort((a, b) => a.name.localeCompare(b.name));
    case "recent":
      return copy.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }
}

/** Live countdown label for the next upcoming deadline. */
function countdownLabel(dueAt: string, now: number): string {
  const diff = new Date(dueAt).getTime() - now;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  let span: string;
  if (mins < 60) span = `${mins} min`;
  else if (hours < 36) span = `${hours} hr${hours === 1 ? "" : "s"}`;
  else span = `${days} day${days === 1 ? "" : "s"}`;
  return diff >= 0 ? `in ${span}` : `${span} overdue`;
}

function NextUpStrip({ items }: { items: Reminder[] }) {
  const now = useNow();
  const upcoming = items
    .filter((r) => r.status === "ACTIVE" && r.type !== "ATTENDANCE_WARNING")
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  const overdue = upcoming.filter((r) => new Date(r.dueAt).getTime() < now);
  const next = upcoming.find((r) => new Date(r.dueAt).getTime() >= now);

  if (upcoming.length === 0) return null;
  const shown = overdue.length > 0 ? overdue[0] : (next ?? upcoming[0]);
  const isOverdue = new Date(shown.dueAt).getTime() < now;

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border px-4 py-3",
        isOverdue ? "border-red-500/30 bg-red-500/[0.05]" : "border-primary/25 bg-primary/[0.04]"
      )}
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          isOverdue ? "bg-red-500/10 text-red-600 dark:text-red-400" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        )}
      >
        <Hourglass className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Next up {overdue.length > 0 && <span className="text-red-500">· {overdue.length} overdue</span>}
        </p>
        <p className="truncate text-sm font-medium">{shown.title}</p>
      </div>
      <div className="shrink-0 text-right">
        <p
          className={cn(
            "text-sm font-bold tabular-nums",
            isOverdue ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
          )}
        >
          {countdownLabel(shown.dueAt, now)}
        </p>
        <p className="text-[11px] text-muted-foreground">{fmtDT(shown.dueAt)}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function DueBadge({ iso, now }: { iso: string; now: number }) {
  const d = new Date(iso);
  if (d.getTime() < now && !isToday(d)) {
    return <span className="text-xs font-medium text-red-600 dark:text-red-400">{fmtDT(iso)} · overdue</span>;
  }
  return <span className="text-xs text-muted-foreground">{fmtDT(iso)}</span>;
}

function ReminderPreviewRow({ r, now }: { r: Reminder; now: number }) {
  return (
    <li className="flex items-start gap-2.5 rounded-lg border border-border/50 p-2.5 transition-colors hover:bg-muted/50">
      <TypeIcon type={r.type} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{r.title}</p>
          <SourceBadge source={r.source} />
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <DueBadge iso={r.dueAt} now={now} />
        </div>
      </div>
    </li>
  );
}

function RemindersPreview({
  items,
  todayCount,
  weekCount,
}: {
  items: Reminder[];
  todayCount: number;
  weekCount: number;
}) {
  const now = useNow();
  const groups: { key: string; label: string; className: string; items: Reminder[] }[] = [
    { key: "overdue", label: "Overdue", className: "text-red-600 dark:text-red-400", items: [] },
    { key: "today", label: "Today", className: "text-emerald-600 dark:text-emerald-400", items: [] },
    { key: "tomorrow", label: "Tomorrow", className: "", items: [] },
    { key: "week", label: "This week", className: "", items: [] },
    { key: "later", label: "Later", className: "", items: [] },
  ];
  for (const r of items) {
    const g = dueGroup(r.dueAt, r.status, now);
    const bucket = groups.find((x) => x.key === g);
    if (bucket) bucket.items.push(r);
  }
  const visible = groups.filter((g) => g.items.length > 0);

  return (
    <Card className="rounded-xl border-border/60">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base tracking-tight">Reminders</CardTitle>
          <CardDescription className="text-xs">Next deadlines from the ERP and your own list</CardDescription>
        </div>
        <div className="flex gap-1.5">
          <Badge variant="secondary" className="tabular-nums">{todayCount} today</Badge>
          <Badge variant="secondary" className="tabular-nums">{weekCount} this week</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No active reminders</p>
        ) : (
          <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
            {visible.map((g) => (
              <div key={g.key}>
                <p className={cn("mb-1.5 text-xs font-semibold uppercase tracking-wide", g.className)}>{g.label}</p>
                <ul className="space-y-1.5">
                  {g.items.slice(0, 5).map((r) => (
                    <ReminderPreviewRow key={r.id} r={r} now={now} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function ErpStatusCard({
  connected,
  demoMode,
  username,
  sync,
}: {
  connected: boolean;
  demoMode: boolean;
  username: string | null;
  sync: {
    status: string;
    lastSyncAt: string | null;
    lastSuccessAt: string | null;
    nextScheduledSyncAt: string | null;
    consecutiveFailures: number;
  };
}) {
  const now = useNow();
  return (
    <Card className="rounded-xl border-border/60">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base tracking-tight">ERP connection</CardTitle>
          <CardDescription className="text-xs">erp.gmiu.edu.in · read-only source of truth</CardDescription>
        </div>
        {connected ? (
          <CheckCircle2 className="size-5 text-emerald-500" aria-hidden="true" />
        ) : demoMode ? (
          <FlaskConical className="size-5 text-amber-500" aria-hidden="true" />
        ) : (
          <WifiOff className="size-5 text-muted-foreground" aria-hidden="true" />
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-lg font-semibold tracking-tight">
          {connected ? (
            <span className="text-emerald-600 dark:text-emerald-400">
              ✓ Connected{username ? ` · ${username}` : ""}
            </span>
          ) : demoMode ? (
            <span className="text-amber-600 dark:text-amber-400">Demo ERP simulator</span>
          ) : (
            <span className="text-muted-foreground">Not connected</span>
          )}
        </p>
        <Separator />
        <dl className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Last synced</dt>
            <dd className="font-medium" title={fmtDT(sync.lastSyncAt)}>{ago(sync.lastSyncAt, now)}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Next scheduled sync</dt>
            <dd className="font-medium">{sync.nextScheduledSyncAt ? fmtDT(sync.nextScheduledSyncAt) : "—"}</dd>
          </div>
          {sync.consecutiveFailures > 0 && (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-amber-700 dark:text-amber-400">
              <dt className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="size-3.5" aria-hidden="true" /> Consecutive failures
              </dt>
              <dd className="font-semibold tabular-nums">{sync.consecutiveFailures}</dd>
            </div>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function ChangeRow({ c }: { c: ChangeEvent }) {
  const now = useNow();
  return (
    <li className="flex items-start gap-2.5 rounded-lg border border-border/50 p-2.5 transition-colors hover:bg-muted/50">
      <KindIcon kind={c.kind} />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">{c.detail}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {c.subjectCode && (
            <Badge variant="outline" className="px-1.5 py-0 font-mono text-[10px]">
              {c.subjectCode}
            </Badge>
          )}
          {ago(c.createdAt, now)}
        </p>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */

function SubjectRow({ s, onOpen, shimmer }: { s: SubjectView; onOpen: () => void; shimmer: boolean }) {
  const c = statusColors(s.status);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-lg border border-border/50 p-3 text-left transition-all hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Open attendance details for ${s.name}`}
    >
      <span className={cn("hidden shrink-0 rounded-md px-2 py-1 font-mono text-[11px] font-semibold sm:block", c.bg, c.text)}>
        {s.code}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-medium">{s.name}</p>
          <span className={cn("shrink-0 text-sm font-bold tabular-nums", c.text)}>{s.percentage.toFixed(2)}%</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <MiniBar percentage={s.percentage} status={s.status} className="flex-1" shimmer={shimmer} />
          {s.status !== "safe" && s.classesToTarget > 0 ? (
            <span className="shrink-0 text-[11px] font-medium text-amber-600 dark:text-amber-400">
              ⚠ needs {s.classesToTarget} more {s.classesToTarget === 1 ? "class" : "classes"}
            </span>
          ) : (
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
              {s.present}/{s.total}
            </span>
          )}
          {s.hasCustomTarget && <CustomTargetChip target={s.targetPct} className="shrink-0" />}
        </div>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
    </button>
  );
}

/* ------------------------------------------------------------------ */

function NotificationRow({
  n,
}: {
  n: { id: string; title: string; message: string; severity: string; createdAt: string; read: boolean };
}) {
  const now = useNow();
  const Icon =
    n.severity === "critical"
      ? XCircle
      : n.severity === "warning"
        ? AlertTriangle
        : n.severity === "success"
          ? CheckCircle2
          : Info;
  const cls =
    n.severity === "critical"
      ? "text-red-600 dark:text-red-400 bg-red-500/10"
      : n.severity === "warning"
        ? "text-amber-600 dark:text-amber-400 bg-amber-500/10"
        : n.severity === "success"
          ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
          : "text-muted-foreground bg-muted";
  return (
    <li className="flex items-start gap-2.5 rounded-lg p-2 transition-colors hover:bg-muted/50">
      <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md", cls)}>
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug">{n.title}</p>
        <p className="line-clamp-2 text-xs text-muted-foreground">{n.message}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground/80">{ago(n.createdAt, now)}</p>
      </div>
      {!n.read && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-label="unread" />}
    </li>
  );
}

/* ------------------------------------------------------------------ */

function CardSkeletonLight({ className }: { className?: string }) {
  return (
    <Card className={cn("rounded-xl border-border/60", className)}>
      <CardContent className="p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-1/3 rounded bg-muted" />
          <div className="h-3 w-2/3 rounded bg-muted" />
          <div className="h-20 w-full rounded bg-muted" />
        </div>
      </CardContent>
    </Card>
  );
}

export function DashboardTab({
  onOpenAttendance,
  onOpenSettings,
}: {
  onOpenAttendance: () => void;
  onOpenSettings: () => void;
}) {
  const [sort, setSort] = useState<SubjectSort>("lowest");
  /* Store the CODE (not the object) and derive the view from fresh query data,
     so the drawer reflects updated targets/percentages after refetches. */
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [digestOpen, setDigestOpen] = useState(false);
  const { data, isPending, isError, error } = useQuery({
    queryKey: qk.dashboard,
    queryFn: fetchDashboard,
    refetchInterval: 20_000,
  });
  const history = useQuery({
    queryKey: qk.history,
    queryFn: fetchHistory,
    refetchInterval: 60_000,
  });

  const weekDelta = useMemo(() => {
    const pts = history.data?.overall ?? [];
    if (pts.length < 2) return null;
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    const first = pts.find((p) => new Date(p.t).getTime() >= cutoff) ?? pts[0];
    const last = pts[pts.length - 1];
    const d = last.percentage - first.percentage;
    return Math.abs(d) < 0.005 ? null : d;
  }, [history.data]);

  if (isPending) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <CardSkeletonLight className="md:col-span-2 xl:col-span-2" />
          <CardSkeletonLight />
          <CardSkeletonLight />
          <CardSkeletonLight />
        </div>
        <CardSkeletonLight />
        <div className="grid gap-4 lg:grid-cols-2">
          <CardSkeletonLight />
          <CardSkeletonLight />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Card className="rounded-xl border-red-500/30 bg-red-500/5">
        <CardContent className="flex items-center gap-3 p-6 text-sm text-red-600 dark:text-red-400">
          <XCircle className="size-5 shrink-0" aria-hidden="true" />
          Could not load the dashboard: {error?.message ?? "unknown error"}
        </CardContent>
      </Card>
    );
  }

  const { overall, subjects, target, mode } = data;
  const sorted = sortSubjects(subjects, sort);

  if (mode === "none") {
    return (
      <EmptyHero
        title="No ERP data available yet."
        description="Connect your ERP account or run a first synchronization to fetch your attendance and reminders. Nothing is shown until real data arrives."
        actionLabel="Connect / Sync ERP"
        onAction={onOpenSettings}
      />
    );
  }

  return (
    <motion.div
      className="space-y-4"
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: 0.05 } },
      }}
    >
      {/* Subject detail drawer (also covers what-if planning) */}
      <SubjectDrawer
        subject={data.subjects.find((s) => s.code === selectedCode) ?? null}
        target={target}
        globalTarget={target}
        open={selectedCode !== null}
        onOpenChange={(o) => {
          if (!o) setSelectedCode(null);
        }}
      />

      {/* Row 0 — next deadline countdown */}
      <NextUpStrip items={data.reminders.items} />

      {/* Row 1 — overall + stats */}
      <motion.div
        className="grid gap-4 md:grid-cols-2 xl:grid-cols-5"
        variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.25, ease: "easeOut" } } }}
      >
        <Card className="erp-card-accent rounded-xl border-border/60 transition-shadow hover:shadow-md md:col-span-2 xl:col-span-2">
          <CardContent className="flex flex-col items-center gap-4 p-6 sm:flex-row sm:gap-6">
            <ProgressRing percentage={overall.percentage} target={target} size={150} animated />
            <div className="min-w-0 flex-1 space-y-2.5 text-center sm:text-left">
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <h2 className="text-lg font-semibold tracking-tight">Overall attendance</h2>
                <StatusChip status={overall.status} target={target} />
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-7 gap-1 rounded-full px-2.5 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setDigestOpen(true)}
                  aria-label="Open the weekly attendance report"
                >
                  <CalendarRange className="size-3.5" aria-hidden="true" />
                  This week
                </Button>
                {weekDelta !== null && (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                      weekDelta >= 0
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : "bg-red-500/10 text-red-600 dark:text-red-400"
                    )}
                    title="Change over the last 7 days"
                  >
                    {weekDelta >= 0 ? "▲" : "▼"} {Math.abs(weekDelta).toFixed(2)} pts / 7d
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground tabular-nums">
                <span className="font-semibold text-foreground">{overall.present}</span> present of{" "}
                <span className="font-semibold text-foreground">{overall.total}</span> classes
                <span className="text-muted-foreground/70"> ({overall.absent} missed)</span>
              </p>
              <div className="space-y-1 text-sm">
                {overall.classesToTarget > 0 ? (
                  <p className="flex items-center justify-center gap-1.5 text-amber-600 dark:text-amber-400 sm:justify-start">
                    <ArrowRight className="size-3.5 shrink-0" aria-hidden="true" />
                    Attend the next <b className="tabular-nums">{overall.classesToTarget}</b>{" "}
                    {overall.classesToTarget === 1 ? "class" : "classes"} to reach {target}%
                  </p>
                ) : (
                  <p className="flex items-center justify-center gap-1.5 text-emerald-600 dark:text-emerald-400 sm:justify-start">
                    <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
                    You are at or above the {target}% target
                  </p>
                )}
                {overall.canSkip > 0 && (
                  <p className="flex items-center justify-center gap-1.5 text-muted-foreground sm:justify-start">
                    <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
                    You can skip <b className="tabular-nums text-foreground">{overall.canSkip}</b>{" "}
                    {overall.canSkip === 1 ? "class" : "classes"} and stay above {target}%
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <StatCard icon={Layers} label="Subjects" value={subjects.length} tone="emerald" />
        <StatCard
          icon={AlertTriangle}
          label="Below target"
          value={data.warningSubjects}
          tone={data.warningSubjects > 0 ? "amber" : "default"}
        />
        <StatCard icon={BellRing} label="Active reminders" value={data.reminders.items.length} />
      </motion.div>

      {/* Weekly digest report dialog */}
      <WeeklyDigestDialog open={digestOpen} onOpenChange={setDigestOpen} demoMode={mode === "demo"} />

      {/* Row 2 — subject list */}
      <Card className="rounded-xl border-border/60 transition-shadow hover:shadow-md">
        <CardHeader className="flex flex-col gap-2 space-y-0 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-base tracking-tight">Subject attendance</CardTitle>
            <CardDescription className="text-xs">Tap a subject for details and what-if planning</CardDescription>
          </div>
          <div className="flex items-center gap-1.5">
            <Select value={sort} onValueChange={(v) => setSort(v as SubjectSort)}>
              <SelectTrigger
                className="h-8 w-full min-w-0 gap-1 text-xs sm:w-[190px]"
                aria-label="Sort subjects"
              >
                <ArrowDownUp className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUBJECT_SORTS.map((o) => (
                  <SelectItem key={o.key} value={o.key} className="text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1 text-xs" onClick={onOpenAttendance}>
              View all <ChevronRight className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {subjects.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No subjects synchronized yet</p>
          ) : (
            <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {sorted.map((s) => (
                <SubjectRow
                  key={s.id}
                  s={s}
                  onOpen={() => setSelectedCode(s.code)}
                  shimmer={data.erp.sync.status === "syncing"}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Row 2.5 — today's schedule / weekly timetable */}
      {subjects.length > 0 && <TimetableCard subjects={subjects} />}

      {/* Row 3 — reminders preview + ERP status */}
      <div className="grid gap-4 lg:grid-cols-2">
        <RemindersPreview
          items={data.reminders.items}
          todayCount={data.reminders.todayCount}
          weekCount={data.reminders.weekCount}
        />
        <ErpStatusCard
          connected={data.erp.connected}
          demoMode={data.erp.demoMode ?? false}
          username={data.erp.username}
          sync={data.erp.sync}
        />
      </div>

      {/* Row 4 — changes feed + notifications */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-xl border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base tracking-tight">Recent ERP changes</CardTitle>
            <CardDescription className="text-xs">Detected automatically by the sync engine</CardDescription>
          </CardHeader>
          <CardContent>
            {data.changes.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No changes recorded yet</p>
            ) : (
              <ul className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
                {data.changes.slice(0, 8).map((c) => (
                  <ChangeRow key={c.id} c={c} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-xl border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base tracking-tight">Recent notifications</CardTitle>
            <CardDescription className="text-xs">{data.unreadCount} unread</CardDescription>
          </CardHeader>
          <CardContent>
            {data.notifications.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nothing here yet</p>
            ) : (
              <ul className="max-h-96 space-y-1 overflow-y-auto pr-1">
                {data.notifications.slice(0, 5).map((n) => (
                  <NotificationRow key={n.id} n={n} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </motion.div>
  );
}
