"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  format,
  formatDistanceToNowStrict,
  isToday,
  isTomorrow,
  isBefore,
  startOfDay,
} from "date-fns";
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  FlaskConical,
  Upload,
  FileText,
  Mic,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
  SkipForward,
  Loader2,
  BellRing,
  Layers,
  UserCheck,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AttendanceStatus, ChangeKind, ReminderSource, ReminderType } from "./types";
import { AnimatedNumber } from "./trend-chart";

/* ------------------------------------------------------------------ */
/* Time helpers                                                        */
/* ------------------------------------------------------------------ */

/** Ticking timestamp so relative labels ("2 min ago") stay fresh. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Humanized countdown for class chips: "45 min", "1h 15m", "2h".
 *  Raw "in 490 min" reads like a spreadsheet; h/m reads like a clock.
 *  Under an hour stays "N min" (no "0h 45m" nonsense); exact hours drop
 *  the zero minutes. Display-only — the SMS bubble keeps raw ASCII. */
export function humanizeMins(mins: number): string {
  const m = Math.max(0, Math.floor(mins));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`;
}

const IST_DAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** The student's clock is IST (Asia/Kolkata) no matter what timezone the
 *  DEVICE runs in — a parent checking from abroad or a UTC-server browser
 *  must still see the same "ongoing / next / done" states as the student
 *  in India. Returns the IST weekday index (0=Sun) and minutes-since-IST-
 *  midnight for one instant. Pure — tests pin UTC instants against it.
 *  Used by every surface that renders schedule states (timetable card,
 *  week plan); the today-card's istParts is the display cousin of this. */
export function istNow(now: number): { day: number; min: number } {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(now));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  // Some ICU builds render midnight as "24" — fold it back to 00:00.
  const h = Number(get("hour")) % 24;
  const day = IST_DAY_INDEX[get("weekday")];
  return {
    day: Number.isFinite(day) ? day : new Date(now).getDay(),
    min: h * 60 + Number(get("minute")),
  };
}

/* ------------------------------------------------------------------ */
/* Timetable conflict helper (client-side preview)                     */
/* ------------------------------------------------------------------ */

/** Deterministic hue (0–359) for a subject code — stable across reloads and tabs. */
export function subjectHue(code: string): number {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) % 360;
  return h;
}

/** hsl() color pair for a code: [solid, 10%-alpha background] e.g. for badges and dots. */
export function hueColors(code: string): { fg: string; bg: string } {
  const h = subjectHue(code);
  return { fg: `hsl(${h} 65% 40%)`, bg: `hsl(${h} 70% 50% / 0.12)` };
}

export interface LocalSlotConflict {
  subjectCode: string;
  startMin: number;
  endMin: number;
}

/**
 * Slots already scheduled in the same day/time window (pure function so both
 * timetable forms can preview conflicts live while the user types).
 */
export function findSlotConflicts(
  slots: { id: string; dayOfWeek: number; startMin: number; endMin: number; subjectCode: string }[],
  dayOfWeek: number,
  startMin: number,
  endMin: number
): LocalSlotConflict[] {
  return slots
    .filter((s) => s.dayOfWeek === dayOfWeek && startMin < s.endMin && endMin > s.startMin)
    .map((s) => ({ subjectCode: s.subjectCode, startMin: s.startMin, endMin: s.endMin }))
    .sort((a, b) => a.startMin - b.startMin);
}

export function minutesFromHHMMClient(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

export function fmtDT(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return format(d, "d MMM, h:mm a");
}

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return format(d, "d MMM yyyy");
}

export function ago(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "never";
  return formatDistanceToNowStrict(d, { addSuffix: true });
}

export function fmtPct2(n: number): string {
  return `${n.toFixed(2)}%`;
}

export function isOverdue(iso: string, now: number = Date.now()): boolean {
  return new Date(iso).getTime() < now;
}

/* ------------------------------------------------------------------ */
/* ERP portal deep links (read-only hand-off — the app never writes)   */
/* ------------------------------------------------------------------ */

/**
 * Base URL of the student portal. Deep links are built from the SAME ids the
 * live parser scraped, so every link points at a real ERP page.
 */
export const ERP_BASE = "https://erp.gmiu.edu.in";

/**
 * URL of the ERP assignment detail page for an ALA row, derived from its
 * externalId (`erp:assign:{numericId}` — the id the parser scraped from the
 * row's own link). Returns null for anything that is not a verifiably real
 * ERP assignment row (personal reminders, malformed ids) — no guessed links.
 */
export function erpAssignmentUrl(externalId: string | null | undefined): string | null {
  if (!externalId?.startsWith("erp:assign:")) return null;
  const id = externalId.slice("erp:assign:".length);
  return /^\d+$/.test(id) ? `${ERP_BASE}/student/assignment/${id}` : null;
}

/* ------------------------------------------------------------------ */
/* Per-subject ALA deadline stats (row chips → drawer deadlines)        */
/* ------------------------------------------------------------------ */

export interface SubjectAlaStat {
  /** Open (ACTIVE) ALA/assignment rows linked to the subject. */
  open: number;
  /** How many of those are already past due. */
  overdue: number;
}

/**
 * Map normalized subject name → ALA deadline stats. ALA rows carry real ERP
 * course codes (BETCE15315) while tracked subjects use slug codes, so matching
 * goes through the synced `courseNames` (code → name) map — same bridge the
 * subject drawer uses. Structural row typing keeps this decoupled from the
 * full Reminder model.
 */
export function collectAlaStats(
  assignments: { subjectCode: string | null; status: string; dueAt: string }[] | undefined,
  courseNames: Record<string, string> | undefined,
  now: number
): Map<string, SubjectAlaStat> {
  const map = new Map<string, SubjectAlaStat>();
  if (!assignments?.length || !courseNames) return map;
  // code → normalized subject name (drop entries that resolve to nothing)
  const nameByCode = new Map<string, string>();
  for (const [code, name] of Object.entries(courseNames)) {
    const n = (name ?? "").trim().toLowerCase();
    if (n) nameByCode.set(code, n);
  }
  for (const a of assignments) {
    if (a.status !== "ACTIVE" || !a.subjectCode) continue;
    const key = nameByCode.get(a.subjectCode);
    if (!key) continue;
    const stat = map.get(key) ?? { open: 0, overdue: 0 };
    stat.open += 1;
    if (new Date(a.dueAt).getTime() < now) stat.overdue += 1;
    map.set(key, stat);
  }
  return map;
}

/** Compact "N ALAs" chip — amber when any are overdue, muted otherwise. */
export function AlaStatChip({
  stat,
  className,
}: {
  stat: SubjectAlaStat | undefined;
  className?: string;
}) {
  if (!stat || stat.open <= 0) return null;
  const hot = stat.overdue > 0;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums transition-colors",
        hot
          ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
          : "bg-muted text-muted-foreground",
        className
      )}
      title={`${stat.open} open ALA/assignment deadline${stat.open === 1 ? "" : "s"}${
        hot ? ` · ${stat.overdue} overdue` : ""
      } — open the subject for the full list`}
    >
      {hot && <span className="size-1 rounded-full bg-amber-500" aria-hidden="true" />}
      {stat.open} {stat.open === 1 ? "ALA" : "ALAs"}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Status colors (emerald / amber / red — never blue)                  */
/* ------------------------------------------------------------------ */

export interface StatusColors {
  text: string;
  bg: string;
  border: string;
  bar: string;
  chip: string;
}

export function statusColors(status: AttendanceStatus): StatusColors {
  switch (status) {
    case "safe":
      return {
        text: "text-emerald-600 dark:text-emerald-400",
        bg: "bg-emerald-500/10",
        border: "border-emerald-500/30",
        bar: "bg-emerald-500",
        chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      };
    case "warning":
      return {
        text: "text-amber-600 dark:text-amber-400",
        bg: "bg-amber-500/10",
        border: "border-amber-500/30",
        bar: "bg-amber-500",
        chip: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
      };
    case "danger":
      return {
        text: "text-red-600 dark:text-red-400",
        bg: "bg-red-500/10",
        border: "border-red-500/30",
        bar: "bg-red-500",
        chip: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
      };
    default:
      return {
        text: "text-muted-foreground",
        bg: "bg-muted",
        border: "border-border",
        bar: "bg-muted-foreground/40",
        chip: "border-border bg-muted text-muted-foreground",
      };
  }
}

export function StatusChip({
  status,
  target,
  className,
}: {
  status: AttendanceStatus;
  target: number;
  className?: string;
}) {
  const c = statusColors(status);
  const label =
    status === "safe"
      ? "On track ✓"
      : status === "warning"
        ? "Below target ⚠"
        : status === "danger"
          ? "At risk ✗"
          : "No data";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        c.chip,
        className
      )}
      title={`Target ${target}%`}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", c.bar)} aria-hidden="true" />
      {label}
    </span>
  );
}

/** Tiny amber chip marking a subject that uses its own attendance target. */
export function CustomTargetChip({
  target,
  className,
}: {
  target: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400",
        className
      )}
      title={`This subject uses a custom target of ${target}% (differs from the global target)`}
    >
      <Target className="size-2.5" aria-hidden="true" />
      target {target}% · custom
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Skip-budget pips                                                     */
/* ------------------------------------------------------------------ */

/**
 * Skip-budget pip strip — one filled emerald dot per class the student could
 * still miss while staying at/above the target (classesCanSkip). Counts above
 * `max` collapse to `max` dots plus an exact "×N" suffix, so a fat budget
 * (e.g. 23) never blows up a row layout. `count === 0` renders a single hollow
 * amber pip: the subject has zero slack, so ANY miss drops it below target.
 *
 * Callers decide visibility by status — only render for `safe` subjects whose
 * status is known (non-safe rows already carry a "needs N classes" hint, and
 * no-data rows have no budget at all). Staggered pop-in via framer-motion is
 * a subtle entrance detail consistent with the rest of the dashboard.
 */
export function SkipPips({
  count,
  title,
  max = 6,
  className,
}: {
  /** Remaining skip budget (classesCanSkip). 0 = no buffer (hollow pip). */
  count: number;
  /** Full-sentence tooltip — the exact math lives here, not in the dots. */
  title: string;
  /** Dots shown before collapsing to dots + "×N". */
  max?: number;
  className?: string;
}) {
  const dots = count > 0 ? Math.min(count, max) : 1;
  const overflow = count > max ? count : null;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-[3px] align-middle", className)}
      title={title}
      role="img"
      aria-label={title}
    >
      {Array.from({ length: dots }).map((_, i) =>
        count > 0 ? (
          <motion.span
            key={i}
            className="size-1.5 rounded-full bg-emerald-500"
            initial={{ opacity: 0, scale: 0.3 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25, delay: Math.min(i * 0.035, 0.25), ease: "easeOut" }}
            aria-hidden="true"
          />
        ) : (
          <span
            key={i}
            className="size-1.5 rounded-full border border-amber-500/70 bg-amber-500/15"
            aria-hidden="true"
          />
        )
      )}
      {overflow != null && (
        <span className="ml-0.5 text-[10px] font-semibold leading-none text-emerald-700 dark:text-emerald-400">
          ×{overflow}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Animated progress ring                                              */
/* ------------------------------------------------------------------ */

export function ProgressRing({
  percentage,
  target,
  size = 140,
  stroke = 11,
  showTarget = true,
  animated = false,
}: {
  percentage: number;
  target: number;
  size?: number;
  stroke?: number;
  showTarget?: boolean;
  animated?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, percentage));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color =
    pct >= target
      ? "var(--color-emerald-500, #10b981)"
      : pct >= target - 5
        ? "var(--color-amber-500, #f59e0b)"
        : "var(--color-red-500, #ef4444)";

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          stroke={color}
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct / 100) }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="font-semibold tracking-tight tabular-nums text-foreground"
          style={{ fontSize: size * 0.2 }}
        >
          {animated ? <AnimatedNumber value={percentage} suffix="%" /> : fmtPct2(percentage)}
        </span>
        {showTarget && (
          <span className="text-muted-foreground" style={{ fontSize: size * 0.085 }}>
            target {target}%
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Simple colored progress bar                                         */
/* ------------------------------------------------------------------ */

export function MiniBar({
  percentage,
  status,
  className,
  shimmer = false,
  target,
}: {
  percentage: number;
  status: AttendanceStatus;
  className?: string;
  shimmer?: boolean;
  /** Optional attendance target (%) — draws a faint dashed tick on the bar. */
  target?: number;
}) {
  const c = statusColors(status);
  const showTick =
    typeof target === "number" && target > 0 && target > percentage && target < 100;
  return (
    <div className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)}>
      <motion.div
        className={cn("h-full rounded-full", c.bar, shimmer && "erp-shimmer")}
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(0, Math.min(100, percentage))}%` }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      />
      {showTick && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 w-px border-l border-dashed border-foreground/45"
          style={{ left: `${target}%` }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

export const REMINDER_TYPE_META: Record<
  ReminderType,
  { icon: React.ElementType; label: string; className: string }
> = {
  EXAM: { icon: BookOpen, label: "Exam", className: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" },
  PRACTICAL_EXAM: { icon: FlaskConical, label: "Practical exam", className: "text-teal-700 dark:text-teal-400 bg-teal-500/10" },
  VIVA: { icon: Mic, label: "Viva", className: "text-amber-700 dark:text-amber-400 bg-amber-500/10" },
  ASSIGNMENT: { icon: FileText, label: "Assignment", className: "text-stone-700 dark:text-stone-300 bg-stone-500/15" },
  SUBMISSION: { icon: Upload, label: "Submission", className: "text-orange-700 dark:text-orange-400 bg-orange-500/10" },
  ATTENDANCE_WARNING: { icon: AlertTriangle, label: "Attendance warning", className: "text-amber-700 dark:text-amber-400 bg-amber-500/15" },
  OTHER: { icon: CalendarClock, label: "Other", className: "text-muted-foreground bg-muted" },
};

export function TypeIcon({ type, className }: { type: ReminderType; className?: string }) {
  const meta = REMINDER_TYPE_META[type] ?? REMINDER_TYPE_META.OTHER;
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg",
        meta.className,
        className
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
    </span>
  );
}

export function typeLabel(type: ReminderType): string {
  return REMINDER_TYPE_META[type]?.label ?? "Other";
}

export function SourceBadge({ source }: { source: ReminderSource }) {
  if (source === "ERP") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
        ERP
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
      Personal
    </span>
  );
}

const CHANGE_KIND_META: Record<ChangeKind, { icon: React.ElementType; className: string }> = {
  ATTENDANCE_UPDATED: { icon: RefreshCw, className: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" },
  SUBJECT_ADDED: { icon: Plus, className: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" },
  SUBJECT_REMOVED: { icon: Trash2, className: "text-red-600 dark:text-red-400 bg-red-500/10" },
  REMINDER_UPSERTED: { icon: CalendarClock, className: "text-amber-700 dark:text-amber-400 bg-amber-500/10" },
  REMINDER_DATE_CHANGED: { icon: CalendarClock, className: "text-amber-700 dark:text-amber-400 bg-amber-500/10" },
  REMINDER_REMOVED: { icon: XCircle, className: "text-red-600 dark:text-red-400 bg-red-500/10" },
};

export function kindLabel(kind: ChangeKind): string {
  return kind
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function KindIcon({ kind }: { kind: ChangeKind }) {
  const meta = CHANGE_KIND_META[kind] ?? CHANGE_KIND_META.REMINDER_UPSERTED;
  const Icon = meta.icon;
  return (
    <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md", meta.className)}>
      <Icon className="size-3.5" aria-hidden="true" />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Stat card / empty hero / skeletons                                  */
/* ------------------------------------------------------------------ */

export function StatCard({
  icon: Icon,
  label,
  value,
  tone = "default",
  children,
  onClick,
  ariaLabel,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  tone?: "default" | "amber" | "emerald";
  /** Optional footer detail (mini-bars, breakdown captions) below the number. */
  children?: React.ReactNode;
  /** When set, the whole card becomes an accessible button (deep link to a tab). */
  onClick?: () => void;
  ariaLabel?: string;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums transition-transform duration-200 group-hover:scale-[1.03] origin-left">
            {value}
          </p>
        </div>
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 group-hover:scale-110 group-hover:-rotate-3",
            tone === "amber"
              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
              : tone === "emerald"
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-muted text-muted-foreground"
          )}
        >
          <Icon className="size-4.5" aria-hidden="true" />
        </span>
      </div>
      {children != null && <div className="mt-3">{children}</div>}
    </>
  );
  const base =
    "group rounded-xl border border-border/60 bg-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md";
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel ?? String(label)}
        className={cn(
          base,
          "w-full cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:translate-y-0"
        )}
      >
        {inner}
      </button>
    );
  }
  return <div className={base}>{inner}</div>;
}

export const STAT_ICONS = { layers: Layers, alert: AlertTriangle, bell: BellRing, userCheck: UserCheck };

export function EmptyHero({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border/80 bg-card/50 px-6 py-14 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        <RefreshCw className="size-6" aria-hidden="true" />
      </span>
      <div className="space-y-1.5">
        <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>
      </div>
      <button
        type="button"
        onClick={onAction}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RefreshCw className="size-4" aria-hidden="true" />
        {actionLabel}
      </button>
    </div>
  );
}

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border/60 bg-card p-6", className)}>
      <div className="animate-pulse space-y-3">
        <div className="h-4 w-1/3 rounded bg-muted" />
        <div className="h-3 w-2/3 rounded bg-muted" />
        <div className="h-24 w-full rounded bg-muted" />
      </div>
    </div>
  );
}

export function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-border/50 p-3">
          <div className="size-8 shrink-0 animate-pulse rounded-lg bg-muted" />
          <div className="flex-1 animate-pulse space-y-1.5">
            <div className="h-3.5 w-1/2 rounded bg-muted" />
            <div className="h-2.5 w-1/3 rounded bg-muted" />
          </div>
          <div className="h-3 w-12 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

/* Grouping helpers for reminder due dates */
export type DueGroup = "overdue" | "today" | "tomorrow" | "week" | "later" | "done";

export function dueGroup(dueAt: string, status: string, now: number): DueGroup {
  if (status !== "ACTIVE") return "done";
  const d = new Date(dueAt);
  if (isBefore(d, now) && !isToday(d)) return "overdue";
  if (isToday(d)) return "today";
  if (isTomorrow(d)) return "tomorrow";
  const endOfWeek = new Date(startOfDay(now));
  endOfWeek.setDate(endOfWeek.getDate() + 7);
  if (d.getTime() <= endOfWeek.getTime()) return "week";
  return "later";
}

export const GROUP_META: Record<DueGroup, { label: string; className: string }> = {
  overdue: { label: "Overdue", className: "text-red-600 dark:text-red-400" },
  today: { label: "Today", className: "text-emerald-600 dark:text-emerald-400" },
  tomorrow: { label: "Tomorrow", className: "text-foreground" },
  week: { label: "This week", className: "text-foreground" },
  later: { label: "Later", className: "text-foreground" },
  done: { label: "Done", className: "text-muted-foreground" },
};

/* Re-export commonly used log status icon chooser */
export function syncLogIcon(status: string): React.ElementType {
  switch (status) {
    case "success":
      return CheckCircle2;
    case "failed":
      return XCircle;
    case "running":
      return Loader2;
    default:
      return SkipForward;
  }
}
