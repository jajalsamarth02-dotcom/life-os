"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { format } from "date-fns";
import { CalendarCheck, Flame, Trophy, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { HistoryPoint, HistoryResponse } from "./types";

/* ------------------------------------------------------------------ */
/* Milestone math (pure)                                               */
/* ------------------------------------------------------------------ */

export interface MilestoneStats {
  /** Best overall snapshot ever recorded (ties → earliest). */
  best: HistoryPoint | null;
  /** First snapshot time (ISO) — "tracking since". */
  since: string | null;
  /** Distinct device-local days whose LAST snapshot that day was ≥ target. */
  daysAtTarget: number;
  /** Consecutive most-recent data days at/above target (0 when below now). */
  streak: number;
  snapshots: number;
}

function dayKeyOf(iso: string): string {
  return format(new Date(iso), "yyyy-MM-dd");
}

export function computeMilestones(history: HistoryResponse | undefined, target: number): MilestoneStats {
  const pts = history?.overall ?? [];
  if (pts.length === 0) {
    return { best: null, since: null, daysAtTarget: 0, streak: 0, snapshots: 0 };
  }
  const sorted = [...pts].sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());

  // Last snapshot per local day
  const dayLast = new Map<string, HistoryPoint>();
  for (const p of sorted) dayLast.set(dayKeyOf(p.t), p);
  const days = [...dayLast.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));

  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i][1].percentage >= target) streak++;
    else break;
  }

  let best = sorted[0];
  for (const p of sorted) if (p.percentage > best.percentage) best = p;

  return {
    best,
    since: sorted[0].t,
    daysAtTarget: days.filter(([, p]) => p.percentage >= target).length,
    streak,
    snapshots: sorted.length,
  };
}

/* ------------------------------------------------------------------ */
/* Milestones strip (dashboard)                                        */
/* ------------------------------------------------------------------ */

export function MilestonesStrip({
  history,
  overallPct,
  target,
}: {
  history: HistoryResponse | undefined;
  overallPct: number;
  target: number;
}) {
  const stats = React.useMemo(() => computeMilestones(history, target), [history, target]);
  if (stats.snapshots === 0 || !stats.best) return null;

  const bestPct = Math.max(stats.best.percentage, overallPct);
  const atTarget = overallPct >= target;

  return (
    <Card className="erp-card-accent rounded-xl border-border/60 transition-shadow hover:shadow-md">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4">
        <p className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Trophy className="size-3.5 text-amber-500" aria-hidden="true" />
          Milestones
        </p>
        <div className="grid flex-1 gap-2 sm:grid-cols-3">
          <div
            className="flex items-center gap-2.5 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2"
            title="Your highest overall attendance ever recorded by the tracker"
          >
            <Trophy className="size-4 shrink-0 text-amber-500" aria-hidden="true" />
            <div className="min-w-0 leading-tight">
              <p className="text-sm font-semibold tabular-nums">
                {bestPct.toFixed(2)}%
                <span className="ml-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  best ever
                </span>
              </p>
              <p className="truncate text-[10px] text-muted-foreground">
                {stats.since ? `tracking since ${format(new Date(stats.since), "d MMM yyyy")}` : "—"}
              </p>
            </div>
          </div>

          <div
            className="flex items-center gap-2.5 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2"
            title="Distinct days whose final snapshot was at or above your target"
          >
            <CalendarCheck className="size-4 shrink-0 text-emerald-500" aria-hidden="true" />
            <div className="min-w-0 leading-tight">
              <p className="text-sm font-semibold tabular-nums">
                {stats.daysAtTarget}
                <span className="ml-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {stats.daysAtTarget === 1 ? "day" : "days"} at target
                </span>
              </p>
              <p className="truncate text-[10px] text-muted-foreground">days ending ≥ {target}%</p>
            </div>
          </div>

          <div
            className={cn(
              "flex items-center gap-2.5 rounded-lg border px-3 py-2",
              stats.streak > 0
                ? "border-orange-500/25 bg-orange-500/[0.06]"
                : "border-border/60 bg-muted/40"
            )}
            title="Consecutive most-recent sync days at or above the target"
          >
            <Flame
              className={cn("size-4 shrink-0", stats.streak > 0 ? "text-orange-500" : "text-muted-foreground/50")}
              aria-hidden="true"
            />
            <div className="min-w-0 leading-tight">
              <p className="text-sm font-semibold tabular-nums">
                {stats.streak}
                <span className="ml-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  day streak
                </span>
              </p>
              <p className="truncate text-[10px] text-muted-foreground">
                {stats.streak > 0 ? "at/above target in a row" : atTarget ? "— just crossed today" : "below target right now"}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Celebration overlay                                                 */
/* ------------------------------------------------------------------ */

const CONFETTI_COLORS = ["#10b981", "#f59e0b", "#84cc16", "#f97316", "#14b8a6", "#facc15"];

type CelebrationKind = "target" | "best";

const STORE_KEY = "erp-milestone-v1";

interface MilestoneStore {
  /** Marker of the last seen below-target state (null = currently at/above). */
  lastBelow: string | null;
  /** Best overall % already celebrated. */
  lastBest: number;
  /** Timestamp of the last celebration (throttle). */
  lastTs: number;
}

function readStore(): MilestoneStore {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<MilestoneStore>;
      return {
        lastBelow: typeof p.lastBelow === "string" ? p.lastBelow : null,
        lastBest: typeof p.lastBest === "number" ? p.lastBest : 0,
        lastTs: typeof p.lastTs === "number" ? p.lastTs : 0,
      };
    }
  } catch {
    // corrupted store — start fresh
  }
  return { lastBelow: undefined as unknown as string | null, lastBest: 0, lastTs: 0 };
}

function writeStore(s: MilestoneStore): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    // storage unavailable — celebrations may re-fire next visit; harmless
  }
}

const CELEBRATION_META: Record<CelebrationKind, { emoji: string; title: string; sub: string }> = {
  target: { emoji: "🏆", title: "Target reached!", sub: "Your overall attendance is at or above your target. Keep it up!" },
  best: { emoji: "📈", title: "New personal best!", sub: "Your overall attendance climbed to a new all-time high." },
};

export function MilestoneCelebration({
  overallPct,
  present,
  total,
  target,
  history,
}: {
  overallPct: number;
  present: number;
  total: number;
  target: number;
  history: HistoryResponse | undefined;
}) {
  const [kind, setKind] = React.useState<CelebrationKind | null>(null);
  const dataKey = `${present}-${total}-${target}-${history?.overall?.length ?? 0}`;

  /* QA/demo hook: visiting /#qa-celebrate previews the overlay once (also used
     by automated QA — no data is modified). Listens for hashchange too, so it
     works on a live page without a reload. */
  React.useEffect(() => {
    const check = () => {
      if (window.location.hash === "#qa-celebrate") {
        setKind("target");
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);

  /* Celebration state machine — runs once per data change.
     Rules:
     - Target crossed (below → at/above, incl. first run): fire TARGET once.
     - New all-time best: fire BEST only for a REAL improvement over the
       earliest snapshot (never for the flat baseline) and at most every 12h;
       suppressed in the same update as a target celebration. */
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const store = readStore();
    const isFirstRun = store.lastBelow === undefined;
    const crossed = overallPct >= target;
    const now = Date.now();
    let fire: CelebrationKind | null = null;
    const next: MilestoneStore = { ...store };

    if (crossed) {
      if (isFirstRun || store.lastBelow != null) fire = "target";
      next.lastBelow = null;
    } else {
      next.lastBelow = `${present}-${total}`;
    }

    const stats = computeMilestones(history, target);
    const baseline = stats.since && history?.overall?.length
      ? [...history.overall].sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime())[0].percentage
      : 0;
    if (stats.best && stats.best.percentage > next.lastBest + 0.001) {
      const realImprovement = !isFirstRun && stats.best.percentage > baseline + 0.001;
      if (fire === null && realImprovement && stats.best.percentage < target && now - next.lastTs > 12 * 3600 * 1000) {
        fire = "best";
      }
      next.lastBest = stats.best.percentage;
    }

    writeStore(next);
    if (fire) {
      next.lastTs = now;
      writeStore(next);
      setKind(fire);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);

  /* Auto-dismiss */
  React.useEffect(() => {
    if (!kind) return;
    const id = setTimeout(() => setKind(null), 4600);
    return () => clearTimeout(id);
  }, [kind]);

  return (
    <AnimatePresence>
      {kind && (
        <CelebrationOverlay
          kind={kind}
          pct={overallPct}
          target={target}
          onDismiss={() => setKind(null)}
        />
      )}
    </AnimatePresence>
  );
}

function CelebrationOverlay({
  kind,
  pct,
  target,
  onDismiss,
}: {
  kind: CelebrationKind;
  pct: number;
  target: number;
  onDismiss: () => void;
}) {
  /* Client-only burst — safe to randomize here. */
  const pieces = React.useMemo(
    () =>
      Array.from({ length: 30 }, (_, i) => ({
        id: i,
        x: (Math.random() - 0.5) * 340,
        delay: Math.random() * 0.35,
        duration: 1.9 + Math.random() * 1.4,
        rotate: (Math.random() - 0.5) * 540,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        size: 7 + Math.random() * 7,
        round: Math.random() > 0.5,
      })),
    []
  );
  const meta = CELEBRATION_META[kind];

  React.useEffect(() => {
    toast.success(meta.title, { description: `Overall ${pct.toFixed(2)}% · target ${target}%` });
  }, [meta.title, pct, target]);

  return (
    <motion.div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 print:hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onDismiss}
      role="status"
      aria-live="polite"
    >
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" aria-hidden="true" />

      {/* Confetti burst */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {pieces.map((p) => (
          <motion.span
            key={p.id}
            className={p.round ? "rounded-full" : "rounded-[2px]"}
            style={{
              position: "absolute",
              left: "50%",
              top: "42%",
              width: p.size,
              height: p.size * (p.round ? 1 : 0.55),
              backgroundColor: p.color,
            }}
            initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.6 }}
            animate={{ x: p.x, y: 260, opacity: [1, 1, 0.9, 0], rotate: p.rotate, scale: 1 }}
            transition={{ duration: p.duration, delay: p.delay, ease: [0.15, 0.6, 0.45, 1] }}
          />
        ))}
      </div>

      <motion.div
        initial={{ scale: 0.82, y: 14, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.94, y: 8, opacity: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 20 }}
        className="relative w-full max-w-sm rounded-2xl border border-amber-500/40 bg-card p-6 text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onDismiss}
          className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Dismiss celebration"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
        <motion.p
          className="text-5xl"
          initial={{ rotate: -12, scale: 0.7 }}
          animate={{ rotate: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 12, delay: 0.08 }}
          aria-hidden="true"
        >
          {meta.emoji}
        </motion.p>
        <h2 className="mt-3 bg-gradient-to-r from-amber-500 via-orange-500 to-emerald-500 bg-clip-text text-xl font-bold tracking-tight text-transparent">
          {meta.title}
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">{meta.sub}</p>
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
          Overall {pct.toFixed(2)}% <span className="font-normal text-muted-foreground">· target {target}%</span>
        </p>
      </motion.div>
    </motion.div>
  );
}
