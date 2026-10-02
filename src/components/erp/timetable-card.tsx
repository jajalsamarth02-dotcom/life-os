"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  CircleDot,
  Clock,
  Loader2,
  Play,
  Settings2,
  Trash2,
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
import { createSlot, deleteSlot, fetchTimetable, qk, ApiError } from "./api";
import { useNow } from "./shared";
import type { SubjectView, TimetableSlotRow } from "./types";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon → Sun

const CHIP_COLORS = ["#10b981", "#f59e0b", "#84cc16", "#f97316", "#14b8a6", "#a8a29e", "#ef4444"];

function colorForCode(code: string, subjects: SubjectView[]): string {
  const idx = subjects.findIndex((s) => s.code === code);
  return CHIP_COLORS[(idx < 0 ? 0 : idx) % CHIP_COLORS.length];
}

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** Live status label for a slot relative to now. */
function slotStatus(
  slot: TimetableSlotRow,
  nowDay: number,
  nowMin: number
): { key: "ongoing" | "upcoming" | "done" | "other"; label?: string } {
  if (slot.dayOfWeek !== nowDay) return { key: "other" };
  if (nowMin >= slot.startMin && nowMin < slot.endMin) {
    return { key: "ongoing", label: `ends in ${slot.endMin - nowMin} min` };
  }
  if (nowMin < slot.startMin) {
    return { key: "upcoming", label: `starts in ${slot.startMin - nowMin} min` };
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
}: {
  slot: TimetableSlotRow;
  color: string;
  nowDay: number;
  nowMin: number;
  compact?: boolean;
}) {
  const st = slotStatus(slot, nowDay, nowMin);
  const ongoing = st.key === "ongoing";
  return (
    <div
      className={cn(
        "group rounded-lg border px-2 py-1.5 text-left transition-colors",
        ongoing
          ? "border-emerald-500/50 bg-emerald-500/10"
          : st.key === "done"
            ? "border-border/40 bg-muted/30 opacity-55"
            : "border-border/60 bg-card hover:bg-muted/40"
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
        <p className={cn("mt-0.5 text-[10px] font-medium", ongoing ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
          {st.label}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ManageTimetableDialog({ subjects }: { subjects: SubjectView[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState("1");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("09:50");
  const [code, setCode] = useState(subjects[0]?.code ?? "");

  const { data } = useQuery({
    queryKey: qk.timetable,
    queryFn: fetchTimetable,
    enabled: open,
  });

  const add = useMutation({
    mutationFn: () => createSlot({ dayOfWeek: Number(day), start, end, subjectCode: code }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.timetable });
      toast.success("Class added to your timetable");
    },
    onError: (e) => toast.error("Could not add class", { description: e instanceof ApiError ? e.message : e.message }),
  });

  const remove = useMutation({
    mutationFn: deleteSlot,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.timetable });
      toast.success("Class removed");
    },
    onError: (e) => toast.error("Could not remove class", { description: e.message }),
  });

  const slots = data ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <Settings2 className="size-3.5" aria-hidden="true" />
          Manage
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="tracking-tight">Weekly timetable</DialogTitle>
          <DialogDescription className="text-xs">
            The demo ERP seeded a sample schedule — adjust it to match your real classes. Personal slots persist
            independently of synchronization.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border border-border/60 p-3">
          <p className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <CalendarPlus className="size-3.5" aria-hidden="true" /> Add a class
          </p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="tt-day" className="text-[11px]">Day</Label>
              <Select value={day} onValueChange={setDay}>
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
              <Select value={code} onValueChange={setCode}>
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
              <Input id="tt-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} className="h-9 text-xs" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tt-end" className="text-[11px]">Ends</Label>
              <Input id="tt-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="h-9 text-xs" />
            </div>
          </div>
          <Button
            size="sm"
            className="mt-2.5 h-8 gap-1.5 text-xs"
            onClick={() => add.mutate()}
            disabled={add.isPending || !code}
          >
            {add.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <CalendarPlus className="size-3.5" aria-hidden="true" />}
            Add class
          </Button>
        </div>

        <div className="space-y-2.5">
          {WEEK_ORDER.map((d) => {
            const daySlots = slots.filter((s) => s.dayOfWeek === d);
            if (daySlots.length === 0) return null;
            return (
              <div key={d}>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{DAY_NAMES[d]}</p>
                <ul className="space-y-1">
                  {daySlots.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 rounded-lg border border-border/50 px-2.5 py-1.5">
                      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: colorForCode(s.subjectCode, subjects) }} aria-hidden="true" />
                      <span className="font-mono text-xs font-semibold">{s.subjectCode}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{hhmm(s.startMin)}–{hhmm(s.endMin)}</span>
                      {s.source === "demo" && <Badge variant="outline" className="ml-1 px-1.5 py-0 text-[10px]">demo</Badge>}
                      <button
                        type="button"
                        onClick={() => remove.mutate(s.id)}
                        className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`Remove ${s.subjectCode} on ${DAY_NAMES[d]} at ${hhmm(s.startMin)}`}
                      >
                        {remove.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="size-3.5" aria-hidden="true" />}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {slots.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">No classes scheduled yet</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */

export function TimetableCard({ subjects }: { subjects: SubjectView[] }) {
  const now = useNow(30_000);
  const nowDay = new Date(now).getDay();
  const nowMin = new Date(now).getHours() * 60 + new Date(now).getMinutes();
  const [weekOpen, setWeekOpen] = useState(false);

  const { data, isPending, isError } = useQuery({
    queryKey: qk.timetable,
    queryFn: fetchTimetable,
    refetchInterval: 60_000,
    retry: 2,
  });

  const slots = data ?? [];
  const todaySlots = useMemo(
    () => slots.filter((s) => s.dayOfWeek === nowDay),
    [slots, nowDay]
  );
  const ongoing = todaySlots.find((s) => nowMin >= s.startMin && nowMin < s.endMin);
  const next = todaySlots.find((s) => s.startMin > nowMin);

  return (
    <Card className="rounded-xl border-border/60 transition-shadow hover:shadow-md">
      <div className="flex flex-row items-center justify-between gap-2 px-6 pt-6 pb-2">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <CalendarDays className="size-4 text-emerald-500" aria-hidden="true" />
            Today&apos;s schedule
            <Badge variant="secondary" className="text-[11px] font-medium">{DAY_NAMES[nowDay]}</Badge>
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {todaySlots.length === 0 ? "Nothing planned" : `${todaySlots.length} class${todaySlots.length === 1 ? "" : "es"} today`}
          </p>
        </div>
        <ManageTimetableDialog subjects={subjects} />
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
            <p className="text-xs text-muted-foreground">Enjoy the free day — or add your classes via Manage.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {ongoing && (
              <div className="mb-2.5 flex items-center gap-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/[0.07] px-3.5 py-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <Play className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Happening now</p>
                  <p className="truncate text-sm font-semibold">
                    {ongoing.subjectCode} · {hhmm(ongoing.startMin)}–{hhmm(ongoing.endMin)}
                  </p>
                </div>
                <Badge className="shrink-0 border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" variant="outline">
                  {ongoing.endMin - nowMin} min left
                </Badge>
              </div>
            )}
            <AnimatePresence initial={false}>
              {todaySlots.map((s, i) => {
                const st = slotStatus(s, nowDay, nowMin);
                const isNext = next?.id === s.id;
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
                            : "border-border/50 hover:bg-muted/30"
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
                        <p className="truncate text-sm font-medium">{s.subjectCode}</p>
                        <p className="text-xs tabular-nums text-muted-foreground">
                          {hhmm(s.startMin)} – {hhmm(s.endMin)}
                          {s.source === "demo" && " · demo"}
                        </p>
                      </div>
                      {st.key === "ongoing" ? (
                        <Badge variant="outline" className="shrink-0 border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
                          <CircleDot className="size-3 animate-pulse" aria-hidden="true" /> now
                        </Badge>
                      ) : isNext && st.label ? (
                        <Badge variant="outline" className="shrink-0 border-amber-500/40 text-amber-700 dark:text-amber-400">
                          <Clock className="size-3" aria-hidden="true" /> {st.label}
                        </Badge>
                      ) : st.key === "done" ? (
                        <Badge variant="outline" className="shrink-0 border-border/40 text-muted-foreground">done</Badge>
                      ) : null}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
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
                      return (
                        <div
                          key={d}
                          className={cn(
                            "rounded-xl border p-2",
                            d === nowDay ? "border-primary/40 bg-primary/[0.04]" : "border-border/50"
                          )}
                        >
                          <p className={cn("mb-1.5 text-[11px] font-semibold uppercase tracking-wide", d === nowDay ? "text-primary" : "text-muted-foreground")}>
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
