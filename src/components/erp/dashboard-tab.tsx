"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { isToday } from "date-fns";
import {
  AlertTriangle,
  ArrowRight,
  ArrowDownUp,
  BellRing,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FlaskConical,
  CalendarRange,
  GraduationCap,
  Hourglass,
  Info,
  ClipboardList,
  Copy,
  Layers,
  Printer,
  RefreshCw,
  Share2,
  WifiOff,
  XCircle,
  Footprints,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { compactErrorText } from "@/lib/compact-error";
import { fetchAssignments, fetchDashboard, fetchHistory, fetchSyncLogs, qk } from "./api";
import { WeeklyDigestDialog } from "./digest-dialog";
import { MilestoneCelebration, MilestonesStrip } from "./milestones";
import { SubjectDrawer } from "./subject-drawer";
import { TimetableCard } from "./timetable-card";
import {
  ago,
  dueGroup,
  EmptyHero,
  ERP_BASE,
  erpAssignmentUrl,
  fmtDT,
  hueColors,
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
  AlaStatChip,
  collectAlaStats,
  SkipPips,
  type SubjectAlaStat,
} from "./shared";
import type { AlaUpcomingRow, ChangeEvent, HistoryPoint, Reminder, SubjectView } from "./types";
import { Sparkline } from "./trend-chart";

/* ------------------------------------------------------------------ */

const SUBJECT_SORTS = [
  { key: "lowest", label: "Lowest attendance first" },
  { key: "highest", label: "Highest attendance first" },
  { key: "name", label: "Name A–Z" },
  { key: "recent", label: "Recently updated" },
] as const;

type SubjectSort = (typeof SUBJECT_SORTS)[number]["key"];

/** Remembered subject sort order — a view preference, so device-local. */
const SUBJECT_SORT_KEY = "erp:subjectSort";

function loadSavedSort(): SubjectSort {
  if (typeof window === "undefined") return "lowest";
  try {
    const saved = window.localStorage.getItem(SUBJECT_SORT_KEY);
    return SUBJECT_SORTS.some((o) => o.key === saved) ? (saved as SubjectSort) : "lowest";
  } catch {
    return "lowest";
  }
}

/* No-data subjects (total === 0) have no attendance yet — a 0.00% is not a
   real value, so they never compete with actual percentages: they sink to
   the end of both directions with a name tie-break. */
function noDataLast(a: SubjectView, b: SubjectView): number {
  const an = a.total === 0;
  const bn = b.total === 0;
  if (an !== bn) return an ? 1 : -1;
  return 0;
}

function sortSubjects(list: SubjectView[], sort: SubjectSort): SubjectView[] {
  const copy = [...list];
  switch (sort) {
    case "lowest":
      return copy.sort(
        (a, b) => noDataLast(a, b) || a.percentage - b.percentage || a.name.localeCompare(b.name)
      );
    case "highest":
      return copy.sort(
        (a, b) => noDataLast(a, b) || b.percentage - a.percentage || a.name.localeCompare(b.name)
      );
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

/** Relative urgency pill for an ALA deadline: red overdue/≤48h, amber ≤7d, muted later. */
function deadlinePill(dueAt: string, now: number): { label: string; className: string } {
  const due = new Date(dueAt).getTime();
  const diff = due - now;
  if (diff < 0)
    return {
      label: countdownLabel(dueAt, now),
      className: "bg-red-500/10 text-red-600 dark:text-red-400",
    };
  if (diff <= 2 * 86_400_000)
    return {
      label: countdownLabel(dueAt, now),
      className: "bg-red-500/10 text-red-600 dark:text-red-400",
    };
  if (diff <= 7 * 86_400_000)
    return {
      label: countdownLabel(dueAt, now),
      className: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    };
  return { label: countdownLabel(dueAt, now), className: "bg-muted text-muted-foreground" };
}

/**
 * Top of the open ALA/assignment deadline queue, mirrored straight from the
 * ERP sync (Reminder rows with the assignment externalId prefix). Every row
 * deep-links into the Reminders tab, where the subject-wise list lives.
 */
function AlaDeadlinePanel({
  rows,
  pending,
  total,
  onOpenReminders,
}: {
  rows: AlaUpcomingRow[];
  pending: number;
  total: number;
  onOpenReminders: () => void;
}) {
  const now = useNow();
  if (rows.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-muted/20">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <ClipboardList className="size-3.5" aria-hidden="true" />
          Next ALA &amp; assignment deadlines
        </p>
        <Badge variant={pending > 0 ? "secondary" : "outline"} className="text-[10px] tabular-nums">
          {pending} of {total} pending
        </Badge>
      </div>
      <ul>
        {rows.map((row, i) => {
          const hue = row.subjectCode ? hueColors(row.subjectCode) : null;
          const pill = deadlinePill(row.dueAt, now);
          const overdue = new Date(row.dueAt).getTime() < now;
          return (
            <motion.li
              key={row.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * i, duration: 0.18 }}
              className="list-none border-b border-border/40 last:border-b-0"
            >
              <div className="flex items-stretch">
                <button
                  type="button"
                  onClick={onOpenReminders}
                  aria-label={`Open the subject-wise ALA list — ${row.title}`}
                  title="Open the subject-wise list in the Reminders tab"
                  className="group/ala flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  {hue ? (
                    <span
                      className="shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold"
                      style={{ backgroundColor: hue.bg, color: hue.fg }}
                    >
                      {row.subjectCode}
                    </span>
                  ) : (
                    <ClipboardList className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium leading-snug">{row.title}</span>
                    {row.subjectName && (
                      <span className="block truncate text-[11px] text-muted-foreground">{row.subjectName}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-right">
                    <span
                      className={cn(
                        "block rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums transition-colors",
                        pill.className,
                        overdue && "group-hover/ala:bg-red-500/20"
                      )}
                    >
                      {pill.label}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-muted-foreground">{fmtDT(row.dueAt)}</span>
                  </span>
                  <ChevronRight
                    className="size-3.5 shrink-0 text-muted-foreground/40 transition-transform group-hover/ala:translate-x-0.5 group-hover/ala:text-foreground"
                    aria-hidden="true"
                  />
                </button>
                {erpAssignmentUrl(row.externalId) && (
                  <a
                    href={erpAssignmentUrl(row.externalId) as string}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open ${row.title} in the ERP portal (new tab)`}
                    title="Open in the ERP portal — submissions happen there (this app is a read-only mirror)"
                    className="flex w-9 shrink-0 items-center justify-center border-l border-border/40 text-muted-foreground/70 transition-all hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                  </a>
                )}
              </div>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
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
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span className="relative flex size-1.5 shrink-0" aria-hidden="true">
            <span
              className={cn(
                "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60",
                isOverdue ? "bg-red-500" : "bg-emerald-500"
              )}
              style={{ animationDuration: "2.2s" }}
            />
            <span className={cn("relative inline-flex size-1.5 rounded-full", isOverdue ? "bg-red-500" : "bg-emerald-500")} />
          </span>
          Next up {overdue.length > 0 && <span className="text-red-500">· {overdue.length} overdue</span>}
        </p>
        <p className="flex min-w-0 items-center gap-1.5">
          {shown.subjectCode && hueColors(shown.subjectCode) && (
            <span
              className="shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold"
              style={(() => {
                const hue = hueColors(shown.subjectCode as string);
                return { backgroundColor: hue.bg, color: hue.fg };
              })()}
            >
              {shown.subjectCode}
            </span>
          )}
          <span className="truncate text-sm font-medium">{shown.title}</span>
        </p>
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
  alaPending,
  alaTotal,
  alaUpcoming,
  onOpenReminders,
}: {
  items: Reminder[];
  todayCount: number;
  weekCount: number;
  alaPending: number;
  alaTotal: number;
  alaUpcoming: AlaUpcomingRow[];
  onOpenReminders: () => void;
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
        <AlaDeadlinePanel
          rows={alaUpcoming}
          pending={alaPending}
          total={alaTotal}
          onOpenReminders={onOpenReminders}
        />
        {alaTotal > 0 && (
          <button
            type="button"
            onClick={onOpenReminders}
            aria-label={
              alaPending > 0
                ? `Open the Reminders tab — ${alaPending} of ${alaTotal} ALA and assignment submissions still pending`
                : `Open the Reminders tab — all ${alaTotal} ALA and assignment rows are submitted or closed`
            }
            className={cn(
              "mt-3 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              alaPending > 0
                ? "border-primary/25 bg-primary/[0.05] hover:bg-primary/10"
                : "border-emerald-500/30 bg-emerald-500/[0.06] hover:bg-emerald-500/10"
            )}
          >
            {alaPending > 0 ? (
              <ClipboardList className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1 truncate">
              <span className="font-semibold">
                {alaPending > 0 ? `${alaPending} of ${alaTotal} pending` : `All ${alaTotal} submitted or closed`}
              </span>{" "}
              <span className="text-muted-foreground">· open the subject-wise list</span>
            </span>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

/** Live "in 12 min"-style countdown for a future instant (null when absent/past). */
function inCountdown(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - now;
  if (diff <= 0) return null;
  const mins = Math.max(1, Math.round(diff / 60_000));
  if (mins < 60) return `in ${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `in ${hrs}h ${rem}m` : `in ${hrs}h`;
}

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
  /* Sync reliability from the SHARED qk.sync cache (the Settings sync-history
     card polls the same key — React Query dedupes, no extra traffic when both
     are mounted). Honest window: only the logs the server still retains. */
  const logsQ = useQuery({ queryKey: qk.sync, queryFn: fetchSyncLogs, staleTime: 15_000, refetchInterval: 60_000 });
  const logs = logsQ.data?.logs ?? [];
  const totalLogs = logs.length;
  const okLogs = logs.filter((l) => l.status === "success").length;
  const rate = totalLogs > 0 ? okLogs / totalLogs : null;
  const rateTone =
    rate == null ? null : rate >= 0.9 ? "emerald" : rate >= 0.7 ? "amber" : "red";
  const lastFail = logs.find((l) => l.status !== "success");
  const syncing = sync.status === "syncing";
  return (
    <Card className="rounded-xl border-border/60">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base tracking-tight">ERP connection</CardTitle>
          <CardDescription className="text-xs">erp.gmiu.edu.in · read-only source of truth</CardDescription>
        </div>
        {syncing ? (
          <RefreshCw className="size-5 animate-spin text-primary" aria-hidden="true" />
        ) : connected ? (
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
            <dd className="font-medium">
              {sync.nextScheduledSyncAt ? fmtDT(sync.nextScheduledSyncAt) : "—"}
              {inCountdown(sync.nextScheduledSyncAt, now) && (
                <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                  {inCountdown(sync.nextScheduledSyncAt, now)}
                </span>
              )}
            </dd>
          </div>
          {rate != null && (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Reliability</dt>
              <dd
                className="flex items-center gap-1.5 font-medium tabular-nums"
                title={`Success rate over the last ${totalLogs} recorded syncs${lastFail ? ` — last failure ${ago(lastFail.startedAt, now)}` : ""}`}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    rateTone === "emerald" && "bg-emerald-500",
                    rateTone === "amber" && "bg-amber-500",
                    rateTone === "red" && "bg-red-500"
                  )}
                />
                {okLogs}/{totalLogs} OK
              </dd>
            </div>
          )}
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

function ChangeRow({ c, onOpen }: { c: ChangeEvent; onOpen?: (code: string) => void }) {
  const now = useNow();
  const clickable = Boolean(onOpen && c.subjectCode);
  const hue = c.subjectCode ? hueColors(c.subjectCode) : null;

  const inner = (
    <>
      <KindIcon kind={c.kind} />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">{c.detail}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {c.subjectCode && hue && (
            <Badge
              variant="outline"
              className="gap-1 border-transparent px-1.5 py-0 font-mono text-[10px]"
              style={{ backgroundColor: hue.bg, color: hue.fg }}
            >
              {c.subjectCode}
            </Badge>
          )}
          {ago(c.createdAt, now)}
        </p>
      </div>
      {clickable && (
        <ChevronRight
          className="mt-1 size-3.5 shrink-0 text-muted-foreground/50 transition-transform group-hover/row:translate-x-0.5 group-hover/row:text-foreground"
          aria-hidden="true"
        />
      )}
    </>
  );

  if (!clickable) {
    return (
      <li className="flex items-start gap-2.5 rounded-lg border border-border/50 p-2.5 transition-colors hover:bg-muted/50">
        {inner}
      </li>
    );
  }

  return (
    <li className="group/row list-none p-0">
      <button
        type="button"
        onClick={() => onOpen?.(c.subjectCode as string)}
        aria-label={`Open ${c.subjectCode} in the subject drawer`}
        title={`Open ${c.subjectCode} — attendance, trend and what-if planner`}
        className="flex w-full items-start gap-2.5 rounded-lg border border-border/50 p-2.5 text-left transition-all hover:border-primary/40 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {inner}
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------ */

function SubjectRow({
  s,
  onOpen,
  shimmer,
  spark,
  alaStat,
}: {
  s: SubjectView;
  onOpen: () => void;
  shimmer: boolean;
  /** Per-subject snapshot history — when ≥2 points, a mini trend line rides the row. */
  spark?: HistoryPoint[];
  /** Open ALA/assignment deadlines for this subject (amber when any overdue). */
  alaStat?: SubjectAlaStat;
}) {
  const c = statusColors(s.status);
  const trend = (spark ?? []).map((p) => p.percentage);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border border-border/50 p-3 text-left transition-all hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        s.status === "none" && "border-dashed bg-muted/20"
      )}
      aria-label={`Open attendance details for ${s.name}${
        alaStat && alaStat.open > 0
          ? ` — ${alaStat.open} open ALA deadline${alaStat.open === 1 ? "" : "s"}${
              alaStat.overdue > 0 ? `, ${alaStat.overdue} overdue` : ""
            }`
          : ""
      }`}
    >
      <span className={cn("hidden shrink-0 rounded-md px-2 py-1 font-mono text-[11px] font-semibold sm:block", c.bg, c.text)}>
        {s.code}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-medium">{s.name}</p>
          {s.status === "none" ? (
            <span
              className={cn("shrink-0 text-sm font-bold tabular-nums", c.text)}
              title="No classes held yet — the ERP has not recorded attendance for this subject"
            >
              —
            </span>
          ) : (
            <span className={cn("shrink-0 text-sm font-bold tabular-nums", c.text)}>{s.percentage.toFixed(2)}%</span>
          )}
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <MiniBar percentage={s.percentage} status={s.status} target={s.targetPct} className="flex-1" shimmer={shimmer} />
          {s.status === "safe" && (
            <SkipPips
              count={s.canSkip}
              title={
                s.canSkip > 0
                  ? `Skip budget: you could miss ${s.canSkip} more ${
                      s.canSkip === 1 ? "class" : "classes"
                    } and stay at/above ${s.targetPct}% (${s.present}/${s.total} now)`
                  : `No skip buffer — missing even 1 class would drop you below ${s.targetPct}%`
              }
              className="hidden sm:inline-flex"
            />
          )}
          {s.status === "none" ? (
            <span className="shrink-0 text-[11px] italic text-muted-foreground/80">no classes yet</span>
          ) : s.status !== "safe" && s.classesToTarget > 0 ? (
            <span className="shrink-0 text-[11px] font-medium text-amber-600 dark:text-amber-400">
              ⚠ needs {s.classesToTarget} more {s.classesToTarget === 1 ? "class" : "classes"}
            </span>
          ) : (
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
              {s.present}/{s.total}
            </span>
          )}
          {s.hasCustomTarget && <CustomTargetChip target={s.targetPct} className="shrink-0" />}
          <AlaStatChip stat={alaStat} className="ml-auto" />
        </div>
      </div>
      {trend.length >= 2 && (
        <Sparkline
          points={trend}
          stroke={c.bar.includes("red") ? "#ef4444" : c.bar.includes("amber") ? "#f59e0b" : "#10b981"}
          width={56}
          height={18}
          target={s.targetPct}
          className="hidden shrink-0 opacity-70 md:block"
          ariaLabel={`${s.name} attendance trend, currently ${s.percentage.toFixed(2)}%`}
        />
      )}
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
        <p className="line-clamp-2 text-xs text-muted-foreground">{compactErrorText(n.message, 240)}</p>
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
  onOpenReminders,
}: {
  onOpenAttendance: () => void;
  onOpenSettings: () => void;
  onOpenReminders: () => void;
}) {
  /* Sort starts at the default and hydrates from localStorage after mount
     (SSR renders "lowest", so a saved preference swaps in post-paint — same
     pattern as the text-size setting). Saved on every change below. */
  const [sort, setSortState] = useState<SubjectSort>("lowest");
  useEffect(() => {
    setSortState(loadSavedSort());
  }, []);
  const setSort = (next: SubjectSort) => {
    setSortState(next);
    try {
      window.localStorage.setItem(SUBJECT_SORT_KEY, next);
    } catch {
      /* private mode / storage full — the preference just won't persist */
    }
  };
  /* Store the CODE (not the object) and derive the view from fresh query data,
     so the drawer reflects updated targets/percentages after refetches. */
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [digestOpen, setDigestOpen] = useState(false);
  const [showAllChanges, setShowAllChanges] = useState(false);
  const [showAllNotifs, setShowAllNotifs] = useState(false);
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
  /* Full ALA queue — deduped with the page-level badge poll via the shared
     qk.assignments cache. Feeds the per-subject "N ALAs" chips on subject rows
     (amber when any deadline is overdue) that lead into the drawer's
     Active-deadlines section. */
  const alaQ = useQuery({
    queryKey: qk.assignments,
    queryFn: fetchAssignments,
    refetchInterval: 60_000,
  });
  const now = useNow(60_000);
  const alaStats = useMemo(
    () => collectAlaStats(alaQ.data?.assignments, alaQ.data?.courseNames, now),
    [alaQ.data, now]
  );

  const weekDelta = useMemo(() => {
    const pts = history.data?.overall ?? [];
    if (pts.length < 2) return null;
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    const first = pts.find((p) => new Date(p.t).getTime() >= cutoff) ?? pts[0];
    const last = pts[pts.length - 1];
    const d = last.percentage - first.percentage;
    if (Math.abs(d) < 0.005) return null;
    // Be honest about the window: when tracked history is younger than the
    // 7-day span (e.g. live tracking just started), label the real span.
    const spanDays = Math.max(
      0,
      (new Date(last.t).getTime() - new Date(first.t).getTime()) / 86_400_000
    );
    return { delta: d, spanDays, fullWeek: spanDays >= 6.5 };
  }, [history.data]);

  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const summaryText = useMemo(() => {
    if (!data) return "";
    const lines: string[] = [];
    lines.push(
      `Attendance summary — ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} IST`
    );
    lines.push(
      `Overall: ${data.overall.percentage.toFixed(2)}% (${data.overall.present}/${data.overall.total} classes, ${data.overall.absent} missed) — target ${data.target}% [${data.overall.status}]`
    );
    for (const s of data.subjects) {
      lines.push(
        `${s.code} ${s.name}: ${s.percentage.toFixed(2)}% (${s.present}/${s.total}) — target ${s.targetPct}% [${s.status}]${s.hasCustomTarget ? " (custom)" : ""}`
      );
    }
    return lines.join("\n");
  }, [data]);

  const copySummary = async () => {
    if (!summaryText) return;
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable (insecure context / permission denied) — keep button inert
    }
  };

  /* Native share sheet (mobile-first). Probed post-hydration so SSR markup
     never differs from the client render. */
  const [canShare, setCanShare] = useState(false);
  const [shared, setShared] = useState(false);
  const shareTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setCanShare(typeof navigator.share === "function");
  }, []);
  const shareSummary = async () => {
    if (!summaryText) return;
    try {
      await navigator.share({ title: "Attendance summary", text: summaryText });
      setShared(true);
      if (shareTimer.current) clearTimeout(shareTimer.current);
      shareTimer.current = setTimeout(() => setShared(false), 2000);
    } catch {
      // share sheet dismissed (AbortError) or unavailable — stay inert
    }
  };

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

  /* Stat-card compositions (derived from the SAME polled payload — no extra fetches):
     subjects split by status for the mini composition bar, the worst below-target
     subject for the warning card, and the reminders/ALA split for the bell card. */
  const safeCount = subjects.filter((s) => s.status === "safe").length;
  const warnCount = subjects.filter((s) => s.status === "warning").length;
  const dangerCount = subjects.filter((s) => s.status === "danger").length;
  const noneCount = subjects.filter((s) => s.status === "none").length;
  const belowCount = warnCount + dangerCount;
  const worst = subjects
    .filter((s) => s.status !== "none" && s.percentage < s.targetPct)
    .sort((a, b) => a.percentage - b.percentage)[0];
  const compTotal = Math.max(subjects.length, 1);

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
      {/* Print-only report header — replaces the app chrome on paper/PDF */}
      <div className="hidden print:block" aria-hidden="true">
        <div className="flex items-end justify-between border-b-2 border-black/80 pb-2">
          <div>
            <p className="text-base font-bold tracking-tight">Attendance Report</p>
            <p className="text-xs text-black/70">
              Gyanmanjari Innovative University · erp.gmiu.edu.in
              {data.semester !== "all" ? ` · Semester ${data.semester}` : ""}
            </p>
          </div>
          <div className="text-right text-xs tabular-nums text-black/70">
            <p className="font-semibold text-black">
              Overall {overall.percentage.toFixed(2)}% <span className="font-normal">(target {target}%)</span>
            </p>
            <p>Generated {fmtDT(data.erp?.sync?.lastSyncAt ?? new Date().toISOString())}</p>
          </div>
        </div>
      </div>

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
      <div className="print:hidden"><NextUpStrip items={data.reminders.items} /></div>

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
                {data.semester !== "all" && (
                  <Badge
                    variant="outline"
                    className="gap-1 border-primary/40 text-primary"
                    title="A semester partition is active — only this semester's ERP subjects are counted"
                  >
                    <GraduationCap className="size-3" aria-hidden="true" />
                    Sem {data.semester}
                  </Badge>
                )}
                <StatusChip status={overall.status} target={target} />
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-7 gap-1 rounded-full border border-border/40 bg-background/40 px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground print:hidden"
                  onClick={copySummary}
                  aria-label="Copy attendance summary to clipboard" data-noprint
                  title="Copy a plain-text attendance summary (per-subject %, status, targets)"
                >
                  {copied ? (
                    <CheckCircle2 className="size-3.5 text-emerald-500" aria-hidden="true" />
                  ) : (
                    <Copy className="size-3.5" aria-hidden="true" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </Button>
                {canShare && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 rounded-full border border-border/40 bg-background/40 px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground print:hidden"
                    onClick={shareSummary}
                    aria-label="Share attendance summary via your device" data-noprint
                    title="Share the plain-text attendance summary (per-subject %, status, targets)"
                  >
                    <Share2 className="size-3.5" aria-hidden="true" />
                    {shared ? "Shared" : "Share"}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 rounded-full border border-border/40 bg-background/40 px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground print:hidden"
                  onClick={() => setDigestOpen(true)}
                  aria-label="Open the weekly attendance report" data-noprint
                >
                  <CalendarRange className="size-3.5" aria-hidden="true" />
                  This week
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 rounded-full border border-border/40 bg-background/40 px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground print:hidden"
                  onClick={() => window.print()}
                  aria-label="Print the attendance report or save it as PDF" data-noprint
                  title="Print the report or save it as a PDF — hides all app chrome automatically"
                >
                  <Printer className="size-3.5" aria-hidden="true" />
                  Print
                </Button>
                {weekDelta !== null && (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                      weekDelta.delta >= 0
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : "bg-red-500/10 text-red-600 dark:text-red-400"
                    )}
                    title={
                      weekDelta.fullWeek
                        ? "Change over the last 7 days"
                        : `Change over the ${weekDelta.spanDays < 1 ? "first day" : `last ${Math.max(1, Math.round(weekDelta.spanDays))} day(s)`} of tracked history`
                    }
                  >
                    {weekDelta.delta >= 0 ? "▲" : "▼"} {Math.abs(weekDelta.delta).toFixed(2)} pts{" "}
                    {weekDelta.fullWeek
                      ? "/ 7d"
                      : weekDelta.spanDays < 1
                        ? "· day 1"
                        : `/ ${Math.max(1, Math.round(weekDelta.spanDays))}d`}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground tabular-nums">
                <span className="font-semibold text-foreground">{overall.present}</span> present of{" "}
                <span className="font-semibold text-foreground">{overall.total}</span> classes
                <span className="text-muted-foreground/70"> ({overall.absent} missed)</span>
              </p>
              {/* Plain inline paragraphs — flex+gap chunks broke sentences into
                  independently-wrapping fragments at card width. */}
              <div className="space-y-1 text-sm">
                {overall.classesToTarget > 0 ? (
                  <p className="text-amber-600 dark:text-amber-400">
                    <ArrowRight className="mr-1 inline size-3.5 shrink-0 align-[-3px]" aria-hidden="true" />
                    Attend the next <b className="tabular-nums">{overall.classesToTarget}</b>{" "}
                    {overall.classesToTarget === 1 ? "class" : "classes"} to reach {target}%
                  </p>
                ) : (
                  <p className="text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="mr-1 inline size-3.5 shrink-0 align-[-3px]" aria-hidden="true" />
                    You are at or above the {target}% target
                  </p>
                )}
                {overall.canSkip > 0 && (
                  <p className="text-muted-foreground">
                    <CalendarClock className="mr-1 inline size-3.5 shrink-0 align-[-3px]" aria-hidden="true" />
                    You can skip <b className="tabular-nums text-foreground">{overall.canSkip}</b>{" "}
                    {overall.canSkip === 1 ? "class" : "classes"} and stay above {target}%
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <StatCard
          icon={Layers}
          label="Subjects"
          value={subjects.length}
          tone="emerald"
          onClick={() => {
            window.location.hash = "attendance";
          }}
          ariaLabel="Subjects — jump to the attendance tab"
        >
          {/* Composition bar: danger / warning / safe / no-classes-yet, sized by share */}
          <div
            className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`${safeCount} at target, ${belowCount} below target, ${noneCount} with no classes yet`}
          >
            {dangerCount > 0 && (
              <span
                className="h-full bg-red-500 transition-all duration-500"
                style={{ width: `${(dangerCount / compTotal) * 100}%` }}
              />
            )}
            {warnCount > 0 && (
              <span
                className="h-full bg-amber-500 transition-all duration-500"
                style={{ width: `${(warnCount / compTotal) * 100}%` }}
              />
            )}
            {safeCount > 0 && (
              <span
                className="h-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${(safeCount / compTotal) * 100}%` }}
              />
            )}
            {noneCount > 0 && (
              <span
                className="h-full bg-slate-300 transition-all duration-500 dark:bg-slate-600"
                style={{ width: `${(noneCount / compTotal) * 100}%` }}
              />
            )}
          </div>
          <p className="mt-1.5 text-[11px] leading-tight text-muted-foreground">
            <span className="font-medium text-emerald-600 dark:text-emerald-400">{safeCount} at target</span>
            <span aria-hidden="true"> · </span>
            <span className={cn("font-medium", belowCount > 0 && "text-amber-600 dark:text-amber-400")}>
              {belowCount} below
            </span>
            {noneCount > 0 && <span> · {noneCount} no classes yet</span>}
          </p>
        </StatCard>
        <StatCard
          icon={AlertTriangle}
          label="Below target"
          value={data.warningSubjects}
          tone={data.warningSubjects > 0 ? "amber" : "emerald"}
          onClick={
            data.warningSubjects > 0
              ? () => {
                  window.location.hash = "attendance";
                }
              : undefined
          }
          ariaLabel={
            data.warningSubjects > 0
              ? "Below target — jump to the attendance tab"
              : "All subjects at or above target"
          }
        >
          {worst ? (
            <div className="space-y-1">
              <p
                className="truncate text-[11px] font-medium text-foreground/80"
                title={`${worst.name} — ${worst.percentage.toFixed(2)}% (target ${worst.targetPct}%)`}
              >
                worst: {worst.name}
              </p>
              <p className="flex items-center gap-1 text-[11px] leading-tight text-amber-600 dark:text-amber-400">
                <Footprints className="size-3 shrink-0" aria-hidden="true" />
                {worst.classesToTarget > 0 ? (
                  <span>
                    attend <b className="tabular-nums">{worst.classesToTarget}</b> to reach {worst.targetPct}%
                  </span>
                ) : (
                  <span>recover by attending upcoming classes</span>
                )}
              </p>
            </div>
          ) : (
            <p className="flex items-center gap-1 text-[11px] leading-tight text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-3 shrink-0" aria-hidden="true" />
              {noneCount > 0
                ? `every graded subject is at or above target (${noneCount} await first class)`
                : "every subject is at or above its target"}
            </p>
          )}
        </StatCard>
        <StatCard
          icon={BellRing}
          label="Active reminders"
          value={data.reminders.items.length}
          onClick={() => {
            window.location.hash = "reminders";
          }}
          ariaLabel="Active reminders — jump to the reminders tab"
        >
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-tight text-muted-foreground">
            <span className="font-medium text-foreground/80">{data.reminders.todayCount} today</span>
            <span aria-hidden="true">·</span>
            <span>{data.reminders.weekCount} this week</span>
            <span aria-hidden="true">·</span>
            <span
              className={cn(
                "font-medium",
                data.reminders.alaPending > 0 ? "text-amber-600 dark:text-amber-400" : ""
              )}
            >
              {data.reminders.alaPending} open ALAs
            </span>
          </p>
        </StatCard>
      </motion.div>

      {/* Milestones — best ever, days at target, streak (honest from snapshot history) */}
      <MilestonesStrip history={history.data} overallPct={overall.percentage} target={target} />

      {/* One-time celebration when the target is (re)crossed or a personal best lands */}
      <MilestoneCelebration
        overallPct={overall.percentage}
        present={overall.present}
        total={overall.total}
        target={target}
        history={history.data}
      />

      {/* Weekly digest report dialog */}
      <WeeklyDigestDialog open={digestOpen} onOpenChange={setDigestOpen} demoMode={mode === "demo"} />

      {/* Row 2 — subject list */}
      <Card className="rounded-xl border-border/60 transition-shadow hover:shadow-md">
        <CardHeader className="flex flex-col gap-2 space-y-0 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-base tracking-tight">Subject attendance</CardTitle>
            <CardDescription className="text-xs">Tap a subject for details and what-if planning</CardDescription>
          </div>
          <div className="flex items-center gap-1.5 print:hidden">
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
            <p className="py-6 text-center text-sm text-muted-foreground">
              {data.semester !== "all"
                ? `No subjects synchronized for Semester ${data.semester}`
                : "No subjects synchronized yet"}
            </p>
          ) : (
            <>
              <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                {sorted.map((s) => (
                  <SubjectRow
                    key={s.id}
                    s={s}
                    onOpen={() => setSelectedCode(s.code)}
                    shimmer={data.erp.sync.status === "syncing"}
                    spark={history.data?.subjects[s.code]}
                    alaStat={alaStats.get(s.name.trim().toLowerCase())}
                  />
                ))}
              </div>
              {/* Pip legend — the skip-budget dots on each row, decoded once here */}
              <div
                className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[10px] text-muted-foreground/85"
                aria-hidden="true"
              >
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  dot = one class you could still miss
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full border border-amber-500/70 bg-amber-500/15" />
                  hollow = none left
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Row 2.5 — today's schedule / weekly timetable */}
      {subjects.length > 0 && <TimetableCard subjects={subjects} mode={data.mode} />}

      {/* Row 3 — reminders preview + ERP status */}
      <div className="grid gap-4 lg:grid-cols-2">
        <RemindersPreview
          items={data.reminders.items}
          todayCount={data.reminders.todayCount}
          weekCount={data.reminders.weekCount}
          alaPending={data.reminders.alaPending}
          alaTotal={data.reminders.alaTotal}
          alaUpcoming={data.reminders.alaUpcoming}
          onOpenReminders={onOpenReminders}
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
            <CardDescription className="text-xs">
              Detected automatically by the sync engine
              {data.changes.some((c) => c.subjectCode && data.subjects.some((s) => s.code === c.subjectCode)) &&
                " — tap a code to open the subject"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.changes.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No changes recorded yet</p>
            ) : (
              <>
                <ul className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
                  {(showAllChanges ? data.changes : data.changes.slice(0, 8)).map((c) => (
                    <ChangeRow
                      key={c.id}
                      c={c}
                      /* Only rows whose subject still exists are clickable — a code that
                         no longer matches a live subject would open nothing (honest affordance). */
                      onOpen={
                        c.subjectCode && data.subjects.some((s) => s.code === c.subjectCode)
                          ? setSelectedCode
                          : undefined
                      }
                    />
                  ))}
                </ul>
                {data.changes.length > 8 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 h-7 w-full gap-1 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setShowAllChanges((v) => !v)}
                    aria-expanded={showAllChanges}
                  >
                    {showAllChanges ? (
                      <>Show less</>
                    ) : (
                      <>
                        Show all {data.changes.length} events <ChevronRight className="size-3.5" aria-hidden="true" />
                      </>
                    )}
                  </Button>
                )}
              </>
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
              <>
                <ul className="max-h-96 space-y-1 overflow-y-auto pr-1">
                  {(showAllNotifs ? data.notifications : data.notifications.slice(0, 5)).map((n) => (
                    <NotificationRow key={n.id} n={n} />
                  ))}
                </ul>
                {data.notifications.length > 5 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 h-7 w-full gap-1 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setShowAllNotifs((v) => !v)}
                    aria-expanded={showAllNotifs}
                  >
                    {showAllNotifs ? (
                      <>Show less</>
                    ) : (
                      <>
                        Show all {data.notifications.length} <ChevronRight className="size-3.5" aria-hidden="true" />
                      </>
                    )}
                  </Button>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </motion.div>
  );
}
