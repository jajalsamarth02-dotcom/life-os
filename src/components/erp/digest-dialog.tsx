"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowDownRight,
  ArrowUpRight,
  BellPlus,
  CalendarRange,
  CheckCheck,
  CheckCircle2,
  ClipboardCopy,
  Download,
  FlaskConical,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fetchDigest } from "./api";
import { SourceBadge } from "./shared";
import type { DigestResponse } from "./types";

/* ------------------------------------------------------------------ */
/* Delta chip                                                          */
/* ------------------------------------------------------------------ */

function DeltaChip({ pts, className }: { pts: number | null; className?: string }) {
  if (pts === null) return <span className="text-xs text-muted-foreground">—</span>;
  if (Math.abs(pts) < 0.005) {
    return (
      <span className={cn("rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground", className)}>
        ±0
      </span>
    );
  }
  const up = pts > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
        up ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400",
        className
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {Math.abs(pts).toFixed(2)} pts
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function buildSummary(d: DigestResponse): string {
  const range = `${format(new Date(d.window.from), "d MMM")} – ${format(new Date(d.window.to), "d MMM yyyy")}`;
  const lines: string[] = [];
  lines.push(`ERP Sync — ${d.days}-day report (${range})`);
  if (d.overall) {
    lines.push(
      `Overall attendance: ${d.overall.pctStart?.toFixed(2) ?? "—"}% → ${d.overall.pctEnd?.toFixed(2) ?? "—"}% (${d.overall.deltaPts && d.overall.deltaPts >= 0 ? "+" : ""}${d.overall.deltaPts?.toFixed(2) ?? "0"} pts)`
    );
    lines.push(
      `Classes held: ${d.overall.held} · attended: ${d.overall.attended} · missed: ${d.overall.missed}`
    );
  }
  lines.push(`Sync runs: ${d.syncs.success} ok / ${d.syncs.failed} failed (${d.syncs.total} total)`);
  lines.push(`ERP changes detected: ${d.changes}`);
  lines.push(`Reminders: ${d.reminders.created} created, ${d.reminders.completed} completed`);
  if (d.upcoming.length > 0) {
    lines.push("Upcoming:");
    for (const u of d.upcoming.slice(0, 5)) {
      lines.push(`  • ${format(new Date(u.dueAt), "d MMM h:mm a")} — ${u.title} (${u.source})`);
    }
  }
  return lines.join("\n");
}

function downloadCsv(d: DigestResponse) {
  const esc = (v: string | number | null) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows: string[][] = [
    ["type", "code", "name", "pct_start", "pct_end", "delta_pts", "attended", "held", "missed"],
    ...d.subjects.map((s) => [
      "subject",
      s.code,
      s.name,
      s.pctStart?.toFixed(2) ?? "",
      s.pctEnd?.toFixed(2) ?? "",
      s.deltaPts?.toFixed(2) ?? "",
      String(s.attended),
      String(s.held),
      String(s.missed),
    ]),
  ];
  if (d.overall) {
    rows.push([
      "overall",
      "__overall__",
      "All subjects",
      d.overall.pctStart?.toFixed(2) ?? "",
      d.overall.pctEnd?.toFixed(2) ?? "",
      d.overall.deltaPts?.toFixed(2) ?? "",
      String(d.overall.attended),
      String(d.overall.held),
      String(d.overall.missed),
    ]);
  }
  const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `erp-sync-report-${d.days}d-${format(new Date(), "yyyy-MM-dd")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/* Activity stat tile                                                  */
/* ------------------------------------------------------------------ */

function ActivityTile({
  icon: Icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  tone?: "default" | "emerald" | "amber" | "red";
}) {
  const toneCls =
    tone === "emerald"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : tone === "amber"
        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : tone === "red"
          ? "bg-red-500/10 text-red-600 dark:text-red-400"
          : "bg-muted text-muted-foreground";
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border/50 p-2.5">
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", toneCls)}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-lg font-semibold leading-none tabular-nums">{value}</p>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub ?? label}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main dialog                                                         */
/* ------------------------------------------------------------------ */

export function WeeklyDigestDialog({
  open,
  onOpenChange,
  demoMode,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  demoMode: boolean;
}) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["digest", 7],
    queryFn: () => fetchDigest(7),
    enabled: open,
    staleTime: 60_000,
  });

  const copySummary = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(buildSummary(data));
      toast.success("Report copied to clipboard");
    } catch {
      toast.error("Clipboard unavailable in this browser");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="erp-card-accent max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base tracking-tight">
            <CalendarRange className="size-4 text-emerald-500" aria-hidden="true" />
            Weekly report
            {demoMode && (
              <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-700 dark:text-amber-400">
                <FlaskConical className="size-3" aria-hidden="true" /> DEMO DATA
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {data
              ? `${format(new Date(data.window.from), "d MMM")} – ${format(new Date(data.window.to), "d MMM yyyy")} · computed from your synchronized mirror`
              : "Computed from your synchronized mirror"}
          </DialogDescription>
        </DialogHeader>

        {isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : isError || !data ? (
          <p className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-600 dark:text-red-400">
            Could not build the report: {error?.message ?? "unknown error"}
          </p>
        ) : (
          <div className="space-y-4">
            {/* Overall movement */}
            {data.overall ? (
              <div className="rounded-xl border border-border/60 bg-gradient-to-br from-emerald-500/[0.06] to-transparent p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">Overall attendance</p>
                  <DeltaChip pts={data.overall.deltaPts} />
                </div>
                <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">
                  {data.overall.pctEnd?.toFixed(2) ?? "—"}
                  <span className="text-sm font-medium text-muted-foreground">
                    {" "}
                    %{" "}
                    <span className="text-muted-foreground/70">
                      (was {data.overall.pctStart?.toFixed(2) ?? "—"}%)
                    </span>
                  </span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {data.overall.held === 0
                    ? "No classes recorded in this window"
                    : `${data.overall.attended} attended of ${data.overall.held} held · ${data.overall.missed} missed`}
                </p>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border/70 p-4 text-center text-sm text-muted-foreground">
                Not enough history yet — the report needs at least two synced snapshots in the window.
              </p>
            )}

            {/* Per-subject movement */}
            {data.subjects.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  By subject
                </p>
                <div className="max-h-56 overflow-y-auto rounded-lg border border-border/50">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <tr className="border-b border-border/60">
                        <th className="px-3 py-2 font-medium">Subject</th>
                        <th className="px-3 py-2 text-right font-medium">Now</th>
                        <th className="px-3 py-2 text-right font-medium">Δ 7d</th>
                        <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Held</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.subjects.map((s) => (
                        <tr key={s.code} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
                          <td className="max-w-40 px-3 py-2">
                            <p className="truncate font-medium">{s.name}</p>
                            <p className="font-mono text-[10px] text-muted-foreground">{s.code}</p>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{s.pctEnd?.toFixed(2) ?? "—"}%</td>
                          <td className="px-3 py-2 text-right">
                            <DeltaChip pts={s.deltaPts} />
                          </td>
                          <td className="hidden px-3 py-2 text-right text-xs text-muted-foreground tabular-nums sm:table-cell">
                            {s.held > 0 ? `${s.attended}/${s.held}` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Activity */}
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Activity
              </p>
              <div className="grid grid-cols-2 gap-2">
                <ActivityTile
                  icon={RefreshCw}
                  label="Sync runs"
                  value={data.syncs.total}
                  sub={`${data.syncs.success} ok · ${data.syncs.failed} failed`}
                  tone={data.syncs.failed > 0 ? "amber" : "emerald"}
                />
                <ActivityTile
                  icon={CheckCircle2}
                  label="ERP changes"
                  value={data.changes}
                  sub="changes detected"
                />
                <ActivityTile
                  icon={BellPlus}
                  label="Reminders created"
                  value={data.reminders.created}
                  sub="reminders created"
                />
                <ActivityTile
                  icon={CheckCheck}
                  label="Reminders completed"
                  value={data.reminders.completed}
                  sub="reminders completed"
                  tone="emerald"
                />
              </div>
            </div>

            {/* Upcoming */}
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Next {data.days} days
              </p>
              {data.upcoming.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border/70 py-4 text-center text-sm text-muted-foreground">
                  Nothing scheduled — you're all clear ✓
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {data.upcoming.map((u) => (
                    <li
                      key={u.id}
                      className="flex items-center gap-2.5 rounded-lg border border-border/50 px-3 py-2 transition-colors hover:bg-muted/40"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{u.title}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {format(new Date(u.dueAt), "EEE d MMM, h:mm a")}
                        </p>
                      </div>
                      <SourceBadge source={u.source === "ERP" ? "ERP" : "PERSONAL"} />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <Separator />

            {/* Actions */}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" className="flex-1 gap-1.5" onClick={copySummary} disabled={!data}>
                <ClipboardCopy className="size-4" aria-hidden="true" />
                Copy summary
              </Button>
              <Button variant="outline" className="flex-1 gap-1.5" onClick={() => data && downloadCsv(data)} disabled={!data}>
                <Download className="size-4" aria-hidden="true" />
                Download CSV
              </Button>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Totals come from sync-time snapshots of the ERP mirror. Class counts are derived from changes between
              snapshots, so partial histories are shown honestly rather than estimated.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
