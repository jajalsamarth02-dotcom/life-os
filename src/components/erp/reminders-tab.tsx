"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowDownUp,
  BellRing,
  BookOpen,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Circle,
  ClipboardList,
  Clock,
  Download,
  Link2,
  Loader2,
  Lock,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { downloadRemindersIcs } from "@/lib/ics";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CHANGE_EVENT as BROWSER_REMINDERS_EVENT,
  isEnabled as browserRemindersEnabled,
  permissionState as browserRemindersPermission,
  requestPermission as requestNotificationPermission,
  setEnabled as setBrowserRemindersEnabled,
} from "@/lib/browser-reminders";
import {
  createReminder,
  deleteReminder,
  fetchAssignments,
  fetchAttendance,
  fetchReminders,
  qk,
  snoozeReminder,
  updateReminderStatus,
  updateReminderSubject,
  ApiError,
} from "./api";
import { dueGroup, fmtDT, fmtDay, GROUP_META, SourceBadge, TypeIcon, typeLabel, useNow } from "./shared";
import { downloadCsv } from "./trend-chart";
import type { DueGroup } from "./shared";
import type { RemindersFilter, Reminder, ReminderType } from "./types";

/* ------------------------------------------------------------------ */

const NEW_TYPES: ReminderType[] = ["EXAM", "PRACTICAL_EXAM", "VIVA", "ASSIGNMENT", "SUBMISSION", "OTHER"];

/** Compute a snooze target from "now" for the given preset. */
function snoozeTarget(preset: "h1" | "h3" | "tomorrow" | "week"): Date {
  const d = new Date();
  switch (preset) {
    case "h1":
      return new Date(d.getTime() + 60 * 60_000);
    case "h3":
      return new Date(d.getTime() + 3 * 60 * 60_000);
    case "tomorrow":
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    case "week":
      d.setDate(d.getDate() + 7);
      d.setHours(9, 0, 0, 0);
      return d;
  }
}

function ReminderRow({ r, onDeleted }: { r: Reminder; onDeleted: (r: Reminder) => void }) {
  const qc = useQueryClient();
  const now = useNow();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isWarn = r.type === "ATTENDANCE_WARNING";
  const done = r.status !== "ACTIVE";
  const dueMs = new Date(r.dueAt).getTime() - now;
  const overdue = r.status === "ACTIVE" && dueMs < 0;
  const dueSoon = r.status === "ACTIVE" && dueMs >= 0 && dueMs <= 24 * 3600 * 1000;
  const canExport = !done && !isWarn;
  const setStatus = useMutation({
    mutationFn: (status: string) => updateReminderStatus(r.id, status),
    onSuccess: (_res, status) => {
      qc.invalidateQueries();
      toast.success(status === "DONE" ? "Marked as done" : "Moved back to active");
    },
    onError: (e) => {
      qc.invalidateQueries();
      toast.error("Could not update reminder", { description: e.message });
    },
  });

  const del = useMutation({
    mutationFn: () => deleteReminder(r.id),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Reminder deleted");
      onDeleted(r);
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? e.message : e.message;
      toast.error("Cannot delete reminder", { description: msg });
    },
  });

  /* Snooze (personal reminders only — ERP owns its own due dates). */
  const snooze = useMutation({
    mutationFn: (preset: "h1" | "h3" | "tomorrow" | "week") =>
      snoozeReminder(r.id, snoozeTarget(preset).toISOString()),
    onSuccess: (_res, preset) => {
      qc.invalidateQueries();
      const target = snoozeTarget(preset);
      toast.success(`Snoozed until ${fmtDT(target.toISOString())}`);
    },
    onError: (e) => {
      qc.invalidateQueries();
      toast.error("Could not snooze reminder", { description: e.message });
    },
  });
  const canSnooze = r.source === "PERSONAL" && !done && r.type !== "ATTENDANCE_WARNING";

  /* Link/unlink a subject (personal reminders only — sync owns ERP links). */
  const { data: att } = useQuery({
    queryKey: qk.attendance,
    queryFn: fetchAttendance,
    staleTime: 60_000,
  });
  const linkSubject = useMutation({
    mutationFn: (v: { code: string | null; name?: string | null }) =>
      updateReminderSubject(r.id, v.code),
    onSuccess: (_res, v) => {
      qc.invalidateQueries();
      toast.success(v.code ? `Linked to ${v.name ?? v.code}` : "Subject link removed");
    },
    onError: (e) => {
      qc.invalidateQueries();
      toast.error("Could not update subject link", { description: e.message });
    },
  });
  const canLinkSubject = r.source === "PERSONAL" && r.type !== "ATTENDANCE_WARNING";

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "flex items-start gap-3 rounded-xl border p-3 transition-colors",
        isWarn
          ? "border-amber-500/40 bg-amber-500/[0.06] hover:bg-amber-500/10"
          : dueSoon
            ? "border-amber-500/35 bg-amber-500/[0.035] hover:bg-amber-500/[0.07]"
            : overdue
              ? "border-red-500/30 bg-red-500/[0.03] hover:bg-red-500/[0.06]"
              : "border-border/50 hover:bg-muted/40",
        done && "opacity-60"
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark ${r.title} as active` : `Mark ${r.title} as done`}
        disabled={setStatus.isPending}
        onClick={() => setStatus.mutate(done ? "ACTIVE" : "DONE")}
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          done ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/40 hover:border-emerald-500"
        )}
      >
        {done && <CheckCircle2 className="size-4" aria-hidden="true" />}
      </button>

      <TypeIcon type={r.type} className={isWarn ? "bg-amber-500/20 text-amber-700 dark:text-amber-400" : undefined} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className={cn("min-w-0 flex-1 text-sm font-medium leading-snug", done && "line-through decoration-muted-foreground/50")}>
            {r.title}
          </p>
          <SourceBadge source={r.source} />
          <Badge variant="secondary" className="hidden text-[11px] sm:inline-flex">{typeLabel(r.type)}</Badge>
          {r.subjectCode && (
            <Badge
              variant="outline"
              title={r.subjectName ?? r.subjectCode}
              className="max-w-40 truncate text-[10px] font-medium text-muted-foreground"
            >
              <BookOpen className="mr-0.5 size-2.5 shrink-0" aria-hidden="true" />
              {r.subjectCode}
            </Badge>
          )}
        </div>
        {r.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{r.description}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span
            role="status"
            aria-label={done ? "Completed" : "Not completed yet"}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-semibold",
              r.status === "DONE"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : r.status === "DISMISSED"
                  ? "border-border bg-muted text-muted-foreground"
                  : "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400"
            )}
          >
            {done ? <CheckCircle2 className="size-2.5" aria-hidden="true" /> : <Circle className="size-2.5" aria-hidden="true" />}
            {r.status === "DONE" ? "Complete" : r.status === "DISMISSED" ? "Dismissed" : "Not done"}
          </span>
          <span className={cn("text-xs", overdue ? "font-medium text-red-600 dark:text-red-400" : dueSoon ? "font-medium text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
            {overdue ? "Overdue · " : ""}
            {fmtDT(r.dueAt)}
          </span>
          {dueSoon && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
              <Clock className="size-3" aria-hidden="true" />
              due in {Math.max(1, Math.round(dueMs / 3600_000))}h
            </span>
          )}
          {isWarn && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
              <Lock className="size-3" aria-hidden="true" />
              auto-managed by ERP sync
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {canLinkSubject && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "size-8",
                  r.subjectCode
                    ? "text-primary hover:bg-primary/10"
                    : "text-muted-foreground hover:bg-primary/10 hover:text-primary"
                )}
                aria-label={`Link ${r.title} to a subject`}
                disabled={linkSubject.isPending}
              >
                {linkSubject.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Link2 className="size-4" aria-hidden="true" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 w-64 overflow-y-auto">
              <DropdownMenuLabel className="text-[11px]">Link to subject</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => linkSubject.mutate({ code: null })}>
                <Circle className="size-3 text-muted-foreground" aria-hidden="true" />
                No subject (general)
                {r.subjectCode === null && <Check className="ml-auto size-3.5 text-primary" aria-hidden="true" />}
              </DropdownMenuItem>
              {(att?.subjects ?? []).map((s) => (
                <DropdownMenuItem key={s.code} onClick={() => linkSubject.mutate({ code: s.code, name: s.name })}>
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  <span className="ml-1 shrink-0 text-[10px] tabular-nums text-muted-foreground">{s.code}</span>
                  {r.subjectCode === s.code && <Check className="ml-1 size-3.5 shrink-0 text-primary" aria-hidden="true" />}
                </DropdownMenuItem>
              ))}
              {att && att.subjects.length === 0 && (
                <DropdownMenuItem disabled>No subjects available</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {done ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Move ${r.title} back to active`}
            onClick={() => setStatus.mutate("ACTIVE")}
            disabled={setStatus.isPending}
          >
            <Undo2 className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
        {canExport && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400"
            aria-label={`Add ${r.title} to your calendar (.ics)`}
            onClick={() => {
              const filename = downloadRemindersIcs([
                {
                  id: r.id,
                  title: r.title,
                  description: r.description,
                  dueAt: r.dueAt,
                  type: r.type,
                  source: r.source,
                },
              ]);
              toast.success(`${filename} downloaded`, {
                description: `“${r.title}” added as a calendar event.`,
              });
            }}
          >
            <CalendarPlus className="size-4" aria-hidden="true" />
          </Button>
        )}
        {canSnooze && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400"
                aria-label={`Snooze ${r.title}`}
                disabled={snooze.isPending}
              >
                {snooze.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Clock className="size-4" aria-hidden="true" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="text-[11px]">Snooze until…</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => snooze.mutate("h1")}>
                <Clock className="size-3.5 text-muted-foreground" aria-hidden="true" />
                In 1 hour
                <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
                  {fmtDT(snoozeTarget("h1").toISOString())}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => snooze.mutate("h3")}>
                <Clock className="size-3.5 text-muted-foreground" aria-hidden="true" />
                In 3 hours
                <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
                  {fmtDT(snoozeTarget("h3").toISOString())}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => snooze.mutate("tomorrow")}>
                <CalendarClock className="size-3.5 text-muted-foreground" aria-hidden="true" />
                Tomorrow 09:00
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => snooze.mutate("week")}>
                <CalendarClock className="size-3.5 text-muted-foreground" aria-hidden="true" />
                Next week
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
          aria-label={`Delete ${r.title}`}
          onClick={() => {
            if (r.source === "ERP") {
              del.mutate(); // backend answers 400 with the honest reason → toast
            } else {
              setConfirmDelete(true);
            }
          }}
          disabled={del.isPending}
        >
          {r.source === "ERP" ? <Lock className="size-4" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
        </Button>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this reminder?</AlertDialogTitle>
            <AlertDialogDescription>
              “{r.title}” is a personal reminder and will be removed permanently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => del.mutate()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.li>
  );
}

/* ------------------------------------------------------------------ */

function NewReminderDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<ReminderType>("EXAM");
  const [description, setDescription] = useState("");
  const [dueAtLocal, setDueAtLocal] = useState("");
  const [subjectCode, setSubjectCode] = useState<string>("none");

  /* Subject options (active subjects of the working semester) */
  const { data: att } = useQuery({
    queryKey: qk.attendance,
    queryFn: fetchAttendance,
    staleTime: 60_000,
  });

  /* Command palette → open this dialog */
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("erp:new-reminder", handler);
    return () => window.removeEventListener("erp:new-reminder", handler);
  }, []);

  const create = useMutation({
    mutationFn: () =>
      createReminder({
        title: title.trim(),
        type,
        description: description.trim() || undefined,
        dueAt: new Date(dueAtLocal).toISOString(),
        subjectCode: subjectCode === "none" ? null : subjectCode,
      }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Reminder created");
      setOpen(false);
      setTitle("");
      setDescription("");
      setDueAtLocal("");
      setSubjectCode("none");
    },
    onError: (e) => toast.error("Could not create reminder", { description: e.message }),
  });

  const valid = title.trim().length > 0 && dueAtLocal.length > 0 && !Number.isNaN(new Date(dueAtLocal).getTime());

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-9 gap-1.5" aria-label="Create a new reminder">
          <Plus className="size-4" aria-hidden="true" />
          New Reminder
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New personal reminder</DialogTitle>
          <DialogDescription>
            Personal reminders live only in this app — the ERP is never modified.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) create.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="rem-title">Title</Label>
            <Input
              id="rem-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Bring lab manual"
              required
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rem-type">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as ReminderType)}>
              <SelectTrigger id="rem-type" className="w-full">
                <SelectValue placeholder="Select a type" />
              </SelectTrigger>
              <SelectContent>
                {NEW_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {typeLabel(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rem-desc">Description (optional)</Label>
            <Textarea
              id="rem-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Any details you want to remember"
              rows={3}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rem-subject">Subject (optional)</Label>
            <Select value={subjectCode} onValueChange={setSubjectCode}>
              <SelectTrigger id="rem-subject" className="w-full">
                <SelectValue placeholder="Link to a subject" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No subject (general)</SelectItem>
                {(att?.subjects ?? []).map((s) => (
                  <SelectItem key={s.code} value={s.code}>
                    {s.name} · {s.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Linked reminders are grouped under their subject in the By-subject list.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rem-due">Due date &amp; time</Label>
            <Input
              id="rem-due"
              type="datetime-local"
              value={dueAtLocal}
              onChange={(e) => setDueAtLocal(e.target.value)}
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || create.isPending}>
              {create.isPending ? "Creating…" : "Create reminder"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */

interface AlaGroup {
  code: string;
  name: string | null;
  items: Reminder[];
  submitted: number;
  nextPendingMs: number | null;
  /** Open (ACTIVE) rows already past their End Date. */
  overdue: number;
}

/** Compact relative-deadline label for an ALA row: "in 12d" / "due today" / "5d overdue". */
function relDue(dueMs: number, now: number): string {
  const diff = dueMs - now;
  const days = Math.floor(Math.abs(diff) / 86_400_000);
  if (diff < 0) return days === 0 ? "overdue" : `${days}d overdue`;
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  return `in ${days}d`;
}

/** One subject group inside the ALA list — collapsible, with a mini progress bar.
 *  Open state is controlled by the parent so Expand/Collapse-all and search work. */
function AlaSubjectGroup({
  group,
  open,
  onOpenChange,
}: {
  group: AlaGroup;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const now = useNow();
  const total = group.items.length;
  const pending = total - group.submitted;
  const pct = total > 0 ? Math.round((group.submitted / total) * 100) : 0;
  // Bar turns red once every open row is past due, amber while some hope remains.
  const barClass =
    pending === 0 ? "bg-emerald-500" : group.overdue >= pending ? "bg-red-500" : "bg-amber-500";

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="overflow-hidden rounded-xl border border-border/50 bg-card/40 shadow-none transition-all duration-200 hover:border-border/90 hover:shadow-sm">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            aria-expanded={open}
            aria-label={`Toggle ${group.name ?? group.code} ALA group`}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            <ChevronDown
              className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <p className="min-w-0 truncate text-sm font-semibold leading-tight">
                  {group.name ?? "Unmapped course"}
                </p>
                <Badge
                  variant="outline"
                  className="max-w-36 shrink-0 truncate text-[10px] font-medium text-muted-foreground"
                >
                  {group.code}
                </Badge>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pct}
                  aria-label={`${group.name ?? group.code}: ${group.submitted} of ${total} submitted`}
                  className="h-1 w-24 shrink-0 overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className={cn("h-full rounded-full transition-all", barClass)}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {group.submitted}/{total} submitted
                </span>
                {group.overdue > 0 && (
                  <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-red-600 dark:text-red-400">
                    {group.overdue} overdue
                  </span>
                )}
                {pending > 0 && group.nextPendingMs != null && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                      group.nextPendingMs < now
                        ? "bg-red-500/10 text-red-600 dark:text-red-400"
                        : group.nextPendingMs - now < 7 * 86_400_000
                          ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                          : "bg-muted text-muted-foreground"
                    )}
                  >
                    last date {fmtDay(new Date(group.nextPendingMs).toISOString())}
                  </span>
                )}
              </div>
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="space-y-1.5 px-2.5 pb-2.5">
            {group.items.map((a) => {
              const done = a.status !== "ACTIVE";
              const overdue = !done && new Date(a.dueAt).getTime() < now;
              const isAla = /\bala/i.test(a.title);
              return (
                <motion.li
                  key={a.id}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                  className={cn(
                    "flex items-start gap-2.5 rounded-lg border p-2.5 transition-colors",
                    done
                      ? "border-emerald-500/25 bg-emerald-500/[0.05]"
                      : overdue
                        ? "border-red-500/30 bg-red-500/[0.04]"
                        : "border-amber-500/25 bg-amber-500/[0.04]",
                    done && "opacity-75"
                  )}
                >
                  <span
                    role="img"
                    aria-label={done ? "Submitted" : "Not submitted"}
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
                      done
                        ? "border-emerald-500 bg-emerald-500 text-white"
                        : "border-amber-500/60 text-amber-600 dark:text-amber-400"
                    )}
                  >
                    {done ? (
                      <CheckCircle2 className="size-3.5" aria-hidden="true" />
                    ) : (
                      <Clock className="size-3" aria-hidden="true" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <p
                        className={cn(
                          "min-w-0 text-sm font-medium leading-snug",
                          done && "line-through decoration-muted-foreground/50"
                        )}
                      >
                        {a.title}
                      </p>
                      {isAla && (
                        <Badge
                          variant="secondary"
                          className="px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-primary"
                        >
                          ALA
                        </Badge>
                      )}
                    </div>
                    {a.description && (
                      <p
                        className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground"
                        title={a.description}
                      >
                        {a.description}
                      </p>
                    )}
                    <p className="mt-0.5 text-[11px]">
                      <span
                        className={cn(
                          "font-semibold",
                          done
                            ? "text-emerald-700 dark:text-emerald-400"
                            : overdue
                              ? "text-red-600 dark:text-red-400"
                              : "text-amber-700 dark:text-amber-400"
                        )}
                      >
                        {done ? "Submitted" : overdue ? "Overdue — was due" : "Pending · last date"}
                      </span>{" "}
                      <span
                        className={cn(
                          "tabular-nums",
                          overdue ? "text-red-600 dark:text-red-400" : "text-muted-foreground"
                        )}
                      >
                        {fmtDay(a.dueAt)}
                      </span>
                      {!done && (
                        <span
                          className={cn(
                            "ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                            overdue
                              ? "bg-red-500/10 text-red-600 dark:text-red-400"
                              : new Date(a.dueAt).getTime() - now < 7 * 86_400_000
                                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                                : "bg-muted text-muted-foreground"
                          )}
                        >
                          {relDue(new Date(a.dueAt).getTime(), now)}
                        </span>
                      )}
                    </p>
                  </div>
                </motion.li>
              );
            })}
          </ul>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

/**
 * Subject-wise ALA & assignments list, synced from the ERP's Assignments page
 * (spec #6: ERP truth only; the local list is a read-only mirror — #14).
 * Every row shows whether it is complete ("Submitted") or not ("Pending" /
 * "Overdue") and the ERP End Date — the last date to submit.
 * Includes search, status filter, sorting, expand/collapse-all and a
 * one-click .ics export of every not-yet-submitted deadline.
 */
type AlaStatusFilter = "all" | "pending" | "overdue" | "submitted";
type AlaSort = "deadline" | "course";

const ALA_STATUS_META: { key: AlaStatusFilter; label: string; activeClass: string }[] = [
  { key: "all", label: "All", activeClass: "bg-primary text-primary-foreground" },
  { key: "pending", label: "Pending", activeClass: "bg-amber-500/20 text-amber-800 dark:text-amber-300 border-amber-500/50" },
  { key: "overdue", label: "Overdue", activeClass: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/50" },
  { key: "submitted", label: "Submitted", activeClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/50" },
];

/* ------------------------------------------------------------------ */

/** Plain-text overdue digest — paste-ready for classmates / notes / email. */
function buildDigestText(groups: AlaGroup[], now: number): string {
  const overdueGroups = groups.filter((g) => g.overdue > 0);
  const totalOverdue = overdueGroups.reduce((n, g) => n + g.overdue, 0);
  const lines: string[] = [];
  lines.push(`ALA & assignment digest — ${fmtDay(new Date(now).toISOString())}`);
  lines.push(
    `${totalOverdue} overdue across ${overdueGroups.length} of ${groups.length} subjects`
  );
  for (const g of overdueGroups) {
    const lastMs = g.nextPendingMs ?? 0;
    lines.push(
      `  ${g.name ?? g.code} (${g.code}) — ${g.overdue} overdue, last date ${fmtDay(new Date(lastMs).toISOString())}`
    );
  }
  const upcoming = groups
    .flatMap((g) => g.items)
    .filter((a) => a.status === "ACTIVE" && new Date(a.dueAt).getTime() >= now)
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
    .slice(0, 3);
  if (upcoming.length > 0) {
    lines.push("Next upcoming:");
    for (const a of upcoming) {
      lines.push(
        `  ${a.subjectCode ? `${a.subjectCode} · ` : ""}${a.title} — ${fmtDay(a.dueAt)} (${relDue(new Date(a.dueAt).getTime(), now)})`
      );
    }
  }
  return lines.join("\n");
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Red digest banner summarizing the overdue wall — with a copyable text digest. */
function AlaOverdueDigest({
  groups,
  onViewOverdue,
}: {
  groups: AlaGroup[];
  onViewOverdue: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const now = useNow();

  const overdueGroups = groups.filter((g) => g.overdue > 0);
  const totalOverdue = overdueGroups.reduce((n, g) => n + g.overdue, 0);
  if (totalOverdue === 0) return null;
  const worst = [...overdueGroups].sort((a, b) => b.overdue - a.overdue)[0];
  const nextUp = groups
    .flatMap((g) => g.items)
    .filter((a) => a.status === "ACTIVE" && new Date(a.dueAt).getTime() >= now)
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0];

  const copy = async () => {
    const ok = await copyText(buildDigestText(groups, now));
    if (ok) {
      setCopied(true);
      toast.success("Digest copied to clipboard", {
        description: `${totalOverdue} overdue across ${overdueGroups.length} subjects — paste it anywhere.`,
      });
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error("Could not access the clipboard");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      role="status"
      aria-label={`Overdue digest: ${totalOverdue} overdue across ${overdueGroups.length} subjects`}
      className="flex flex-col gap-2.5 rounded-xl border border-red-500/30 bg-gradient-to-r from-red-500/[0.09] via-amber-500/[0.05] to-transparent p-3 sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-600 dark:text-red-400">
          <TriangleAlert className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight text-red-700 dark:text-red-300">
            {totalOverdue} overdue across {overdueGroups.length} subject
            {overdueGroups.length === 1 ? "" : "s"}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            Worst: {worst.name ?? worst.code} ({worst.overdue})
            {nextUp
              ? ` · next open deadline ${fmtDay(nextUp.dueAt)} (${relDue(new Date(nextUp.dueAt).getTime(), now)})`
              : " · nothing upcoming"}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 pl-9 sm:pl-0">
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 border-red-500/40 px-2.5 text-xs text-red-700 hover:bg-red-500/10 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200"
          onClick={copy}
          aria-label="Copy the overdue digest as text"
        >
          {copied ? (
            <Check className="size-3.5" aria-hidden="true" />
          ) : (
            <ClipboardList className="size-3.5" aria-hidden="true" />
          )}
          {copied ? "Copied" : "Copy digest"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={onViewOverdue}
          aria-label="Show only overdue rows"
        >
          View
        </Button>
      </div>
    </motion.div>
  );
}

function AlaSection() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: qk.assignments,
    queryFn: fetchAssignments,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const now = useNow();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<AlaStatusFilter>("all");
  const [sort, setSort] = useState<AlaSort>("deadline");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo<AlaGroup[]>(() => {
    if (!data) return [];
    const map = new Map<string, AlaGroup>();
    for (const a of data.assignments) {
      const code = a.subjectCode ?? "UNKNOWN";
      let g = map.get(code);
      if (!g) {
        g = {
          code,
          name: data.courseNames[code] ?? a.subjectName ?? null,
          items: [],
          submitted: 0,
          nextPendingMs: null,
          overdue: 0,
        };
        map.set(code, g);
      }
      g.items.push(a);
      if (a.status !== "ACTIVE") g.submitted++;
    }
    const list = [...map.values()];
    for (const g of list) {
      g.items.sort((x, y) => new Date(x.dueAt).getTime() - new Date(y.dueAt).getTime());
      const pend = g.items
        .filter((i) => i.status === "ACTIVE")
        .map((i) => new Date(i.dueAt).getTime());
      g.nextPendingMs = pend.length > 0 ? Math.min(...pend) : null;
      g.overdue = pend.filter((ms) => ms < now).length;
    }
    // Groups with the nearest pending deadline first; done-only groups last.
    return list.sort((x, y) => {
      const xp = x.nextPendingMs ?? Number.POSITIVE_INFINITY;
      const yp = y.nextPendingMs ?? Number.POSITIVE_INFINITY;
      return xp - yp || (x.name ?? x.code).localeCompare(y.name ?? y.code);
    });
  }, [data, now]);

  /* Live counts for the filter chips (computed from the unfiltered set). */
  const counts = useMemo(() => {
    let pending = 0;
    let overdue = 0;
    let submitted = 0;
    for (const a of data?.assignments ?? []) {
      if (a.status === "ACTIVE") {
        if (new Date(a.dueAt).getTime() < now) overdue++;
        else pending++;
      } else submitted++;
    }
    return { all: (data?.assignments.length ?? 0) as number, pending, overdue, submitted };
  }, [data, now]);

  /* Search + status filter + sort — applied per row, then empty groups drop out. */
  const visibleGroups = useMemo<AlaGroup[]>(() => {
    const q = query.trim().toLowerCase();
    let list = groups;
    if (q || status !== "all") {
      list = groups
        .map((g) => {
          const matchesQuery =
            q === "" ||
            g.code.toLowerCase().includes(q) ||
            (g.name ?? "").toLowerCase().includes(q) ||
            g.items.some(
              (a) =>
                a.title.toLowerCase().includes(q) ||
                (a.description ?? "").toLowerCase().includes(q)
            );
          if (!matchesQuery) return null;
          const items = g.items.filter((a) => {
            if (q !== "" && !(
              g.code.toLowerCase().includes(q) ||
              (g.name ?? "").toLowerCase().includes(q) ||
              a.title.toLowerCase().includes(q) ||
              (a.description ?? "").toLowerCase().includes(q)
            )) return false;
            if (status === "all") return true;
            const done = a.status !== "ACTIVE";
            if (status === "submitted") return done;
            if (done) return false;
            return status === "overdue" ? new Date(a.dueAt).getTime() < now : new Date(a.dueAt).getTime() >= now;
          });
          if (items.length === 0) return null;
          const submittedCount = items.filter((a) => a.status !== "ACTIVE").length;
          const pend = items
            .filter((a) => a.status === "ACTIVE")
            .map((a) => new Date(a.dueAt).getTime());
          return {
            ...g,
            items,
            submitted: submittedCount,
            nextPendingMs: pend.length > 0 ? Math.min(...pend) : null,
            overdue: pend.filter((ms) => ms < now).length,
          } satisfies AlaGroup;
        })
        .filter((g): g is AlaGroup => g !== null);
    }
    if (sort === "course") {
      list = [...list].sort((x, y) => (x.name ?? x.code).localeCompare(y.name ?? y.code));
    }
    return list;
  }, [groups, query, status, sort, now]);

  const total = data?.assignments.length ?? 0;
  const submitted = counts.submitted;
  const pending = counts.pending + counts.overdue;
  const searching = query.trim() !== "" || status !== "all";
  const hasActiveDeadlines = counts.pending + counts.overdue > 0;

  const exportAlaIcs = () => {
    if (!data) return;
    const active = data.assignments.filter((a) => a.status === "ACTIVE");
    const filename = downloadRemindersIcs(
      active.map((a) => ({
        id: a.id,
        title: `${a.subjectCode ? `${a.subjectCode} · ` : ""}${a.title}`,
        description: a.description,
        dueAt: a.dueAt,
        type: "ASSIGNMENT" as const,
        source: a.source,
      })),
      "ALA & assignment deadlines (ERP Sync)"
    );
    toast.success(`${filename} downloaded`, {
      description: `${active.length} open deadline${active.length === 1 ? "" : "s"} — import into your calendar app.`,
    });
  };

  const toggleAll = (open: boolean) =>
    setCollapsed(open ? new Set() : new Set(visibleGroups.map((g) => g.code)));

  const allOpen = visibleGroups.length > 0 && visibleGroups.every((g) => !collapsed.has(g.code));

  return (
    <Card className="rounded-xl border-border/60">
      <CardHeader className="flex flex-col gap-3 space-y-0 pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base tracking-tight">
            <ClipboardList className="size-4.5 text-primary" aria-hidden="true" />
            ALA &amp; Assignments
            {data?.sourceSemester != null && data?.semester !== String(data.sourceSemester) && (
              <Badge
                variant="outline"
                className="border-amber-500/50 bg-amber-500/10 px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400"
                title="The ERP only publishes assignments for its current semester, so this list stays the same no matter which semester partition is selected."
              >
                Synced for Sem {data.sourceSemester} · ERP current
              </Badge>
            )}
          </CardTitle>
          <CardDescription className="text-xs">
            Subject-wise, synced from the ERP Assignments page — read-only mirror
            {data?.sourceSemester != null && ` · Sem ${data.sourceSemester} (ERP current)`}
          </CardDescription>
        </div>
        {total > 0 && (
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge variant="secondary" className="tabular-nums">
              {pending} pending
            </Badge>
            <Badge
              variant="outline"
              className="tabular-nums text-emerald-700 dark:text-emerald-400"
            >
              {submitted} submitted
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              disabled={!hasActiveDeadlines}
              onClick={exportAlaIcs}
              aria-label="Export all open ALA deadlines as a calendar (.ics) file"
              title="Export all open deadlines as .ics"
            >
              <Download className="size-4" aria-hidden="true" />
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex items-center gap-2.5 text-sm text-red-600 dark:text-red-400">
            <XCircle className="size-4 shrink-0" aria-hidden="true" />
            Could not load the ALA list: {error?.message ?? "unknown error"}
          </div>
        ) : total === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/80 bg-card/50 px-6 py-8 text-center">
            <ClipboardList className="size-7 text-muted-foreground/50" aria-hidden="true" />
            {data?.mode === "none" ? (
              <>
                <p className="text-sm font-medium">No ERP connection yet</p>
                <p className="max-w-md text-xs text-muted-foreground">
                  Connect your ERP account in Settings and sync once — your ALA list will
                  appear here, grouped subject-wise.
                </p>
              </>
            ) : data?.mode === "demo" ? (
              <>
                <p className="text-sm font-medium">Demo mode has no ALA data</p>
                <p className="max-w-md text-xs text-muted-foreground">
                  The demo simulator does not publish assignments. Connect the real ERP to
                  see your ALA list.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">No ALA or assignments on the ERP yet</p>
                <p className="max-w-md text-xs text-muted-foreground">
                  When your faculty publishes ALAs or assignments for the current semester,
                  they appear here automatically after each sync.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-2.5">
            {/* Search + filter chips + sort — sticky-feeling control row */}
            <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-muted/25 p-2.5 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search title, course or code…"
                  aria-label="Search the ALA list"
                  className="h-8 border-border/70 bg-background pl-8 pr-8 text-xs"
                />
                {query !== "" && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Select value={sort} onValueChange={(v) => setSort(v as AlaSort)}>
                  <SelectTrigger
                    className="h-8 w-[150px] shrink-0 gap-1 bg-background text-xs"
                    aria-label="Sort ALA groups"
                  >
                    <ArrowDownUp className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deadline" className="text-xs">Nearest deadline</SelectItem>
                    <SelectItem value="course" className="text-xs">Course A–Z</SelectItem>
                  </SelectContent>
                </Select>
                {!searching && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 gap-1 px-2.5 text-xs"
                    onClick={() => toggleAll(!allOpen)}
                    aria-label={allOpen ? "Collapse every subject group" : "Expand every subject group"}
                  >
                    {allOpen ? (
                      <ChevronsDownUp className="size-3.5" aria-hidden="true" />
                    ) : (
                      <ChevronsUpDown className="size-3.5" aria-hidden="true" />
                    )}
                    {allOpen ? "Collapse" : "Expand"}
                  </Button>
                )}
              </div>
            </div>

            {/* Status filter chips with live counts */}
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by status">
              {ALA_STATUS_META.map((f) => {
                const active = status === f.key;
                const n = counts[f.key];
                return (
                  <button
                    key={f.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setStatus(f.key)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? `${f.activeClass} border-transparent shadow-sm`
                        : "border-border/70 bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                  >
                    {f.label}
                    <span
                      className={cn(
                        "rounded-full px-1.5 text-[10px] font-bold tabular-nums",
                        active ? "bg-background/40" : "bg-muted"
                      )}
                    >
                      {n}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Overdue digest — collapses to nothing the moment no row is overdue */}
            {!searching && (
              <AlaOverdueDigest groups={groups} onViewOverdue={() => setStatus("overdue")} />
            )}

            {visibleGroups.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-border/80 bg-card/40 px-6 py-8 text-center">
                <Search className="size-6 text-muted-foreground/50" aria-hidden="true" />
                <p className="text-sm font-medium">Nothing matches</p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  No ALA rows match {query.trim() ? `“${query.trim()}”` : "this filter"}.
                  Try a different search or switch the status chip.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-1 h-7 text-xs"
                  onClick={() => {
                    setQuery("");
                    setStatus("all");
                  }}
                >
                  Reset search &amp; filters
                </Button>
              </div>
            ) : (
              visibleGroups.map((g) => (
                <AlaSubjectGroup
                  key={g.code}
                  group={g}
                  open={searching || !collapsed.has(g.code)}
                  onOpenChange={(o) =>
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (o) next.delete(g.code);
                      else next.add(g.code);
                      return next;
                    })
                  }
                />
              ))
            )}
            <p className="px-1 pt-1 text-[11px] text-muted-foreground">
              Completion reflects the ERP’s own Submission Status; “last date” is the ERP
              End Date. Items you submit on the ERP turn Submitted at the next sync.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

const GROUP_ORDER: DueGroup[] = ["overdue", "today", "tomorrow", "week", "later", "done"];

function RemindersList({ items }: { items: Reminder[] }) {
  const now = useNow();
  const [doneOpen, setDoneOpen] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<DueGroup, Reminder[]>();
    for (const g of GROUP_ORDER) map.set(g, []);
    for (const r of items) {
      map.get(dueGroup(r.dueAt, r.status, now))?.push(r);
    }
    return map;
  }, [items, now]);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/80 bg-card/50 px-6 py-12 text-center">
        <CalendarClock className="size-8 text-muted-foreground/50" aria-hidden="true" />
        <p className="text-sm font-medium">No reminders here</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Active reminders from the ERP (exams, submissions, attendance warnings) and anything you add yourself will show up in this list.
        </p>
      </div>
    );
  }

  const doneCount = grouped.get("done")?.length ?? 0;

  return (
    <div className="space-y-5">
      {GROUP_ORDER.filter((g) => g !== "done").map((g) => {
        const list = grouped.get(g) ?? [];
        if (list.length === 0) return null;
        const meta = GROUP_META[g];
        return (
          <section key={g} aria-label={meta.label}>
            <h3 className={cn("mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide", meta.className)}>
              {g === "overdue" && <AlertTriangle className="size-3.5" aria-hidden="true" />}
              {meta.label}
              <span className="font-normal text-muted-foreground tabular-nums">({list.length})</span>
            </h3>
            <ul className="space-y-2">
              {list.map((r) => (
                <ReminderRow key={r.id} r={r} onDeleted={() => undefined} />
              ))}
            </ul>
          </section>
        );
      })}

      {doneCount > 0 && (
        <Collapsible open={doneOpen} onOpenChange={setDoneOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-expanded={doneOpen}
            >
              <ChevronDown className={cn("size-3.5 transition-transform", doneOpen && "rotate-180")} aria-hidden="true" />
              Done
              <span className="font-normal tabular-nums">({doneCount})</span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-2 space-y-2">
              {(grouped.get("done") ?? []).map((r) => (
                <ReminderRow key={r.id} r={r} onDeleted={() => undefined} />
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

const GENERAL_KEY = "__general__";

/** Deterministic hue (0–359) for a subject code, stable across reloads. */
function subjectHue(code: string): number {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) % 360;
  return h;
}

interface SubjectGroup {
  key: string;
  code: string | null;
  name: string;
  semester: number | null;
  items: Reminder[];
  doneCount: number;
  openOverdue: number;
  /** Latest due date in the group (ISO). */
  lastDate: string;
  /** Soonest due date among OPEN items (ISO) — drives group ordering. */
  soonestOpen: string | null;
}

function buildSubjectGroups(items: Reminder[]): SubjectGroup[] {
  const map = new Map<string, SubjectGroup>();
  for (const r of items) {
    const key = r.subjectCode ?? GENERAL_KEY;
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        code: r.subjectCode,
        name: r.subjectCode ? (r.subjectName ?? r.subjectCode) : "General",
        semester: r.subjectSemester ?? null,
        items: [],
        doneCount: 0,
        openOverdue: 0,
        lastDate: r.dueAt,
        soonestOpen: null,
      };
      map.set(key, g);
    }
    g.items.push(r);
    if (r.status !== "ACTIVE") g.doneCount++;
    if (r.subjectCode && !g.code) g.code = r.subjectCode;
    if (r.subjectCode && g.name === "General") g.name = r.subjectName ?? r.subjectCode;
    if (r.subjectSemester != null && g.semester == null) g.semester = r.subjectSemester;
    if (new Date(r.dueAt).getTime() > new Date(g.lastDate).getTime()) g.lastDate = r.dueAt;
    if (r.status === "ACTIVE") {
      const so = g.soonestOpen && new Date(g.soonestOpen).getTime() <= new Date(r.dueAt).getTime() ? g.soonestOpen : r.dueAt;
      g.soonestOpen = so;
      if (new Date(r.dueAt).getTime() < Date.now()) g.openOverdue++;
    }
  }
  const groups = [...map.values()];
  groups.sort((a, b) => {
    // groups with open work first, by soonest open deadline; done-only groups
    // sink to the bottom ordered by most recently due.
    if (a.soonestOpen && b.soonestOpen) return a.soonestOpen.localeCompare(b.soonestOpen);
    if (a.soonestOpen) return -1;
    if (b.soonestOpen) return 1;
    return b.lastDate.localeCompare(a.lastDate);
  });
  for (const g of groups) g.items.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  return groups;
}

function SubjectGroupsList({ items }: { items: Reminder[] }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/80 bg-card/50 px-6 py-12 text-center">
        <CalendarClock className="size-8 text-muted-foreground/50" aria-hidden="true" />
        <p className="text-sm font-medium">No reminders here</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Active reminders from the ERP (exams, submissions, attendance warnings) and anything you add yourself will show up in this list.
        </p>
      </div>
    );
  }

  const groups = buildSubjectGroups(items);
  const doneTotal = groups.reduce((n, g) => n + g.doneCount, 0);
  const subjectCount = groups.filter((g) => g.code !== null).length;

  return (
    <div className="space-y-3">
      <p className="px-1 text-xs text-muted-foreground">
        Grouped by subject ·{" "}
        <span className="tabular-nums">{groups.length}</span>{" "}
        {groups.length === 1 ? "group" : "groups"} ({subjectCount} subject{subjectCount === 1 ? "" : "s"} + general) ·{" "}
        <span className="tabular-nums">{doneTotal}/{items.length}</span> completed
      </p>

      {groups.map((g) => {
        const pct = Math.round((g.doneCount / g.items.length) * 100);
        const hue = g.code ? subjectHue(g.code) : 260;
        const allDone = g.doneCount === g.items.length;
        return (
          <Card key={g.key} className="overflow-hidden rounded-xl border-border/60">
            <div
              className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-border/60 bg-muted/40 px-3 py-2.5 sm:px-4"
              style={{ borderLeft: `3px solid hsl(${hue} 65% 45%)` }}
            >
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: `hsl(${hue} 65% 45%)` }}
                aria-hidden="true"
              />
              <p className="min-w-0 flex-1 truncate text-sm font-semibold leading-tight" title={g.name}>
                {g.name}
              </p>
              {g.code && <Badge variant="outline" className="shrink-0 text-[10px]">{g.code}</Badge>}
              {g.semester != null && (
                <Badge variant="secondary" className="shrink-0 text-[10px]">Sem {g.semester}</Badge>
              )}
              {g.openOverdue > 0 && (
                <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-red-600 dark:text-red-400">
                  <TriangleAlert className="size-3" aria-hidden="true" />
                  {g.openOverdue} overdue
                </span>
              )}
              <span
                className="inline-flex shrink-0 items-center gap-1.5"
                title={`${g.doneCount} of ${g.items.length} reminders completed`}
              >
                <span
                  className={cn(
                    "text-[11px] tabular-nums",
                    allDone ? "font-semibold text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
                  )}
                >
                  {g.doneCount}/{g.items.length} done
                </span>
                <span className="h-1 w-14 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${g.name} completion`}>
                  <span
                    className={cn("block h-full rounded-full transition-[width] duration-300", allDone ? "bg-emerald-500" : "bg-emerald-500/70")}
                    style={{ width: `${pct}%` }}
                  />
                </span>
              </span>
              <span
                className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground"
                title="Latest due date in this group"
              >
                <CalendarDays className="size-3" aria-hidden="true" />
                Last date:
                <span className="font-medium tabular-nums text-foreground">{fmtDT(g.lastDate)}</span>
              </span>
            </div>
            <CardContent className="p-3 sm:p-4">
              <ul className="space-y-2">
                {g.items.map((r) => (
                  <ReminderRow key={r.id} r={r} onDeleted={() => undefined} />
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** Compact opt-in banner for system due-reminders (only until a decision). */
function BrowserRemindersBanner() {
  const [state, setState] = useState<{ permission: string; enabled: boolean; dismissed: boolean }>({
    permission: "default",
    enabled: false,
    dismissed: true,
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const read = () => {
      let dismissed = true;
      try {
        dismissed = window.localStorage.getItem("erp.browserReminders.bannerDismissed") === "1";
      } catch {
        /* non-fatal */
      }
      setState({
        permission: browserRemindersPermission(),
        enabled: browserRemindersEnabled(),
        dismissed,
      });
    };
    read();
    window.addEventListener(BROWSER_REMINDERS_EVENT, read);
    return () => window.removeEventListener(BROWSER_REMINDERS_EVENT, read);
  }, []);

  if (state.dismissed || state.permission !== "default") return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem("erp.browserReminders.bannerDismissed", "1");
    } catch {
      /* non-fatal */
    }
    setState((s) => ({ ...s, dismissed: true }));
  };

  const enable = async () => {
    setBusy(true);
    const result = await requestNotificationPermission();
    setBusy(false);
    if (result === "granted") {
      setBrowserRemindersEnabled(true);
      toast.success("Browser reminders on");
    } else if (result === "denied") {
      toast.error("Permission denied", { description: "Allow notifications for this site in your browser settings." });
    }
    dismiss();
  };

  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-primary/25 bg-primary/[0.05] px-4 py-3">
      <CalendarClock className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-xs sm:text-sm">
        <span className="font-medium">Never miss a deadline.</span>{" "}
        <span className="text-muted-foreground">Get a system alert when a reminder becomes due.</span>
      </p>
      <div className="flex items-center gap-1.5">
        <Button size="sm" className="h-7 gap-1 px-2.5 text-xs" onClick={enable} disabled={busy}
          aria-label="Enable browser due-reminder notifications">
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <BellRing className="size-3.5" aria-hidden="true" />}
          Enable
        </Button>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={dismiss}
          aria-label="Dismiss browser reminders banner">
          Not now
        </Button>
      </div>
    </div>
  );
}

export function RemindersTab() {
  const [filter, setFilter] = useState<RemindersFilter>("all");
  const [includeDone, setIncludeDone] = useState(false);
  const [view, setView] = useState<"timeline" | "subject">("timeline");

  const { data, isPending, isError, error } = useQuery({
    queryKey: qk.reminders(filter, includeDone),
    queryFn: () => fetchReminders(filter, includeDone),
    refetchInterval: 20_000,
  });

  return (
    <div className="space-y-4">
      <BrowserRemindersBanner />
      <AlaSection />
      <Card className="rounded-xl border-border/60">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div
            role="tablist"
            aria-label="Filter reminders"
            className="flex rounded-lg border border-border/60 bg-muted/60 p-0.5"
          >
            {(["all", "erp", "personal"] as const).map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={cn(
                  "h-8 rounded-md px-3 text-xs font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  filter === f ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {f === "all" ? "All" : f === "erp" ? "ERP" : "Personal"}
              </button>
            ))}
          </div>

          <div
            role="tablist"
            aria-label="List layout"
            className="flex rounded-lg border border-border/60 bg-muted/60 p-0.5"
          >
            {(["timeline", "subject"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={cn(
                  "inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  view === v ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {v === "timeline" ? (
                  <CalendarClock className="size-3.5" aria-hidden="true" />
                ) : (
                  <BookOpen className="size-3.5" aria-hidden="true" />
                )}
                {v === "timeline" ? "Timeline" : "By subject"}
              </button>
            ))}
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={includeDone} onCheckedChange={setIncludeDone} aria-label="Show completed reminders" />
            Show completed
          </label>

          <div className="ml-auto flex items-center gap-2">
            {data && data.some((r) => r.status === "ACTIVE" && r.type !== "ATTENDANCE_WARNING") && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => {
                  const active = data.filter(
                    (r) => r.status === "ACTIVE" && r.type !== "ATTENDANCE_WARNING"
                  );
                  const filename = downloadRemindersIcs(
                    active.map((r) => ({
                      id: r.id,
                      title: r.title,
                      description: r.description,
                      dueAt: r.dueAt,
                      type: r.type,
                      source: r.source,
                    }))
                  );
                  toast.success(`${filename} downloaded`, {
                    description: `${active.length} deadline${active.length === 1 ? "" : "s"} exported as calendar events.`,
                  });
                }}
                aria-label="Export active deadlines as a calendar (.ics) file"
              >
                <CalendarPlus className="size-3.5" aria-hidden="true" />
                .ics
              </Button>
            )}
            {data && data.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() =>
                  downloadCsv(
                    `reminders-${new Date().toISOString().slice(0, 10)}.csv`,
                    ["Title", "Source", "Type", "Subject", "Due at", "Status", "Description"],
                    data.map((r) => [
                      r.title,
                      r.source,
                      typeLabel(r.type),
                      r.subjectName ?? (r.subjectCode ?? ""),
                      fmtDT(r.dueAt),
                      r.status === "DONE" ? "Complete" : r.status === "DISMISSED" ? "Dismissed" : "Open",
                      r.description ?? "",
                    ])
                  )
                }
              >
                <Download className="size-3.5" aria-hidden="true" />
                Export CSV
              </Button>
            )}
            <NewReminderDialog />
          </div>
        </CardContent>
      </Card>

      {isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <Card className="rounded-xl border-red-500/30 bg-red-500/5">
          <CardContent className="flex items-center gap-3 p-6 text-sm text-red-600 dark:text-red-400">
            <XCircle className="size-5 shrink-0" aria-hidden="true" />
            Could not load reminders: {error?.message ?? "unknown error"}
          </CardContent>
        </Card>
      ) : (
        view === "timeline" ? <RemindersList items={data ?? []} /> : <SubjectGroupsList items={data ?? []} />
      )}
    </div>
  );
}
