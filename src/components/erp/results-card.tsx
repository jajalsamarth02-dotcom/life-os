"use client";

/**
 * Academic record — the student's published exam results (Final Results
 * page), parsed from the ERP and TTL-cached server-side. Display-only:
 * this card never writes to the ERP and never touches notifications.
 *
 * Honest-state model (src/lib/results-summary.ts):
 *  - Hero CGPA / credits come from the latest REGULAR exam (the career-
 *    cumulative line); remedial pages only cover re-entered subjects.
 *  - "Pending" = the subject's most recent ERP mention has 0 credit points.
 *    Earlier failures never linger once a later exam clears the subject.
 *  - The SGPA trend draws REGULAR exams; remedial attempts appear as
 *    separate markers so the two can't be confused.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  ChevronDown,
  GraduationCap,
  RefreshCw,
  IdCard,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { compactErrorText } from "@/lib/compact-error";
import {
  attemptHistory,
  cgpaProgression,
  deriveResultsSummary,
  gradeTier,
  projectCgpa,
  type CgpaPoint,
  type PendingSubject,
} from "@/lib/results-summary";
import { fetchResults, qk } from "./api";
import { ago } from "./shared";
import type { ErpResultExam, ErpResultSubjectRow } from "./types";

const TIER_CLASSES: Record<string, string> = {
  top: "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  good: "border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300",
  ok: "border-border bg-muted text-foreground/80",
  weak: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  fail: "border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

function GradeChip({ grade }: { grade: string | null }) {
  if (!grade) {
    return <span className="text-[11px] text-muted-foreground">—</span>;
  }
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-7 items-center justify-center rounded border px-1 font-mono text-[11px] font-semibold leading-none",
        TIER_CLASSES[gradeTier(grade)]
      )}
    >
      {grade}
    </span>
  );
}

/** Tiny CGPA sparkline from the REGULAR exams' printed career CGPA line. */
function CgpaSparkline({ points }: { points: CgpaPoint[] }) {
  if (points.length < 2) return null;
  const W = 96;
  const H = 26;
  const PAD = 3;
  const vals = points.map((p) => p.cgpa);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = Math.max(max - min, 0.8); // never amplify a near-flat line
  const xs = points.map((_, i) => PAD + (i * (W - 2 * PAD)) / (points.length - 1));
  const ys = vals.map((v) => H - PAD - ((v - min) / span) * (H - 2 * PAD));
  const line = xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const area = `${line} L${xs[xs.length - 1].toFixed(1)},${H - PAD} L${xs[0].toFixed(1)},${H - PAD} Z`;
  const last = points.length - 1;
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="mt-1.5"
      role="img"
      aria-label={`CGPA progression: ${vals.map((v) => v.toFixed(2)).join(" → ")}`}
    >
      <defs>
        <linearGradient id="cgpa-spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(139 92 246)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="rgb(139 92 246)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#cgpa-spark-fill)" />
      <path d={line} fill="none" stroke="rgb(139 92 246)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {xs.map((x, i) => (
        <circle
          key={i}
          cx={x}
          cy={ys[i]}
          r={i === last ? 2.2 : 1.5}
          fill="rgb(139 92 246)"
          opacity={i === last ? 1 : 0.65}
        />
      ))}
      <text x={xs[last]} y={ys[last] - 4} textAnchor="end" fontSize="6.5" fill="currentColor" opacity="0.6">
        S{points[last].semester ?? "?"}
      </text>
    </svg>
  );
}

function DeltaChip({ delta }: { delta: number }) {
  const up = delta > 0.0005;
  const down = delta < -0.0005;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
        up
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : down
            ? "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
            : "border-border bg-muted text-muted-foreground"
      )}
    >
      {up && <TrendingUp className="size-3" aria-hidden="true" />}
      {down && <TrendingDown className="size-3" aria-hidden="true" />}
      {up ? "+" : ""}
      {delta.toFixed(2)}
    </span>
  );
}

function VerdictChip({ result }: { result: string | null }) {
  const passed = /pass/i.test(result ?? "");
  const known = result != null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        !known
          ? "border-border bg-muted text-muted-foreground"
          : passed
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            : "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
      )}
    >
      {known && (passed ? <CheckCircle2 className="size-3" aria-hidden="true" /> : <AlertTriangle className="size-3" aria-hidden="true" />)}
      {result ?? "—"}
    </span>
  );
}

/** One expandable exam: summary row + full subject table. */
function ExamRow({ exam, defaultOpen = false }: { exam: ErpResultExam; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const kindLabel = exam.examKind === "REMEDIAL" ? "Remedial" : exam.examKind === "REGULAR" ? "Regular" : "Exam";
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border transition-colors",
        exam.examKind === "REMEDIAL" ? "border-amber-500/25" : "border-border/70",
        open && "bg-muted/30"
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40"
      >
        <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
          S{exam.semester ?? "?"}
        </Badge>
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {kindLabel} · {exam.examSession ?? exam.examDateLabel ?? exam.label}
        </span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
          SGPA {exam.sgpa?.toFixed(2) ?? "—"}
        </span>
        <VerdictChip result={exam.result} />
        <ChevronDown
          className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="space-y-2 border-t px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>{exam.examDateLabel ? `Held ${exam.examDateLabel}` : null}</span>
            {exam.academicYear && <span>AY {exam.academicYear}</span>}
            {exam.seatNo && (
              <span className="inline-flex items-center gap-1">
                <IdCard className="size-3" aria-hidden="true" /> {exam.seatNo}
              </span>
            )}
            <span>
              {exam.earnedCredit ?? "—"}/{exam.offeredCredit ?? "—"} credits this exam
            </span>
            {exam.examKind === "REGULAR" && exam.totalEarnedCredit != null && (
              <span>
                career {exam.totalEarnedCredit}/{exam.totalOfferedCredit} · CGPA {exam.cgpa?.toFixed(2) ?? "—"}
              </span>
            )}
          </div>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="border-b bg-muted/50 text-muted-foreground">
                  <th className="px-2 py-1 font-medium">Subject</th>
                  <th className="px-2 py-1 text-center font-medium">Cr</th>
                  <th className="px-2 py-1 text-center font-medium">Grade</th>
                  <th className="px-2 py-1 text-center font-medium">CP</th>
                </tr>
              </thead>
              <tbody>
                {exam.subjects.map((s: ErpResultSubjectRow) => (
                  <tr
                    key={s.code}
                    className={cn(
                      "border-b last:border-b-0",
                      s.creditPoint === 0 && "bg-rose-500/5"
                    )}
                  >
                    <td className="px-2 py-1">
                      <span className="font-mono text-[10px] text-muted-foreground">{s.code}</span>
                      <span className="ml-1.5">{s.name}</span>
                    </td>
                    <td className="px-2 py-1 text-center tabular-nums">{s.credit ?? "—"}</td>
                    <td className="px-2 py-1 text-center">
                      <GradeChip grade={s.grade} />
                    </td>
                    <td
                      className={cn(
                        "px-2 py-1 text-center font-mono tabular-nums",
                        s.creditPoint === 0 && "font-semibold text-rose-600 dark:text-rose-400"
                      )}
                    >
                      {s.creditPoint ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Component grades (SEE theory/practical, CCE mid/internal/viva) are on the ERP page; CP = credit points
            earned. A 0-CP row means the subject is not cleared yet.
          </p>
        </div>
      )}
    </div>
  );
}

/** One pending subject row + its full published attempt history. */
function PendingItem({ pending, exams }: { pending: PendingSubject; exams: ErpResultExam[] }) {
  const [open, setOpen] = useState(false);
  const history = attemptHistory(exams, pending.code);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="-mx-1 flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs transition-colors hover:bg-amber-500/10"
        title={open ? "Hide every published attempt" : "Show every published attempt"}
      >
        <span className="font-mono text-[10px] text-muted-foreground">{pending.code}</span>
        <span className="min-w-0 flex-1 truncate">{pending.name}</span>
        {history.length > 1 && (
          <span className="shrink-0 rounded border border-amber-500/30 px-1 font-mono text-[9px] tabular-nums text-amber-700 dark:text-amber-300">
            {history.length} tries
          </span>
        )}
        {pending.credit != null && <span className="shrink-0 tabular-nums text-muted-foreground">{pending.credit} cr</span>}
        <GradeChip grade={pending.grade} />
        <span className="hidden shrink-0 text-[10px] text-muted-foreground sm:inline">
          latest: {pending.examDateKey ?? pending.examLabel.slice(0, 24)}
        </span>
        <ChevronDown
          className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="mb-1 ml-1 space-y-1 rounded-md border border-amber-500/20 bg-background/60 px-2 py-1.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Every published attempt
          </p>
          {history.map((h) => (
            <div key={h.typeId} className="flex items-center gap-2 text-[11px]">
              <Badge variant="outline" className="shrink-0 font-mono text-[9px]">
                S{h.semester ?? "?"}
              </Badge>
              <span className="w-14 shrink-0">{h.kind === "REMEDIAL" ? "Remedial" : h.kind === "REGULAR" ? "Regular" : "Exam"}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{h.dateLabel ?? h.dateKey ?? "date not printed"}</span>
              <GradeChip grade={h.grade} />
              <span
                className={cn(
                  "w-9 shrink-0 text-right font-mono tabular-nums",
                  h.creditPoint === 0 && "font-semibold text-rose-600 dark:text-rose-400"
                )}
              >
                {h.creditPoint ?? "—"} CP
              </span>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

export function ResultsCard({ className }: { className?: string }) {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [whatIfSgpa, setWhatIfSgpa] = useState("");
  const [whatIfCredits, setWhatIfCredits] = useState("");
  const query = useQuery({ queryKey: qk.results, queryFn: () => fetchResults() });
  const data = query.data;
  const summary = data ? deriveResultsSummary(data.exams) : null;

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await fetchResults(true);
      queryClient.setQueryData(qk.results, fresh);
      if (fresh.exams.length > 0) toast.success("Exam results refreshed from the ERP");
      else toast.message("No published results on the ERP yet");
    } catch (e) {
      toast.error(`Refresh failed: ${compactErrorText(e instanceof Error ? e.message : String(e), 120)}`);
    } finally {
      setRefreshing(false);
    }
  };

  const creditsPct =
    summary && summary.creditsEarned != null && summary.creditsOffered
      ? Math.min(100, Math.round((summary.creditsEarned / summary.creditsOffered) * 100))
      : null;
  const maxSgpa = Math.max(10, ...(summary?.regularSeries.map((p) => p.sgpa) ?? [0]));
  const progression = data ? cgpaProgression(data.exams) : [];
  const defaultNextCredits = summary?.latestRegular?.offeredCredit ?? null;
  const parsedSgpa = parseFloat(whatIfSgpa);
  const parsedCredits = parseFloat(whatIfCredits) || defaultNextCredits;
  const sgpaValid = whatIfSgpa.trim() !== "" && !isNaN(parsedSgpa) && parsedSgpa >= 0 && parsedSgpa <= 10;
  const creditsValid = parsedCredits != null && parsedCredits > 0;
  const projected =
    summary && sgpaValid && creditsValid
      ? projectCgpa(summary.cgpa, summary.creditsOffered, parsedSgpa, parsedCredits)
      : null;

  return (
    <Card className={cn("overflow-hidden", className)} data-testid="results-card">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-400"
            aria-hidden="true"
          >
            <GraduationCap className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base tracking-tight">Academic record</CardTitle>
            <CardDescription className="text-xs">
              Published exam results from the ERP&apos;s Final Results page — grades, SGPA/CGPA and pending subjects.
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 print:hidden">
            {data?.fetchedAt && (
              <span className="hidden text-[10px] text-muted-foreground sm:inline" title="Last fetched from the ERP">
                {ago(data.fetchedAt)}
              </span>
            )}
            {data?.stale && (
              <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-700 dark:text-amber-300">
                cached
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={onRefresh}
              disabled={refreshing || query.isLoading}
              aria-label="Refresh exam results from the ERP"
            >
              <RefreshCw className={cn("size-3.5", (refreshing || query.isLoading) && "animate-spin")} aria-hidden="true" />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {query.isLoading ? (
          <div className="space-y-2" aria-label="Loading exam results">
            <div className="h-14 animate-pulse rounded-lg bg-muted" />
            <div className="h-16 animate-pulse rounded-lg bg-muted" />
            <div className="h-10 animate-pulse rounded-lg bg-muted" />
          </div>
        ) : !data ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Could not load exam results.</p>
        ) : !data.available ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{data.note ?? "Connect your ERP account in Settings to load exam results."}</p>
        ) : data.exams.length === 0 ? (
          <div className="rounded-lg border border-dashed py-5 text-center">
            <p className="text-sm font-medium">No published results yet</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
              {data.note ?? "The ERP lists no Final Results for your enrollment — the card fills in the moment one is published."}
            </p>
          </div>
        ) : summary ? (
          <>
            {/* hero — latest REGULAR exam is the career line */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-violet-500/20 bg-gradient-to-br from-violet-500/10 via-indigo-500/5 to-transparent px-4 py-3">
              <div>
                <div className="flex items-baseline gap-2">
                  <Award className="size-5 self-center text-violet-500/70" aria-hidden="true" />
                  <span className="text-3xl font-bold tabular-nums tracking-tight text-violet-700 dark:text-violet-300">
                    {summary.cgpa?.toFixed(2) ?? "—"}
                  </span>
                  <div className="leading-tight">
                    <p className="text-sm font-medium">CGPA</p>
                    <p className="text-[11px] text-muted-foreground">
                      {summary.latestRegular?.examDateLabel
                        ? `career line after ${summary.latestRegular.examDateLabel}`
                        : "career cumulative"}
                    </p>
                  </div>
                </div>
                <CgpaSparkline points={progression} />
              </div>
              <div className="min-w-40 flex-1 sm:max-w-56">
                <div className="mb-1 flex items-baseline justify-between text-[11px]">
                  <span className="font-medium tabular-nums">
                    {summary.creditsEarned ?? "—"} / {summary.creditsOffered ?? "—"} credits
                  </span>
                  <span className="tabular-nums text-muted-foreground">{creditsPct != null ? `${creditsPct}%` : ""}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="presentation">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-[width] duration-700"
                    style={{ width: `${creditsPct ?? 0}%` }}
                  />
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  earned / offered · as printed on the latest regular result
                </p>
              </div>
            </div>

            {/* pending backlogs — the honest current state */}
            {summary.pending.length > 0 ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5" data-testid="pending-backlogs">
                <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="size-3.5" aria-hidden="true" />
                  {summary.pending.length} subject{summary.pending.length === 1 ? "" : "s"} not cleared yet
                </p>
                <ul className="mt-1.5 space-y-0.5">
                  {summary.pending.map((p) => (
                    <PendingItem key={p.code} pending={p} exams={data.exams} />
                  ))}
                </ul>
                <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                  Latest ERP mention per subject decides — earlier failures that a later exam cleared are not listed.
                  The next remedial window is where these can be retried.
                </p>
              </div>
            ) : (
              <p className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="size-3.5" aria-hidden="true" />
                No pending backlogs — every published subject result is cleared.
              </p>
            )}

            {/* what-if — honest CGPA projection for the next semester */}
            {summary.hasRecord && summary.cgpa != null && summary.creditsOffered != null && (
              <div
                className="rounded-lg border border-dashed border-violet-500/30 bg-violet-500/5 px-3 py-2.5"
                data-testid="cgpa-whatif"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <TrendingUp className="size-3.5 shrink-0 text-violet-500/70" aria-hidden="true" />
                  <span className="font-medium">What if</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={10}
                    step={0.1}
                    placeholder="SGPA"
                    value={whatIfSgpa}
                    onChange={(e) => setWhatIfSgpa(e.target.value)}
                    aria-label="Projected SGPA for your next semester (0 to 10)"
                    className="h-7 w-16 rounded border border-border bg-background px-1.5 text-center font-mono text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
                  />
                  <span className="text-muted-foreground">next semester with</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={45}
                    step={1}
                    value={whatIfCredits}
                    onChange={(e) => setWhatIfCredits(e.target.value)}
                    placeholder={defaultNextCredits != null ? String(defaultNextCredits) : "cr"}
                    aria-label="Credits you will take next semester"
                    className="h-7 w-14 rounded border border-border bg-background px-1.5 text-center font-mono text-xs tabular-nums outline-none placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-violet-500/40"
                  />
                  <span className="text-muted-foreground">credits —</span>
                  {projected != null && summary.cgpa != null ? (
                    <span className="ml-auto inline-flex items-baseline gap-1.5">
                      <span className="text-[11px] text-muted-foreground">CGPA →</span>
                      <span className="text-lg font-bold tabular-nums tracking-tight text-violet-700 dark:text-violet-300">
                        {projected.toFixed(3)}
                      </span>
                      <DeltaChip delta={projected - summary.cgpa} />
                    </span>
                  ) : (
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {sgpaValid && !creditsValid ? "credits must be 1–45" : "enter a target SGPA (0–10)"}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                  Estimate only — treats the ERP&apos;s career CGPA as cumulative points ÷ offered credits
                  ({summary.cgpa.toFixed(3)} × {summary.creditsOffered}). Your real result follows the
                  university&apos;s exact rules; clearing a pending subject next semester lifts it further.
                </p>
              </div>
            )}

            {/* SGPA trend — REGULAR exams as bars, remedials as markers */}
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                SGPA by semester (regular exams)
              </p>
              {summary.regularSeries.length > 0 ? (
                <div className="flex items-end gap-2" data-testid="sgpa-trend">
                  {summary.regularSeries.map((p) => (
                    <div key={p.typeId} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{p.sgpa.toFixed(2)}</span>
                      <div
                        className="flex w-full max-w-14 items-end justify-center rounded-t-md border-b border-border/60"
                        style={{ height: 64 }}
                        role="presentation"
                      >
                        <div
                          className={cn(
                            "w-full rounded-t-md transition-[height] duration-700",
                            p.passed
                              ? "bg-gradient-to-t from-emerald-500/70 to-emerald-400/80"
                              : "bg-gradient-to-t from-rose-500/70 to-rose-400/80"
                          )}
                          style={{ height: `${Math.max(6, (p.sgpa / maxSgpa) * 100)}%` }}
                          title={`Semester ${p.semester}: SGPA ${p.sgpa.toFixed(2)} (${p.passed ? "Pass" : "Fail"})`}
                        />
                      </div>
                      <span className="text-[10px] font-medium text-muted-foreground">S{p.semester}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No regular exam results parsed yet.</p>
              )}
              {summary.remedialSeries.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5" data-testid="remedial-markers">
                  <span className="text-[10px] text-muted-foreground">Remedial attempts:</span>
                  {summary.remedialSeries.map((p) => (
                    <span
                      key={p.typeId}
                      className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] tabular-nums text-amber-700 dark:text-amber-300"
                      title={`Remedial attempt for semester ${p.semester}: SGPA ${p.sgpa.toFixed(2)} (${p.passed ? "Pass" : "Fail"})`}
                    >
                      ↺ S{p.semester} · {p.sgpa.toFixed(2)}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* per-exam breakdown */}
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">All published results</p>
              {data.exams.map((exam, i) => (
                <ExamRow key={exam.typeId} exam={exam} defaultOpen={i === 0} />
              ))}
            </div>

            {data.note && <p className="text-[10px] text-muted-foreground">{data.note}</p>}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
