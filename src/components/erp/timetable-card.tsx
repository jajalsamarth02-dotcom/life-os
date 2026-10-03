"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronDown,
  CircleDot,
  Clock,
  CloudCog,
  Download,
  GitMerge,
  Loader2,
  Play,
  Settings2,
  Target,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { downloadTimetableIcs } from "@/lib/ics";
import { applyBatchPicks, parallelCells } from "@/lib/batch-picks";
import { createSlot, deleteSlot, fetchTimetable, setBatchPick, qk, ApiError, type SlotConflict } from "./api";
import { humanizeMins, istNow, useNow } from "./shared";
import { IMMINENT_MIN } from "./today-card";
import type { AppMode, AttendanceView, SubjectView, TimetableSlotRow } from "./types";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon → Sun

const CHIP_COLORS = ["#10b981", "#f59e0b", "#84cc16", "#f97316", "#14b8a6", "#a8a29e", "#ef4444"];

function colorForCode(code: string, subjects: SubjectView[]): string {
  const idx = subjects.findIndex((s) => s.code === code);
  return CHIP_COLORS[(idx < 0 ? 0 : idx) % CHIP_COLORS.length];
}

/** The subject drawer deep-link only arms for codes the attendance data
 *  actually knows — a routine slot whose subject has no synced attendance
 *  (an elective before its first class, or a parse-drift code) stays plain
 *  text instead of becoming a dead-end button. Exact-match by design: the
 *  ERP emits uppercase codes, and silently case-folding a mismatch would
 *  mask a real parse drift. Returns the canonical code (drawer key) or null. */
export function knownSubjectCode(code: string, subjects: SubjectView[]): string | null {
  const hit = subjects.find((s) => s.code === code);
  return hit ? hit.code : null;
}

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** Live status label for a slot relative to now — countdowns humanized
 *  (r74): "ends in 1h 5m", not "ends in 65 min" — same language the header
 *  and today-card chips speak since r73. */
function slotStatus(
  slot: TimetableSlotRow,
  nowDay: number,
  nowMin: number
): { key: "ongoing" | "upcoming" | "done" | "other"; label?: string } {
  if (slot.dayOfWeek !== nowDay) return { key: "other" };
  if (nowMin >= slot.startMin && nowMin < slot.endMin) {
    return { key: "ongoing", label: `ends in ${humanizeMins(slot.endMin - nowMin)}` };
  }
  if (nowMin < slot.startMin) {
    return { key: "upcoming", label: `starts in ${humanizeMins(slot.startMin - nowMin)}` };
  }
  return { key: "done" };
}

/* ------------------------------------------------------------------ */

function SlotChip({
  slot,
  color,
  nowDay,
  nowMin,
  compact = false,
  state = "attending",
}: {
  slot: TimetableSlotRow;
  color: string;
  nowDay: number;
  nowMin: number;
  compact?: boolean;
  /** Pick awareness in the full-week grid: alternatives the student didn't
   *  pick and same-batch duplicates are dimmed (counted once either way). */
  state?: "attending" | "alternative" | "duplicate";
}) {
  const st = slotStatus(slot, nowDay, nowMin);
  const ongoing = st.key === "ongoing";
  /* r77: the urgency ladder (r73) now reaches the week-grid chips — an
     upcoming chip inside IMMINENT_MIN tints amber (border + label + title),
     the same "get moving" tone the header and today-card chips flip at
     10 min. IMMINENT_MIN stays the ONE threshold (imported, never
     duplicated), so all three surfaces escalate together. */
  const imminent = st.key === "upcoming" && slot.startMin - nowMin <= IMMINENT_MIN;
  /* r76: the "just ended" bridge (r75, today rows) now reaches the week-grid
     chips — an attending chip within 15 min after its class reads amber, not
     flat-dim, because the record isn't confirmed until the next auto-sync.
     Alternatives/duplicates stay flat-dim: they were never the counted class,
     so "attendance updates on the next sync" would be a false promise. */
  const justEnded =
    state === "attending" && st.key === "done" && isJustEnded(slot.endMin, nowMin);
  return (
    <div
      title={
        state === "alternative"
          ? "You picked a different class for this window — not counted in your plan"
          : state === "duplicate"
            ? "Another batch of the same class — counted once"
            : imminent
              ? "Starting imminently"
              : undefined
      }
      className={cn(
        "group rounded-lg border px-2 py-1.5 text-left transition-colors",
        ongoing
          ? "border-emerald-500/50 bg-emerald-500/10"
          : justEnded
            ? "border-amber-500/30 bg-amber-500/[0.06] opacity-70"
            : st.key === "done"
              ? "border-border/40 bg-muted/30 opacity-55"
              : imminent
                ? "border-amber-500/40 bg-amber-500/[0.04]"
                : "border-border/60 bg-card hover:bg-muted/40",
        state === "alternative" && "border-dashed opacity-50",
        state === "duplicate" && "opacity-45"
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-semibold">{slot.subjectCode}</span>
        {ongoing && <CircleDot className="size-3 shrink-0 animate-pulse text-emerald-500" aria-hidden="true" />}
      </div>
      <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
        {hhmm(slot.startMin)}–{hhmm(slot.endMin)}
      </p>
      {!compact && st.label && (
        <p
          className={cn(
            "mt-0.5 text-[10px] font-medium",
            ongoing
              ? "text-emerald-600 dark:text-emerald-400"
              : imminent
                ? "text-amber-600 dark:text-amber-400"
                : "text-muted-foreground"
          )}
        >
          {st.label}
        </p>
      )}
      {!compact && justEnded && (
        <p
          className="mt-0.5 flex items-center gap-1 text-[10px] font-medium text-amber-600/90 dark:text-amber-400/90"
          title="Class just finished — attendance updates on the next auto-sync (within 15 minutes)"
        >
          <Check className="size-3 shrink-0" aria-hidden="true" /> just ended
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Parallel classes — the "which one do you actually attend?" picker.
 *
 * The ERP routine lists lab groups / batch options as separate rows sharing
 * one wall-time window. Unresolved windows count EVERY option in the week
 * plan (disclosed there); this section resolves them once: tap the class
 * you attend, and the plan, today card, next-class chips and both calendar
 * paths all count only yours (one shared applyBatchPicks math, zero drift).
 * Picks are content-derived (day + wall time → subject code), so routine
 * resyncs that keep the schedule keep the picks.
 */
function ParallelClassesSection({
  slots,
  picks,
  highlight = false,
}: {
  slots: TimetableSlotRow[];
  picks: Record<string, string>;
  /** True right after a deep-link open — scrolls into view + rings the section. */
  highlight?: boolean;
}) {
  const qc = useQueryClient();
  const cells = useMemo(() => parallelCells(slots), [slots]);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (highlight) sectionRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [highlight]);

  const setPick = useMutation({
    mutationFn: (v: { cellKey: string; subjectCode: string | null }) => setBatchPick(v.cellKey, v.subjectCode),
    onSuccess: (_res, v) => {
      qc.invalidateQueries({ queryKey: qk.timetable });
      qc.invalidateQueries({ queryKey: qk.dashboard });
      toast.success(
        v.subjectCode
          ? `Marked as attending ${v.subjectCode} in that window`
          : "Pick cleared — the plan counts every option again"
      );
    },
    onError: (e) => toast.error("Could not save the pick", { description: e.message }),
  });

  if (cells.length === 0) return null;

  const resolvedCount = cells.filter((c) => picks[c.key]).length;
  const allResolved = resolvedCount === cells.length;

  return (
    <div
      ref={sectionRef}
      data-testid="parallel-classes"
      className={cn(
        "rounded-xl border p-3 transition-shadow",
        highlight ? "border-sky-500/50 ring-2 ring-sky-500/40" : "border-border/60"
      )}
    >
      <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <GitMerge className="size-3.5" aria-hidden="true" /> Parallel classes
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[10px] font-semibold normal-case tabular-nums",
            allResolved ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-muted"
          )}
        >
          {resolvedCount}/{cells.length} resolved
        </span>
      </p>
      <p className="mb-2.5 text-[11px] leading-snug text-muted-foreground">
        The routine lists several classes in these windows (lab groups / batches). Tap the one you actually attend —
        the week plan, today card and calendar then count only yours.
      </p>
      <ul className="space-y-2">
        {cells.map((c) => {
          const picked = picks[c.key];
          const range = `${hhmm(c.startMin)}–${hhmm(c.endMin)}`;
          return (
            <li key={c.key} className="rounded-lg border border-border/50 bg-muted/20 px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold">
                  {DAY_NAMES[c.dayOfWeek]}{" "}
                  <span className="tabular-nums text-muted-foreground">{range}</span>
                </span>
                {picked ? (
                  <button
                    type="button"
                    disabled={setPick.isPending}
                    onClick={() => setPick.mutate({ cellKey: c.key, subjectCode: null })}
                    className="rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Clear the pick for ${DAY_NAMES[c.dayOfWeek]} ${range} and count every option again`}
                  >
                    count all
                  </button>
                ) : (
                  <span className="text-[10px] font-medium text-amber-600/90 dark:text-amber-400/80">
                    unresolved · counting all
                  </span>
                )}
              </div>
              <div
                className="mt-1.5 flex flex-wrap gap-1.5"
                role="group"
                aria-label={`Pick the class you attend on ${DAY_NAMES[c.dayOfWeek]}, ${range}`}
              >
                {c.options.map((code) => {
                  const isPicked = picked === code;
                  return (
                    <button
                      key={code}
                      type="button"
                      disabled={setPick.isPending}
                      onClick={() => setPick.mutate({ cellKey: c.key, subjectCode: isPicked ? null : code })}
                      aria-pressed={isPicked}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[11px] transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isPicked
                          ? "border-emerald-500/60 bg-emerald-500/15 font-semibold text-emerald-700 dark:text-emerald-300"
                          : "border-border/70 bg-card text-muted-foreground hover:border-emerald-500/40 hover:text-foreground"
                      )}
                    >
                      {isPicked && <Check className="size-3 shrink-0" aria-hidden="true" />}
                      {code}
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ManageTimetableDialog({
  subjects,
  mode = "demo",
  externalOpen = false,
  onExternalClose,
  highlightParallel = false,
}: {
  subjects: SubjectView[];
  mode?: AppMode;
  /** Controlled open signal (the week plan's "Resolve now" deep-link). */
  externalOpen?: boolean;
  /** Fired when the dialog closes so the signal source can reset. */
  onExternalClose?: () => void;
  /** Rings + scrolls to the Parallel classes section after a deep-link open. */
  highlightParallel?: boolean;
}) {
  const qc = useQueryClient();
  const [openInternal, setOpenInternal] = useState(false);
  // The dialog is open when EITHER the trigger was used OR a deep-link
  // signal is held; closing clears both so the signal never ghosts.
  const open = openInternal || externalOpen;
  const setOpen = (v: boolean) => {
    setOpenInternal(v);
    if (!v) onExternalClose?.();
  };
  const [day, setDay] = useState("1");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("09:50");
  const [code, setCode] = useState(subjects[0]?.code ?? "");
  const [conflicts, setConflicts] = useState<SlotConflict[] | null>(null);

  const { data } = useQuery({
    queryKey: qk.timetable,
    queryFn: fetchTimetable,
    enabled: open,
  });

  const add = useMutation({
    mutationFn: (force: boolean) =>
      createSlot({ dayOfWeek: Number(day), start, end, subjectCode: code, force }),
    onSuccess: (_res, force) => {
      qc.invalidateQueries({ queryKey: qk.timetable });
      qc.invalidateQueries({ queryKey: qk.dashboard });
      setConflicts(null);
      toast.success(
        force ? "Class added (overlap accepted)" : "Class added to your timetable"
      );
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409 && Array.isArray(e.body.conflicts)) {
        setConflicts(e.body.conflicts as SlotConflict[]);
        return;
      }
      setConflicts(null);
      toast.error("Could not add class", { description: e instanceof ApiError ? e.message : e.message });
    },
  });

  const resetConflicts = () => setConflicts(null);

  const remove = useMutation({
    mutationFn: deleteSlot,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.timetable });
      toast.success("Class removed");
    },
    onError: (e) => toast.error("Could not remove class", { description: e.message }),
  });

  const tt = data;
  const slots = tt?.slots ?? [];
  const picks = tt?.picks ?? {};
  const cellByKey = useMemo(() => new Map(parallelCells(slots).map((c) => [c.key, c])), [slots]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs print:hidden">
          <Settings2 className="size-3.5" aria-hidden="true" />
          Manage
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8 tracking-tight">
            Weekly timetable
            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-7 gap-1.5 px-2.5 text-[11px]"
              disabled={slots.length === 0}
              onClick={() => {
                const filename = downloadTimetableIcs(slots, subjects);
                toast.success(`${filename} downloaded`, {
                  description: "Import it into Google Calendar / Apple Calendar / Outlook — classes repeat weekly.",
                });
              }}
              aria-label="Export the weekly timetable as a calendar (.ics) file"
            >
              <Download className="size-3.5" aria-hidden="true" />
              .ics
            </Button>
          </DialogTitle>
          <DialogDescription className="text-xs">
            {mode === "live"
              ? "Your weekly classes sync automatically from the ERP's Class Routine page — ERP rows refresh on every sync (marked ERP). Personal slots you add persist independently."
              : "The demo ERP seeded a sample schedule — adjust it to match your real classes. Personal slots persist independently of synchronization."}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border border-border/60 p-3">
          <p className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <CalendarPlus className="size-3.5" aria-hidden="true" /> Add a class
          </p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="tt-day" className="text-[11px]">Day</Label>
              <Select value={day} onValueChange={(v) => { setDay(v); resetConflicts(); }}>
                <SelectTrigger id="tt-day" className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WEEK_ORDER.map((d) => (
                    <SelectItem key={d} value={String(d)} className="text-xs">{DAY_NAMES[d]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="tt-subject" className="text-[11px]">Subject</Label>
              <Select value={code} onValueChange={(v) => { setCode(v); resetConflicts(); }}>
                <SelectTrigger id="tt-subject" className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {subjects.map((s) => (
                    <SelectItem key={s.code} value={s.code} className="text-xs">{s.code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="tt-start" className="text-[11px]">Starts</Label>
              <Input id="tt-start" type="time" value={start} onChange={(e) => { setStart(e.target.value); resetConflicts(); }} className="h-9 text-xs" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tt-end" className="text-[11px]">Ends</Label>
              <Input id="tt-end" type="time" value={end} onChange={(e) => { setEnd(e.target.value); resetConflicts(); }} className="h-9 text-xs" />
            </div>
          </div>

          {conflicts && conflicts.length > 0 && (
            <div
              role="alert"
              className="mt-2.5 rounded-lg border border-amber-500/50 bg-amber-500/[0.08] p-2.5"
            >
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
                Time conflict — overlaps {conflicts.length === 1 ? "1 class" : `${conflicts.length} classes`}
              </p>
              <ul className="mt-1.5 space-y-1">
                {conflicts.map((c) => (
                  <li key={c.id} className="flex items-center gap-1.5 text-[11px] text-amber-800 dark:text-amber-300/90">
                    <span className="size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
                    <span className="font-mono font-semibold">{c.subjectCode}</span>
                    <span className="tabular-nums">{c.start}–{c.end}</span>
                    {c.source === "demo" && <span className="text-amber-700/60 dark:text-amber-400/50">· demo</span>}
                    {c.source === "erp" && <span className="text-indigo-600/70 dark:text-indigo-400/70">· ERP</span>}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] leading-snug text-amber-800/80 dark:text-amber-300/70">
                Pick a different time, or add it anyway if these genuinely share a window.
              </p>
              <div className="mt-2 flex gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 border-amber-500/50 px-2.5 text-[11px] text-amber-700 hover:bg-amber-500/15 dark:text-amber-400"
                  disabled={add.isPending}
                  onClick={() => add.mutate(true)}
                >
                  {add.isPending ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : <CalendarPlus className="size-3" aria-hidden="true" />}
                  Add anyway
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2.5 text-[11px] text-muted-foreground"
                  onClick={resetConflicts}
                >
                  Pick another time
                </Button>
              </div>
            </div>
          )}

          <Button
            size="sm"
            className="mt-2.5 h-8 gap-1.5 text-xs"
            onClick={() => add.mutate(false)}
            disabled={add.isPending || !code}
          >
            {add.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <CalendarPlus className="size-3.5" aria-hidden="true" />}
            Add class
          </Button>
        </div>

        <div className="space-y-2.5">
          <ParallelClassesSection slots={slots} picks={picks} highlight={highlightParallel} />
          {WEEK_ORDER.map((d) => {
            const daySlots = slots.filter((s) => s.dayOfWeek === d);
            if (daySlots.length === 0) return null;
            return (
              <div key={d}>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{DAY_NAMES[d]}</p>
                <ul className="space-y-1">
                  {daySlots.map((s) => {
                    const cell = cellByKey.get(`${s.dayOfWeek}-${s.startMin}-${s.endMin}`);
                    const pick = cell ? picks[cell.key] : undefined;
                    const pickedRow = pick === s.subjectCode;
                    const altRow = pick !== undefined && !pickedRow;
                    return (
                      <li
                        key={s.id}
                        className={cn(
                          "flex items-center gap-2 rounded-lg border border-border/50 px-2.5 py-1.5 transition-opacity",
                          altRow && "opacity-55"
                        )}
                      >
                        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: colorForCode(s.subjectCode, subjects) }} aria-hidden="true" />
                        <span className="font-mono text-xs font-semibold">{s.subjectCode}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">{hhmm(s.startMin)}–{hhmm(s.endMin)}</span>
                        {pickedRow && (
                          <Badge variant="outline" className="ml-1 border-emerald-500/40 px-1.5 py-0 text-[10px] text-emerald-600 dark:text-emerald-400">
                            attending
                          </Badge>
                        )}
                        {altRow && (
                          <Badge variant="outline" className="ml-1 px-1.5 py-0 text-[10px] text-muted-foreground">
                            alternative
                          </Badge>
                        )}
                        {s.source === "demo" && <Badge variant="outline" className="ml-1 px-1.5 py-0 text-[10px]">demo</Badge>}
                      {s.source === "erp" && (
                        <Badge variant="outline" className="ml-1 border-indigo-500/40 px-1.5 py-0 text-[10px] text-indigo-600 dark:text-indigo-400">
                          ERP
                        </Badge>
                      )}
                      {s.source === "erp" ? (
                        <span
                          className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-indigo-500/80 dark:text-indigo-400/80"
                          title="Synced from the ERP Class Routine — managed automatically, edits happen on the ERP"
                        >
                          <CloudCog className="size-3.5 shrink-0" aria-hidden="true" />
                          managed
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => remove.mutate(s.id)}
                          className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`Remove ${s.subjectCode} on ${DAY_NAMES[d]} at ${hhmm(s.startMin)}`}
                        >
                          {remove.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="size-3.5" aria-hidden="true" />}
                        </button>
                      )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          {slots.length === 0 && (
            <div className="flex flex-col items-center gap-1.5 py-6 text-center">
              <CalendarDays className="size-5 text-muted-foreground/60" aria-hidden="true" />
              <p className="text-sm font-medium text-foreground/80">No classes scheduled yet</p>
              <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
                The ERP doesn&apos;t publish a timetable — add your real class times with the pickers above to unlock
                today&apos;s-schedule highlights, ongoing-class badges and weekly planning.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */

/** The milestone stakes of today's next (or ongoing) class, computed from
 *  the REAL overall record: only when attending exactly ONE class crosses
 *  the target does this return a value — any other state stays quiet
 *  (null), so the badge is a rare, high-signal fact and never noise.
 *  pctAfter is the honest after-percentage (p+1)/(t+1) — it can land
 *  ABOVE the target, not exactly on it. */
export interface TodayStakes {
  /** Overall % if this class is attended — e.g. 2/3 → 3/4 = 75. */
  pctAfter: number;
  targetPct: number;
}

export function todayStakes(
  overall: AttendanceView | null | undefined,
  targetPct: number
): TodayStakes | null {
  if (!overall || !Number.isFinite(targetPct) || overall.total <= 0) return null;
  if (overall.classesToTarget !== 1) return null;
  const pctAfter = ((overall.present + 1) / (overall.total + 1)) * 100;
  // Honesty guard: classesToTarget===1 must mean one class reaches/crosses.
  if (!(pctAfter >= targetPct - 1e-9)) return null;
  return { pctAfter, targetPct };
}

/** Elapsed fraction (0–100) of an ongoing class — null when the class
 *  hasn't started, has already ended, or the span is degenerate. Pure so
 *  tests can pin it without a real class on the clock; the UI renders a
 *  thin fill bar from it in the "Happening now" banner and the row. */
export function classProgress(
  startMin: number,
  endMin: number,
  nowMin: number
): number | null {
  if (!(endMin > startMin)) return null;
  if (nowMin <= startMin || nowMin >= endMin) return null;
  return ((nowMin - startMin) / (endMin - startMin)) * 100;
}

/** How long (minutes) a row keeps saying "just ended" after its class
 *  finishes — deliberately one auto-sync cadence (15 min): the bridge
 *  closes the moment the sync can actually record the class. */
export const JUST_ENDED_WINDOW_MIN = 15;

/** True while the clock sits within the first JUST_ENDED_WINDOW_MIN minutes
 *  after a class ends — the honest gap between "class over" and the next
 *  15-min auto-sync actually recording it. The row then reads "just ended"
 *  (amber = in flight) instead of the flat dimmed "done", and the tooltip
 *  says the attendance updates on the next sync. Pure — pinned in tests. */
export function isJustEnded(endMin: number, nowMin: number): boolean {
  const since = nowMin - endMin;
  return since >= 0 && since <= JUST_ENDED_WINDOW_MIN;
}

export function TimetableCard({
  subjects,
  mode = "demo",
  manageOpen = false,
  onManageClose,
  highlightParallel = false,
  focusSignal = 0,
  overall = null,
  target,
  onOpenSubject,
}: {
  subjects: SubjectView[];
  mode?: AppMode;
  /** Controlled open signal forwarded to the Manage dialog (deep-link). */
  manageOpen?: boolean;
  onManageClose?: () => void;
  highlightParallel?: boolean;
  /** Increment-only counter from the Today card chip (erp:focus-timetable):
   *  every increment scrolls this card into view and flashes a violet
   *  spotlight on the next/ongoing row — the results-family deep-link
   *  language, applied to the schedule. */
  focusSignal?: number;
  /** Real overall attendance + target % — when attending exactly ONE more
   *  class crosses the target, today's next/ongoing row gains an amber
   *  "attend → X%" stakes line (same fact the milestones strip shows,
   *  surfaced where the decision actually happens). */
  overall?: AttendanceView | null;
  target?: number;
  /** Deep-link to the subject drawer (dashboard-tab owns it): when provided,
   *  a row's subject code becomes a quiet violet button that opens the
   *  attendance details for that subject. Violet = the deep-link language
   *  (same family as the focus spotlight), so both "jump" affordances read
   *  as one system. Absent → plain text, exactly as before. */
  onOpenSubject?: (code: string) => void;
}) {
  const now = useNow(30_000);
  /* IST, not the device clock — see istNow. A UTC browser must not turn
     the student's 11:00 class into "starts in 532 min". */
  const { day: nowDay, min: nowMin } = istNow(now);
  const [weekOpen, setWeekOpen] = useState(false);

  /* Spotlight state: armed by focusSignal increments, self-disarming after
     ~2.6s (matches the results-card flash language). The card ref drives the
     scroll; the flash marks the way in and the next row keeps the accent
     while lit so the eye lands on the right class. */
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [spotlit, setSpotlit] = useState(false);
  const spotTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!focusSignal) return;
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setSpotlit(true);
    if (spotTimer.current) clearTimeout(spotTimer.current);
    spotTimer.current = setTimeout(() => setSpotlit(false), 2600);
  }, [focusSignal]);
  useEffect(
    () => () => {
      if (spotTimer.current) clearTimeout(spotTimer.current);
    },
    []
  );

  const { data, isPending, isError } = useQuery({
    queryKey: qk.timetable,
    queryFn: fetchTimetable,
    refetchInterval: 60_000,
    retry: 2,
  });

  const tt = data;
  const slots = tt?.slots ?? [];
  // Today's schedule shows the student's REAL day: same-batch duplicates
  // collapsed + parallel windows trimmed to the picked class. Hidden
  // alternatives are disclosed below the list — never silently dropped.
  const batch = useMemo(() => applyBatchPicks(slots, tt?.picks ?? {}), [slots, tt?.picks]);
  const todaySlots = useMemo(
    () => batch.attending.filter((s) => s.dayOfWeek === nowDay),
    [batch, nowDay]
  );
  const hiddenToday = batch.excluded.filter((s) => s.dayOfWeek === nowDay).length;
  // Full-week grid pick awareness: attending rows render normally; rows the
  // student didn't pick (excluded) and same-batch duplicates are dimmed.
  const attendingIds = useMemo(() => new Set(batch.attending.map((s) => s.id)), [batch]);
  const excludedIds = useMemo(() => new Set(batch.excluded.map((s) => s.id)), [batch]);
  const ongoing = todaySlots.find((s) => nowMin >= s.startMin && nowMin < s.endMin);
  const next = todaySlots.find((s) => s.startMin > nowMin);
  /* Milestone stakes: rendered on the next/ongoing row only when attending
     exactly one class crosses the target (today's REAL stakes, Saturday
     11:00 RWM → 3/4 = 75% at the moment of writing). */
  const stakes = useMemo(() => todayStakes(overall, target ?? NaN), [overall, target]);
  const classesLeftToday = todaySlots.some((s) => s.endMin > nowMin);

  return (
    <Card
      ref={cardRef}
      className={cn(
        "rounded-xl border-border/60 transition-all hover:shadow-md",
        spotlit && "border-violet-500/40 ring-2 ring-violet-500/40"
      )}
    >
      <div className="flex flex-row items-center justify-between gap-2 px-6 pt-6 pb-2">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <CalendarDays className="size-4 text-emerald-500" aria-hidden="true" />
            Today&apos;s schedule
            <Badge
              variant="secondary"
              className={cn(
                "gap-1.5 text-[11px] font-medium transition-colors",
                classesLeftToday &&
                  "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              )}
              title={
                classesLeftToday
                  ? "Classes are still ahead of you today"
                  : todaySlots.length > 0
                    ? "All of today's classes are over"
                    : "No classes scheduled today"
              }
            >
              {classesLeftToday && (
                <span className="relative flex size-1.5" aria-hidden="true">
                  <span
                    className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60"
                    style={{ animationDuration: "2.2s" }}
                  />
                  <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
                </span>
              )}
              {DAY_NAMES[nowDay]}
            </Badge>
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {todaySlots.length === 0 ? "Nothing planned" : `${todaySlots.length} class${todaySlots.length === 1 ? "" : "es"} today`}
          </p>
        </div>
        <ManageTimetableDialog
          subjects={subjects}
          mode={mode}
          externalOpen={manageOpen}
          onExternalClose={onManageClose}
          highlightParallel={highlightParallel}
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground print:hidden"
          disabled={slots.length === 0}
          onClick={() => {
            const filename = downloadTimetableIcs(slots, subjects);
            toast.success(`${filename} downloaded`, {
              description: "Classes repeat weekly — import into your calendar app.",
            });
          }}
          aria-label="Export the weekly timetable as a calendar (.ics) file"
        >
          <Download className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <CardContent>
        {isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-red-500/40 py-8 text-center">
            <CalendarDays className="size-6 text-red-500/60" aria-hidden="true" />
            <p className="text-sm font-medium">Could not load the timetable</p>
            <p className="text-xs text-muted-foreground">It will retry automatically in a moment.</p>
          </div>
        ) : todaySlots.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-border/70 py-8 text-center">
            <CalendarDays className="size-6 text-muted-foreground/60" aria-hidden="true" />
            <p className="text-sm font-medium">No classes today</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              {mode === "live" && slots.length === 0
                ? "Your weekly schedule is empty — the ERP doesn’t publish one, so add your real classes via Manage."
                : "Enjoy the free day — or add your classes via Manage."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {ongoing && (
              <div
                aria-live="polite"
                className="mb-2.5 flex items-center gap-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/[0.07] px-3.5 py-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <Play className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Happening now</p>
                  <p className="truncate text-sm font-semibold">
                    {ongoing.subjectCode} · {hhmm(ongoing.startMin)}–{hhmm(ongoing.endMin)}
                  </p>
                  {(() => {
                    const prog = classProgress(ongoing.startMin, ongoing.endMin, nowMin);
                    return prog !== null ? (
                      <div className="mt-1.5 flex items-center gap-2">
                        <div
                          className="h-1 w-full overflow-hidden rounded-full bg-emerald-500/15"
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(prog)}
                          aria-label={`Class progress — ${Math.round(prog)}% through`}
                        >
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-emerald-500/45 to-emerald-500 transition-[width] duration-1000 ease-linear"
                            style={{ width: `${prog}%` }}
                          />
                        </div>
                        {/* r74: the fraction is now VISIBLE, not just an aria
                            value — a glance answers "how far in am I?" without
                            doing clock math in the head. */}
                        <span
                          className="shrink-0 text-[10px] font-semibold tabular-nums text-emerald-600/90 dark:text-emerald-400/90"
                          aria-hidden="true"
                        >
                          {Math.round(prog)}%
                        </span>
                      </div>
                    ) : null;
                  })()}
                </div>
                {/* r78: symmetric urgency — the badge flips emerald → amber for
                    the LAST JUST_ENDED_WINDOW_MIN (one sync cadence) of the
                    class, mirroring the pre-class imminent flip. Amber = a
                    transition is approaching (the end), the same "get ready"
                    language the start countdown speaks. One constant, both
                    ends of the class lifecycle — no new threshold to drift. */}
                <Badge
                  className={cn(
                    "shrink-0",
                    ongoing.endMin - nowMin <= JUST_ENDED_WINDOW_MIN
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      : "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                  )}
                  variant="outline"
                >
                  {humanizeMins(ongoing.endMin - nowMin)} left
                </Badge>
              </div>
            )}
            <AnimatePresence initial={false}>
              {todaySlots.map((s, i) => {
                const st = slotStatus(s, nowDay, nowMin);
                const isNext = next?.id === s.id;
                const prog = st.key === "ongoing" ? classProgress(s.startMin, s.endMin, nowMin) : null;
                return (
                  <motion.div
                    key={s.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, delay: Math.min(i * 0.04, 0.2) }}
                  >
                    <div
                      className={cn(
                        "flex items-center gap-3 rounded-lg border p-2.5 transition-colors",
                        st.key === "ongoing"
                          ? "border-emerald-500/40 bg-emerald-500/[0.06]"
                          : st.key === "done"
                            ? "border-border/40 opacity-55"
                            : "border-border/50 hover:bg-muted/30",
                        spotlit && (isNext || st.key === "ongoing") &&
                          "border-l-2 border-l-violet-500/60 bg-violet-500/[0.05]"
                      )}
                    >
                      <span
                        className="flex size-9 shrink-0 flex-col items-center justify-center rounded-lg text-[10px] font-bold leading-none"
                        style={{ backgroundColor: `${colorForCode(s.subjectCode, subjects)}1a`, color: colorForCode(s.subjectCode, subjects) }}
                      >
                        {hhmm(s.startMin).slice(0, 2)}
                        <span className="mt-0.5">{hhmm(s.startMin).slice(3)}</span>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {(() => {
                            const known = onOpenSubject ? knownSubjectCode(s.subjectCode, subjects) : null;
                            return known ? (
                              <button
                                type="button"
                                onClick={() => onOpenSubject!(known)}
                                title={`Open subject details — attendance, trend and history for ${known}`}
                                aria-label={`Open subject details for ${known}`}
                                className="-mx-0.5 rounded px-0.5 text-left underline-offset-2 decoration-violet-500/60 transition-colors hover:text-violet-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-violet-400"
                              >
                                {known}
                              </button>
                            ) : (
                              s.subjectCode
                            );
                          })()}
                        </p>
                        <p className="text-xs tabular-nums text-muted-foreground">
                          {hhmm(s.startMin)} – {hhmm(s.endMin)}
                          {s.source === "demo" && " · demo"}
                          {s.source === "erp" && " · synced from ERP"}
                        </p>
                        {prog !== null && (
                          <div
                            className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-emerald-500/15"
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round(prog)}
                            aria-label={`Class progress — ${Math.round(prog)}% through`}
                          >
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-emerald-500/45 to-emerald-500 transition-[width] duration-1000 ease-linear"
                              style={{ width: `${prog}%` }}
                            />
                          </div>
                        )}
                        {stakes && (isNext || st.key === "ongoing") && (
                          <p
                            className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-amber-700 tabular-nums dark:text-amber-400"
                            title={`Attending this class takes your overall to ${stakes.pctAfter.toFixed(2)}% (${(overall?.present ?? 0) + 1}/${(overall?.total ?? 0) + 1}), meeting your ${stakes.targetPct}% target`}
                          >
                            <Target className="size-3 shrink-0" aria-hidden="true" />
                            attend → {stakes.pctAfter.toFixed(2)}% · hits your {stakes.targetPct}% target
                          </p>
                        )}
                      </div>
                      {st.key === "ongoing" ? (
                        /* r79: symmetric urgency on the row — the last
                           JUST_ENDED_WINDOW_MIN reads amber "wrapping up",
                           matching the r78 banner badge flip (starts-in ≤10
                           imminent / ends-in ≤15 wrapping up — one language,
                           both ends). */
                        s.endMin - nowMin <= JUST_ENDED_WINDOW_MIN ? (
                          <Badge variant="outline" className="shrink-0 border-amber-500/40 text-amber-700 dark:text-amber-400">
                            <CircleDot className="size-3 animate-pulse" aria-hidden="true" /> wrapping up
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="shrink-0 border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
                            <CircleDot className="size-3 animate-pulse" aria-hidden="true" /> now
                          </Badge>
                        )
                      ) : isNext && st.label ? (
                        <Badge variant="outline" className="shrink-0 border-amber-500/40 text-amber-700 dark:text-amber-400">
                          <Clock className="size-3" aria-hidden="true" /> {st.label}
                        </Badge>
                      ) : st.key === "done" ? (
                        isJustEnded(s.endMin, nowMin) ? (
                          <Badge
                            variant="outline"
                            className="shrink-0 border-amber-500/30 bg-amber-500/[0.06] text-amber-600/90 dark:text-amber-400/90"
                            title="Class just finished — attendance updates on the next auto-sync (within 15 minutes)"
                          >
                            <Check className="size-3" aria-hidden="true" /> just ended
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="shrink-0 border-border/40 text-muted-foreground">done</Badge>
                        )
                      ) : null}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            {hiddenToday > 0 && (
              <p className="pt-0.5 text-[10px] leading-snug text-muted-foreground/70">
                {hiddenToday} parallel alternative{hiddenToday === 1 ? "" : "s"} hidden — you picked a different class
                for that window (Manage → Parallel classes).
              </p>
            )}
          </div>
        )}

        {/* Full week */}
        {slots.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setWeekOpen((v) => !v)}
              className="flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-expanded={weekOpen}
            >
              <ChevronDown className={cn("size-3.5 transition-transform", weekOpen && "rotate-180")} aria-hidden="true" />
              Full week
            </button>
            <AnimatePresence initial={false}>
              {weekOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden"
                >
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                    {WEEK_ORDER.map((d) => {
                      const daySlots = slots.filter((s) => s.dayOfWeek === d);
                      const isToday = d === nowDay;
                      return (
                        <div
                          key={d}
                          className={cn(
                            "rounded-xl border p-2 transition-colors",
                            isToday
                              ? "border-emerald-500/40 bg-emerald-500/[0.05]"
                              : "border-border/50"
                          )}
                        >
                          <p
                            className={cn(
                              "mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide",
                              isToday ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"
                            )}
                            title={
                              isToday
                                ? "Today — this column follows the IST clock"
                                : undefined
                            }
                          >
                            {isToday && (
                              <span className="relative flex size-1.5" aria-hidden="true">
                                <span
                                  className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60"
                                  style={{ animationDuration: "2.2s" }}
                                />
                                <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
                              </span>
                            )}
                            {DAY_NAMES[d].slice(0, 3)}
                          </p>
                          <div className="space-y-1.5">
                            {daySlots.length === 0 ? (
                              <p className="py-2 text-center text-[10px] text-muted-foreground/60">—</p>
                            ) : (
                              daySlots.map((s) => (
                                <SlotChip
                                  key={s.id}
                                  slot={s}
                                  color={colorForCode(s.subjectCode, subjects)}
                                  nowDay={nowDay}
                                  nowMin={nowMin}
                                  compact={d !== nowDay}
                                  state={
                                    attendingIds.has(s.id)
                                      ? "attending"
                                      : excludedIds.has(s.id)
                                        ? "alternative"
                                        : "duplicate"
                                  }
                                />
                              ))
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
