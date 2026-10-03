"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowDownUp,
  BarChart3,
  BellRing,
  BookOpen,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Circle,
  ClipboardList,
  Clock,
  Download,
  ExternalLink,
  Flag,
  Link2,
  Loader2,
  Lock,
  Plus,
  Search,
  StickyNote,
  Trash2,
  TriangleAlert,
  Upload,
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  fetchAlaNotes,
  fetchAssignments,
  fetchAttendance,
  fetchReminders,
  qk,
  snoozeReminder,
  saveAlaNote,
  submitAlaToErp,
  updateReminderStatus,
  updateReminderSubject,
  ApiError,
} from "./api";
import { dueGroup, ERP_BASE, erpAssignmentUrl, fmtDT, fmtDay, GROUP_META, SourceBadge, TypeIcon, typeLabel, useNow } from "./shared";
import { downloadCsv } from "./trend-chart";
import type { DueGroup } from "./shared";
import type { AlaNoteRow, RemindersFilter, Reminder, ReminderType } from "./types";

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
/* ------------------------------------------------------------------ */
/* ALA submit-to-portal (explicit write-back)                           */
/* ------------------------------------------------------------------ */

const ALA_FILE_ACCEPT = ".pdf,.docx,.zip,.xlsx,.ppt,.csv,.mp4,.png,.jpg,.jpeg,.pptx,.odp";

/* ---------------- Local note/priority overlay on ALA rows ---------------- */

const ALA_NOTE_MAX = 2000;

/** Priority levels 1–3 with their visual identity (0 = "None" = no visuals).
 *  Exported so the dashboard's flagged-ALA glance card and the command palette
 *  reuse the exact same color language instead of growing divergent copies.
 *  `chip`/`border`/`topAccent` tint surfaces; `icon` colors bare flag icons. */
export const ALA_PRIORITY_META: Record<
  number,
  { label: string; chip: string; border: string; topAccent: string; activeBtn: string; icon: string }
> = {
  3: {
    label: "High",
    chip: "bg-red-500/10 text-red-700 dark:text-red-400",
    border: "border-l-red-500/80",
    topAccent: "border-t-red-500/70",
    activeBtn: "bg-red-500/15 text-red-700 ring-1 ring-red-500/40 dark:text-red-400",
    icon: "text-red-500",
  },
  2: {
    label: "Medium",
    chip: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
    border: "border-l-violet-500/80",
    topAccent: "border-t-violet-500/70",
    activeBtn: "bg-violet-500/15 text-violet-700 ring-1 ring-violet-500/40 dark:text-violet-400",
    icon: "text-violet-500",
  },
  1: {
    label: "Low",
    chip: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
    border: "border-l-sky-500/80",
    topAccent: "border-t-sky-500/70",
    activeBtn: "bg-sky-500/15 text-sky-700 ring-1 ring-sky-500/40 dark:text-sky-400",
    icon: "text-sky-500",
  },
};

export function alaPriorityOf(p: number | undefined) {
  return (p != null && ALA_PRIORITY_META[p]) || null;
}

/**
 * Popover editor for one ALA row's LOCAL note + triage priority. Purely a
 * local overlay (table AlaNote, keyed by the row's stable externalId): the
 * sync engine never reads it and nothing is ever sent back to the ERP.
 * Saving an empty note with priority "None" deletes the overlay row.
 */
function AlaNoteEditor({
  row,
  existing,
  onSave,
  children,
}: {
  row: Reminder;
  existing: AlaNoteRow | null;
  /** Receives the saved row from the server, or null when the overlay was cleared. */
  onSave: (externalId: string, note: string, priority: number) => Promise<void>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [priority, setPriority] = useState(0);
  const [busy, setBusy] = useState(false);

  // Re-seed the draft from the saved state each time the popover opens.
  useEffect(() => {
    if (open) {
      setDraft(existing?.note ?? "");
      setPriority(existing?.priority ?? 0);
    }
  }, [open, existing]);

  const dirty = draft !== (existing?.note ?? "") || priority !== (existing?.priority ?? 0);

  const commit = async (nextNote: string, nextPriority: number) => {
    setBusy(true);
    try {
      await onSave(row.externalId ?? "", nextNote, nextPriority);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="end"
        className={cn("w-80 border-t-2 p-3 transition-colors", alaPriorityOf(priority)?.topAccent ?? "border-t-transparent")}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <p className="text-xs font-semibold leading-none">Local note</p>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          Private to this device&apos;s database — never shown on the ERP.
        </p>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, ALA_NOTE_MAX))}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !busy) {
              e.preventDefault();
              void commit(draft, priority);
            }
          }}
          rows={3}
          maxLength={ALA_NOTE_MAX}
          placeholder="e.g. wait for faculty's second slide deck before submitting…"
          aria-label={`Note for ${row.title}`}
          className="mt-2 min-h-16 resize-y text-xs"
        />
        <div className="mt-2">
          <p className="text-[11px] font-medium text-muted-foreground">Priority</p>
          <div role="group" aria-label={`Priority for ${row.title}`} className="mt-1 flex gap-1">
            {[0, 1, 2, 3].map((p) => {
              const meta = alaPriorityOf(p);
              const active = priority === p;
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setPriority(p)}
                  className={cn(
                    "flex-1 rounded-md px-1.5 py-1 text-[11px] font-semibold transition-colors",
                    active && meta
                      ? meta.activeBtn
                      : active
                        ? "bg-muted text-foreground ring-1 ring-border"
                        : "text-muted-foreground hover:bg-muted/60"
                  )}
                >
                  {meta ? meta.label : "None"}
                </button>
              );
            })}
          </div>
        </div>
        <div className="mt-2.5 flex items-center gap-1.5">
          <span className={cn("text-[10px] tabular-nums", draft.length >= ALA_NOTE_MAX ? "text-red-600" : "text-muted-foreground")}>
            {draft.length}/{ALA_NOTE_MAX}
          </span>
          <span className="flex-1" />
          {(existing?.note || (existing?.priority ?? 0) > 0) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
              disabled={busy}
              onClick={() => void commit("", 0)}
              aria-label={`Clear your note for ${row.title}`}
            >
              <Trash2 className="size-3" aria-hidden="true" />
              Clear
            </Button>
          )}
          <Button
            size="sm"
            className="h-7 gap-1 px-2.5 text-[11px]"
            disabled={busy || !dirty}
            onClick={() => void commit(draft, priority)}
            aria-label={`Save your note for ${row.title}`}
          >
            {busy ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : <Check className="size-3" aria-hidden="true" />}
            Save
          </Button>
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground/70">Ctrl+Enter saves · Esc closes</p>
      </PopoverContent>
    </Popover>
  );
}

type SubmitPhase = "idle" | "sending" | "done";

/**
 * Upload ONE ALA to erp.gmiu.edu.in on the student's behalf. Uses the same
 * encrypted session the sync engine uses; the ERP's own confirmation page is
 * the only accepted success proof (never fabricated locally).
 */
function AlaSubmitDialog({
  row,
  open,
  onOpenChange,
}: {
  row: Reminder | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [phase, setPhase] = useState<SubmitPhase>("idle");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const canSend = Boolean(row) && (file !== null || link.trim().length > 0) && phase !== "sending";

  const reset = () => {
    setFile(null);
    setLink("");
    setPhase("idle");
    setResult(null);
  };

  const submit = async () => {
    if (!row) return;
    setPhase("sending");
    setResult(null);
    try {
      const res = await submitAlaToErp(row.id, file, link.trim() || null);
      setPhase("done");
      setResult({ ok: true, message: res.message ?? "Submitted — the ERP confirmed it." });
      toast.success("ALA submitted to the ERP portal", { description: res.message });
      await queryClient.invalidateQueries({ queryKey: qk.assignments });
      await queryClient.invalidateQueries({ queryKey: qk.dashboard });
      await queryClient.invalidateQueries({ queryKey: qk.reminders("erp", true) });
    } catch (e) {
      setPhase("done");
      const msg = e instanceof ApiError ? e.message : "Submission failed — try again.";
      setResult({ ok: false, message: msg });
      toast.error("The ERP did not accept the submission", { description: msg });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setTimeout(reset, 150);
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Upload className="size-4 text-primary" aria-hidden="true" />
            Submit to the ERP portal
          </DialogTitle>
          <DialogDescription>
            {row ? (
              <>
                <span className="font-medium text-foreground">{row.title}</span>
                {row.subjectCode && <span className="ml-1 text-muted-foreground">· {row.subjectCode}</span>}
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {phase !== "done" ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ala-file" className="text-xs font-medium">
                File (PDF, DOCX, ZIP, XLSX, PPT, CSV, MP4, PNG/JPG…)
              </Label>
              <Input
                id="ala-file"
                type="file"
                accept={ALA_FILE_ACCEPT}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="cursor-pointer file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-primary"
              />
              {file && (
                <p className="text-[11px] text-muted-foreground">
                  {file.name} · {(file.size / 1024).toFixed(0)} KB (max 10 MB)
                </p>
              )}
            </div>
            <div className="relative flex items-center gap-3 text-[10px] uppercase tracking-wider text-muted-foreground">
              <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ala-link" className="text-xs font-medium">
                Link (Google Drive, GitHub, …)
              </Label>
              <Input
                id="ala-link"
                type="url"
                placeholder="https://…"
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
            </div>
            <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
              <Lock className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              This uploads directly to erp.gmiu.edu.in with your stored session and cannot be undone
              by this app. The ERP&apos;s own confirmation is required before the row flips to
              &quot;Submitted&quot;.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button size="sm" disabled={!canSend} onClick={submit}>
                {phase === "sending" ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Submitting…
                  </>
                ) : (
                  <>
                    <Upload className="size-3.5" aria-hidden="true" /> Submit now
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div
              className={cn(
                "flex items-start gap-2.5 rounded-lg border p-3 text-sm",
                result?.ok
                  ? "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-400"
                  : "border-red-500/30 bg-red-500/[0.06] text-red-700 dark:text-red-400"
              )}
              role="status"
            >
              {result?.ok ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              ) : (
                <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              )}
              <p className="leading-snug">{result?.message}</p>
            </div>
            <div className="flex justify-end gap-2">
              {!result?.ok && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPhase("idle");
                    setResult(null);
                  }}
                >
                  Try again
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => {
                  onOpenChange(false);
                  setTimeout(reset, 150);
                }}
              >
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AlaSubjectGroup({
  group,
  open,
  onOpenChange,
  notes,
  onSaveNote,
}: {
  group: AlaGroup;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Local note/priority overlays keyed by the row's stable externalId. */
  notes: Map<string, AlaNoteRow>;
  onSaveNote: (externalId: string, note: string, priority: number) => Promise<void>;
}) {
  const now = useNow();
  const [submitRow, setSubmitRow] = useState<Reminder | null>(null);
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
              const dueMs = new Date(a.dueAt).getTime();
              const overdue = !done && dueMs < now;
              // Overdue aging tier — the pill deepens as the deadline recedes further away.
              const lateDays = overdue ? Math.floor((now - dueMs) / 86_400_000) : 0;
              const isAla = /\bala/i.test(a.title);
              // Local overlay: private note + triage priority (never synced to the ERP).
              // externalId is typed string|null — "" never matches an overlay (all are erp:assign:*).
              const noteRow = (a.externalId && notes.get(a.externalId)) || null;
              const prio = alaPriorityOf(noteRow?.priority);
              const hasNote = !!noteRow?.note;
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
                    prio && "border-l-[3px]",
                    prio?.border,
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
                      {prio && (
                        <span
                          title={`Marked ${prio.label.toLowerCase()} priority (local only)`}
                          className={cn(
                            "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider",
                            prio.chip
                          )}
                        >
                          <Flag className="size-2.5" aria-hidden="true" />
                          {prio.label}
                        </span>
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
                    {hasNote && (
                      <p
                        className="mt-0.5 flex items-start gap-1 line-clamp-2 text-[11px] italic leading-snug text-foreground/70"
                        title={noteRow!.note}
                      >
                        <StickyNote className="mt-0.5 size-3 shrink-0 text-primary/70" aria-hidden="true" />
                        <span className="min-w-0">{noteRow!.note}</span>
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
                              ? lateDays > 21
                                ? "bg-red-500/25 text-red-700 ring-1 ring-red-500/50 dark:bg-red-500/20 dark:text-red-200"
                                : lateDays > 7
                                  ? "bg-red-500/15 text-red-600 dark:text-red-300"
                                  : "bg-red-500/10 text-red-600 dark:text-red-400"
                              : dueMs - now < 7 * 86_400_000
                                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                                : "bg-muted text-muted-foreground"
                          )}
                        >
                          {relDue(dueMs, now)}
                        </span>
                      )}
                    </p>
                  </div>
                  <AlaNoteEditor row={a} existing={noteRow} onSave={onSaveNote}>
                    <button
                      type="button"
                      aria-label={
                        hasNote || prio
                          ? `Edit your note for ${a.title}${prio ? ` (currently ${prio.label.toLowerCase()} priority)` : ""}`
                          : `Add a private note to ${a.title}`
                      }
                      title={
                        hasNote || prio
                          ? `Your note${prio ? ` · ${prio.label} priority` : ""} — click to edit`
                          : "Add a private note / priority (local only, never shown on the ERP)"
                      }
                      className={cn(
                        "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        hasNote || prio
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border/50 text-muted-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
                      )}
                    >
                      <StickyNote className="size-3.5" aria-hidden="true" />
                    </button>
                  </AlaNoteEditor>
                  {!done && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 gap-1 px-2 text-[11px]"
                      onClick={() => setSubmitRow(a)}
                      aria-label={`Submit ${a.title} to the ERP portal`}
                    >
                      <Upload className="size-3" aria-hidden="true" />
                      Submit
                    </Button>
                  )}
                  {erpAssignmentUrl(a.externalId) && (
                    <a
                      href={erpAssignmentUrl(a.externalId) as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Open ${a.title} in the ERP portal (new tab)`}
                      title="Open in the ERP portal — check the official status there"
                      className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/50 text-muted-foreground transition-all hover:border-primary/40 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                    </a>
                  )}
                </motion.li>
              );
            })}
          </ul>
        </CollapsibleContent>
      </div>
      <AlaSubmitDialog row={submitRow} open={!!submitRow} onOpenChange={(o) => !o && setSubmitRow(null)} />
    </Collapsible>
  );
}

/**
 * Subject-wise ALA & assignments list, synced from the ERP's Assignments page
 * (spec #6: ERP truth only). Every row shows whether it is complete
 * ("Submitted") or not ("Pending" / "Overdue") and the ERP End Date — the
 * last date to submit. Pending rows carry an explicit, per-row "Submit"
 * action that uploads to the portal with the student's own session (never
 * automatic; the ERP's own page must confirm before the row flips).
 * Includes search, status + subject filter chips, sorting, expand/collapse-all,
 * palette quick-filter events (erp:filter-ala), scope-aware .ics export and a
 * one-click .ics export of every not-yet-submitted deadline.
 */
export type AlaStatusFilter = "all" | "overdue" | "soon" | "pending" | "submitted" | "noted";
type AlaSort = "deadline" | "priority" | "course" | "overdue";

const ALA_STATUS_META: { key: AlaStatusFilter; label: string; activeClass: string }[] = [
  { key: "all", label: "All", activeClass: "bg-primary text-primary-foreground" },
  { key: "overdue", label: "Overdue", activeClass: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/50" },
  { key: "soon", label: "Due ≤7d", activeClass: "bg-amber-500/20 text-amber-800 dark:text-amber-300 border-amber-500/50" },
  { key: "pending", label: "Pending", activeClass: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/50" },
  { key: "noted", label: "Noted", activeClass: "bg-primary/10 text-primary border-primary/40" },
  { key: "submitted", label: "Submitted", activeClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/50" },
];

/** Deterministic per-subject dot colors for the subject filter chips (hash of the code). */
const SUBJECT_DOTS = [
  "bg-sky-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-orange-500",
  "bg-teal-500",
];
function subjectDot(code: string): string {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  return SUBJECT_DOTS[h % SUBJECT_DOTS.length];
}

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

/** One day bucket inside the deadline radar. */
interface RadarDay {
  /** Day index (0 = today). */
  offset: number;
  /** Local midnight timestamp for the day. */
  ms: number;
  /** ACTIVE rows due this day. */
  count: number;
  /** Up to 4 sample titles for the hover tooltip. */
  titles: string[];
}

const RADAR_WINDOW = 35;

/**
 * Deadline radar — a 35-day density strip of upcoming ACTIVE deadlines.
 * Situational awareness + one-click drill-down: bar height = how many
 * deadlines land that day, amber while inside the 7-day window, muted beyond,
 * and today gets a primary ring + label. Days with deadlines are real buttons
 * — clicking one filters the list below to that calendar day (click again or
 * clear the amber pill to reset). The 7-day summary uses the same rolling
 * clock as the "Due ≤7d" filter chip so the numbers always agree.
 */
function AlaDeadlineRadar({
  assignments,
  now,
  selectedOffset,
  onPickDay,
}: {
  assignments: Reminder[];
  now: number;
  selectedOffset: number | null;
  onPickDay: (offset: number | null) => void;
}) {
  const days = useMemo<RadarDay[]>(() => {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const startMs = start.getTime();
    const arr: RadarDay[] = Array.from({ length: RADAR_WINDOW }, (_, offset) => ({
      offset,
      ms: startMs + offset * 86_400_000,
      count: 0,
      titles: [],
    }));
    const byMs = new Map(arr.map((d) => [d.ms, d]));
    for (const a of assignments) {
      if (a.status !== "ACTIVE") continue;
      const d = new Date(a.dueAt);
      d.setHours(0, 0, 0, 0);
      const bucket = byMs.get(d.getTime());
      if (!bucket) continue;
      bucket.count += 1;
      if (bucket.titles.length < 4) bucket.titles.push(a.title);
    }
    return arr;
  }, [assignments, now]);

  const maxCount = Math.max(1, ...days.map((d) => d.count));
  const inWeek = assignments.filter(
    (a) =>
      a.status === "ACTIVE" &&
      new Date(a.dueAt).getTime() >= now &&
      new Date(a.dueAt).getTime() - now <= 7 * 86_400_000
  ).length;
  const inWindow = days.reduce((n, d) => n + d.count, 0);
  const busiest = [...days].sort((a, b) => b.count - a.count)[0];
  const label = (d: Date) =>
    d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  if (inWindow === 0) return null;

  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="text-xs font-semibold tracking-tight">Deadline radar · next 35 days</p>
        <p className="text-[11px] tabular-nums text-muted-foreground">
          {inWeek > 0 ? (
            <>
              <span className="font-semibold text-amber-700 dark:text-amber-400">{inWeek}</span> due within 7 days
            </>
          ) : (
            "nothing due within 7 days"
          )}
          {inWindow > inWeek && (
            <>
              {" · "}
              <span className="font-semibold text-foreground/80">{inWindow}</span> inside 35 days
            </>
          )}
          {busiest.count > 0 && busiest.offset !== 0 && (
            <>
              {" · peak "}
              {busiest.offset < 7 ? "this week" : label(new Date(busiest.ms))} ({busiest.count})
            </>
          )}
        </p>
      </div>
      <div
        role="group"
        aria-label={`Deadline radar: ${inWeek} deadlines due within 7 days, ${inWindow} inside the next 35 days.${
          busiest.count > 0 ? ` Busiest day ${label(new Date(busiest.ms))} with ${busiest.count}.` : ""
        } Days with deadlines are clickable filters.`}
        className="mt-2.5 flex h-16 items-end gap-[3px]"
      >
        {days.map((d) => {
          const h = d.count === 0 ? 2 : Math.max(8, Math.round((d.count / maxCount) * 100));
          const hot = d.offset < 7;
          const isToday = d.offset === 0;
          const selected = selectedOffset === d.offset;
          const clickable = d.count > 0;
          const title =
            d.count === 0
              ? isToday
                ? `Today · ${label(new Date(d.ms))} — nothing due`
                : `${label(new Date(d.ms))} — nothing due`
              : `${isToday ? "Today · " : ""}${label(new Date(d.ms))} — ${d.count} due: ${d.titles.join(", ")}${d.count > d.titles.length ? `, +${d.count - d.titles.length} more` : ""}${clickable ? " — click to filter" : ""}`;
          const bar = (
            <div
              style={{ height: `${h}%` }}
              className={cn(
                "w-full rounded-[3px] transition-all duration-200 group-hover:opacity-80",
                d.count === 0
                  ? "bg-border/50"
                  : isToday
                    ? "bg-primary shadow-[0_0_8px_-2px] shadow-primary/60"
                    : hot
                      ? "bg-gradient-to-t from-amber-500/80 to-amber-400/90"
                      : "bg-gradient-to-t from-slate-400/50 to-slate-400/70 dark:from-slate-500/50 dark:to-slate-500/70",
                selected && "brightness-110 saturate-150"
              )}
            />
          );
          const shell = cn(
            "group relative flex h-full min-w-0 flex-1 flex-col justify-end rounded-b-sm",
            isToday && "-mx-[3px] rounded-md ring-1 ring-primary/70",
            selected && "z-10 rounded-md ring-2 ring-primary/80 bg-primary/[0.06]"
          );
          if (!clickable) {
            return (
              <div key={d.offset} title={title} className={cn(shell, "cursor-default")}>
                {bar}
              </div>
            );
          }
          return (
            <button
              key={d.offset}
              type="button"
              title={title}
              aria-pressed={selected}
              aria-label={`Filter the list to ${isToday ? "today" : label(new Date(d.ms))} — ${d.count} deadline${d.count === 1 ? "" : "s"} due`}
              onClick={() => onPickDay(selected ? null : d.offset)}
              className={cn(
                shell,
                "cursor-pointer rounded-md outline-none transition-shadow hover:ring-1 hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring"
              )}
            >
              {bar}
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] tabular-nums text-muted-foreground">
        <span className="font-semibold text-primary">Today</span>
        <span>+7d</span>
        <span>+14d</span>
        <span>+21d</span>
        <span>+28d</span>
        <span>+34d</span>
      </div>
      {selectedOffset == null ? (
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground/70">
          <span>Click a bar to see that day&apos;s deadlines.</span>
          <span className="ml-auto flex items-center gap-3" aria-hidden="true">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-[3px] bg-gradient-to-t from-amber-500/80 to-amber-400/90" />
              due ≤7d
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-[3px] bg-gradient-to-t from-slate-400/50 to-slate-400/70 dark:from-slate-500/50 dark:to-slate-500/70" />
              later
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-[3px] bg-primary shadow-[0_0_6px_-1px] shadow-primary/60" />
              today
            </span>
          </span>
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** One day cell inside the deadline month calendar. */
interface CalDay {
  /** Day offset from today (negative = past). */
  offset: number;
  /** Local midnight timestamp. */
  ms: number;
  /** Day of week (0 = Sunday) — weekends get a faint tint. */
  dow: number;
  /** Belongs to the viewed month (false = leading/trailing filler). */
  inMonth: boolean;
  /** ACTIVE rows due this day. */
  count: number;
  /** Of which overdue (due before now). */
  overdue: number;
  /** Of which due within 7 days (not overdue). */
  soon: number;
  /** Up to 3 sample titles for the hover tooltip. */
  titles: string[];
}

const CAL_DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;

/**
 * Deadline month calendar — the spatial twin of the 35-day radar. Unlike the
 * radar (today → +34d) it reaches into PAST months, where the overdue wall
 * actually lives: navigate back, see which days piled up, and click any day —
 * past or future — to filter the list below to that calendar day. It drives
 * the exact same dayOffset drill-down as the radar bars, amber pill included.
 */
function AlaDeadlineCalendar({
  assignments,
  now,
  selectedOffset,
  onPickDay,
  viewMonth,
  onViewMonthChange,
}: {
  assignments: Reminder[];
  now: number;
  selectedOffset: number | null;
  onPickDay: (offset: number | null) => void;
  viewMonth: Date;
  onViewMonthChange: (d: Date) => void;
}) {
  const todayMid = useMemo(() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, [now]);

  /* 6×7 = 42 cells → constant height regardless of month shape. Adjacent-month
     days render dimmed but stay interactive (they can carry deadlines too). */
  const cells = useMemo<CalDay[]>(() => {
    const y = viewMonth.getFullYear();
    const m = viewMonth.getMonth();
    const firstDow = new Date(y, m, 1).getDay(); // 0 = Sunday
    const gridStart = new Date(y, m, 1 - firstDow);
    const byMs = new Map<number, CalDay>();
    const arr: CalDay[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      d.setHours(0, 0, 0, 0);
      const cell: CalDay = {
        offset: Math.round((d.getTime() - todayMid) / 86_400_000),
        ms: d.getTime(),
        dow: d.getDay(),
        inMonth: d.getMonth() === m,
        count: 0,
        overdue: 0,
        soon: 0,
        titles: [],
      };
      arr.push(cell);
      byMs.set(d.getTime(), cell);
    }
    for (const a of assignments) {
      if (a.status !== "ACTIVE") continue;
      const d = new Date(a.dueAt);
      d.setHours(0, 0, 0, 0);
      const c = byMs.get(d.getTime());
      if (!c) continue;
      c.count += 1;
      const dueMs = new Date(a.dueAt).getTime();
      if (dueMs < now) c.overdue += 1;
      else if (dueMs - now <= 7 * 86_400_000) c.soon += 1;
      if (c.titles.length < 3) c.titles.push(a.title);
    }
    return arr;
  }, [assignments, now, viewMonth, todayMid]);

  const monthCount = cells.reduce((n, c) => n + (c.inMonth ? c.count : 0), 0);
  const monthOverdue = cells.reduce((n, c) => n + (c.inMonth ? c.overdue : 0), 0);
  const isCurrentMonth =
    viewMonth.getFullYear() === new Date(now).getFullYear() &&
    viewMonth.getMonth() === new Date(now).getMonth();
  const monthLabel = viewMonth.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const monthShort = viewMonth.toLocaleDateString("en-GB", { month: "short" });
  const dayLabel = (ms: number) =>
    new Date(ms).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const shiftMonth = (delta: number) =>
    onViewMonthChange(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + delta, 1));

  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-6.5 text-muted-foreground hover:text-foreground"
            onClick={() => shiftMonth(-1)}
            aria-label={`Show ${new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`}
          >
            <ChevronLeft className="size-3.5" aria-hidden="true" />
          </Button>
          <p className="min-w-[7.75rem] text-center text-xs font-semibold tracking-tight" aria-live="polite">
            {monthLabel}
          </p>
          <Button
            variant="ghost"
            size="icon"
            className="size-6.5 text-muted-foreground hover:text-foreground"
            onClick={() => shiftMonth(1)}
            aria-label={`Show ${new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`}
          >
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </Button>
          {!isCurrentMonth && (
            <button
              type="button"
              onClick={() => onViewMonthChange(new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1))}
              className="ml-1 rounded-full border border-border/70 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Today
            </button>
          )}
        </div>
        <p className="text-[11px] tabular-nums text-muted-foreground">
          {monthCount > 0 ? (
            <>
              <span className="font-semibold text-foreground/80">{monthCount}</span> open in {monthShort}
              {monthOverdue > 0 && (
                <>
                  {" · "}
                  <span className="font-semibold text-red-600 dark:text-red-400">{monthOverdue}</span> overdue
                </>
              )}
            </>
          ) : (
            "no deadlines this month"
          )}
        </p>
      </div>
      <div
        role="group"
        aria-label={`Deadline calendar for ${monthLabel}. Days with deadlines are clickable filters.`}
        className="mt-2"
      >
        <div className="grid grid-cols-7 gap-1">
          {CAL_DOW.map((d, i) => (
            <p
              key={d}
              className={cn(
                "pb-0.5 text-center text-[9px] font-semibold uppercase tracking-wider",
                i === 0 || i === 6 ? "text-muted-foreground/50" : "text-muted-foreground/80"
              )}
            >
              {d}
            </p>
          ))}
          {cells.map((c) => {
            const isToday = c.offset === 0;
            const selected = selectedOffset === c.offset;
            const clickable = c.count > 0;
            const weekend = c.dow === 0 || c.dow === 6;
            const later = c.count - c.overdue - c.soon;
            const title =
              c.count === 0
                ? `${dayLabel(c.ms)} — nothing due`
                : `${dayLabel(c.ms)} — ${c.count} due: ${c.titles.join(", ")}${c.count > c.titles.length ? `, +${c.count - c.titles.length} more` : ""}${clickable ? " — click to filter" : ""}`;
            const body = (
              <>
                <span
                  className={cn(
                    "flex size-4.5 items-center justify-center rounded-full text-[11px] leading-none tabular-nums",
                    isToday && "bg-primary font-bold text-primary-foreground",
                    !isToday && selected && "font-bold text-primary"
                  )}
                >
                  {new Date(c.ms).getDate()}
                </span>
                {c.count > 0 && (
                  <span className="mt-0.5 flex min-h-1.5 items-center gap-0.5">
                    {c.overdue > 0 && <span className="size-1.5 rounded-full bg-red-500" aria-hidden="true" />}
                    {c.soon > 0 && <span className="size-1.5 rounded-full bg-amber-500" aria-hidden="true" />}
                    {later > 0 && <span className="size-1.5 rounded-full bg-slate-400 dark:bg-slate-500" aria-hidden="true" />}
                    {c.count > 1 && (
                      <span className="text-[8.5px] font-bold leading-none tabular-nums text-muted-foreground">
                        {c.count}
                      </span>
                    )}
                  </span>
                )}
              </>
            );
            const shell = cn(
              "relative flex min-w-0 flex-col items-center rounded-lg border pt-1 pb-0.5 transition-all",
              weekend && !selected && "bg-black/[0.025] dark:bg-white/[0.03]",
              !c.inMonth && "opacity-40",
              selected
                ? "z-10 border-primary/60 ring-2 ring-primary/80 bg-primary/[0.06]"
                : "border-transparent"
            );
            if (!clickable) {
              return (
                <div key={c.ms} title={title} className={cn(shell, "cursor-default")}>
                  {body}
                </div>
              );
            }
            return (
              <button
                key={c.ms}
                type="button"
                title={title}
                aria-pressed={selected}
                aria-label={`Filter the list to ${isToday ? "today" : dayLabel(c.ms)} — ${c.count} deadline${c.count === 1 ? "" : "s"} due`}
                onClick={() => onPickDay(selected ? null : c.offset)}
                className={cn(
                  shell,
                  "cursor-pointer outline-none hover:border-border/80 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                )}
              >
                {body}
              </button>
            );
          })}
        </div>
      </div>
      {selectedOffset == null ? (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground/70">
          <span>Click a day to see its deadlines — past months included.</span>
          <span className="ml-auto flex items-center gap-3" aria-hidden="true">
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-red-500" />
              overdue
            </span>
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-amber-500" />
              due ≤7d
            </span>
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-slate-400 dark:bg-slate-500" />
              later
            </span>
            <span className="flex items-center gap-1">
              <span className="flex size-3 items-center justify-center rounded-full bg-primary text-[7px] font-bold text-primary-foreground">
                {new Date(now).getDate()}
              </span>
              today
            </span>
          </span>
        </p>
      ) : null}
    </div>
  );
}

type AlaDeadlineMode = "radar" | "calendar";

/** Remembered deadline overview style — a device-local view preference. */
const ALA_MODE_KEY = "erp:alaDeadlineMode";

/**
 * Segmented switch between the two deadline overviews (35-day radar strip vs
 * month calendar) plus month jump chips. Owns the visible month; when the user
 * arrives from a radar drill (or any other day pick) the calendar snaps to the
 * selected day's month so the ringed cell is always on screen.
 */
function AlaDeadlineViews({
  assignments,
  now,
  selectedOffset,
  onPickDay,
}: {
  assignments: Reminder[];
  now: number;
  selectedOffset: number | null;
  onPickDay: (offset: number | null) => void;
}) {
  const [mode, setMode] = useState<AlaDeadlineMode>("radar");
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  /* Hydrate the remembered style after mount (SSR always renders "radar",
     so a saved "calendar" swaps in post-paint — no hydration mismatch). */
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(ALA_MODE_KEY);
      if (saved === "radar" || saved === "calendar") setMode(saved);
    } catch {
      /* storage unavailable — keep the radar default */
    }
  }, []);

  const todayMid = useMemo(() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, [now]);

  const switchMode = (m: AlaDeadlineMode) => {
    setMode(m);
    try {
      window.localStorage.setItem(ALA_MODE_KEY, m);
    } catch {
      /* private mode — the choice still applies for this session */
    }
    if (m === "calendar" && selectedOffset != null) {
      const t = new Date(todayMid + selectedOffset * 86_400_000);
      setViewMonth(new Date(t.getFullYear(), t.getMonth(), 1));
    }
  };

  /* Months (ascending) that hold at least one ACTIVE deadline — one-click
     navigation to the overdue past or the busy future. */
  const monthChips = useMemo(() => {
    const map = new Map<string, { first: Date; label: string; count: number }>();
    for (const a of assignments) {
      if (a.status !== "ACTIVE") continue;
      const d = new Date(a.dueAt);
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
      const e = map.get(key);
      if (e) e.count += 1;
      else
        map.set(key, {
          first: new Date(d.getFullYear(), d.getMonth(), 1),
          label: d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }),
          count: 1,
        });
    }
    return [...map.values()].sort((x, y) => x.first.getTime() - y.first.getTime());
  }, [assignments]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Deadline overview style"
          title="Radar shows today → +34 days; Month shows full calendar months. Your choice is remembered on this device."
          className="flex items-center gap-0.5 rounded-full border border-border/60 bg-muted/40 p-0.5"
        >
          <button
            type="button"
            aria-pressed={mode === "radar"}
            onClick={() => switchMode("radar")}
            className={cn(
              "flex h-6 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              mode === "radar" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <BarChart3 className="size-3" aria-hidden="true" />
            Radar
          </button>
          <button
            type="button"
            aria-pressed={mode === "calendar"}
            onClick={() => switchMode("calendar")}
            className={cn(
              "flex h-6 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              mode === "calendar" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <CalendarDays className="size-3" aria-hidden="true" />
            Month
          </button>
        </div>
        <span className="ml-auto text-[10px] text-muted-foreground/70">
          {mode === "radar" ? "Today → +34d" : "Past months included"}
        </span>
      </div>
      {mode === "calendar" && monthChips.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Jump to a month with deadlines">
          {monthChips.map((chip) => {
            const monthEnd = new Date(chip.first.getFullYear(), chip.first.getMonth() + 1, 1).getTime();
            const past = monthEnd <= now;
            const active = viewMonth.getTime() === chip.first.getTime();
            return (
              <button
                key={chip.label}
                type="button"
                aria-pressed={active}
                onClick={() => setViewMonth(chip.first)}
                title={`${chip.count} open deadline${chip.count === 1 ? "" : "s"} in ${chip.first.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}${past ? " — all overdue by now" : ""}`}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary/60 bg-primary/10 text-primary shadow-sm"
                    : "border-border/70 bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                {chip.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[10px] font-bold tabular-nums",
                    active
                      ? "bg-primary/15 text-primary"
                      : past
                        ? "bg-red-500/15 text-red-600 dark:text-red-400"
                        : "bg-muted"
                  )}
                >
                  {chip.count}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {mode === "radar" ? (
        <AlaDeadlineRadar
          assignments={assignments}
          now={now}
          selectedOffset={selectedOffset}
          onPickDay={onPickDay}
        />
      ) : (
        <AlaDeadlineCalendar
          assignments={assignments}
          now={now}
          selectedOffset={selectedOffset}
          onPickDay={onPickDay}
          viewMonth={viewMonth}
          onViewMonthChange={setViewMonth}
        />
      )}
    </div>
  );
}

/** Remembered ALA sort — a device-local view preference, same pattern as the
 *  reminders filter and the dashboard subject sort (erp:alaSort). */
const ALA_SORT_KEY = "erp:alaSort";
const ALA_SORT_VALUES: AlaSort[] = ["deadline", "priority", "overdue", "course"];
/** One-time-per-device key guarding the "Triage by priority?" hint toast. */
const ALA_SORT_HINT_KEY = "erp:sortHintShown";

function loadAlaSort(): AlaSort {
  if (typeof window === "undefined") return "deadline";
  try {
    const saved = window.localStorage.getItem(ALA_SORT_KEY);
    return ALA_SORT_VALUES.includes(saved as AlaSort) ? (saved as AlaSort) : "deadline";
  } catch {
    return "deadline";
  }
}

function AlaSection({
  pendingFilter = null,
  onPendingFilterConsumed,
}: {
  /** Cross-tab jump (dashboard flagged-ALA card): applied once on mount, then
   *  reported consumed so later remounts don't re-apply a stale filter. */
  pendingFilter?: AlaStatusFilter | null;
  onPendingFilterConsumed?: () => void;
}) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: qk.assignments,
    queryFn: fetchAssignments,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const qc = useQueryClient();
  /* Local-only note/priority overlay (AlaNote table) — fetched separately so
     ERP sync refetches never churn it; keyed by the row's stable externalId. */
  const { data: alaNotes } = useQuery({
    queryKey: qk.alaNotes,
    queryFn: fetchAlaNotes,
    staleTime: 30_000,
  });
  const noteMap = useMemo(
    () => new Map((alaNotes ?? []).map((n) => [n.externalId, n])),
    [alaNotes]
  );

  /* Sort starts at the default and hydrates from localStorage after mount
     (SSR renders "deadline", so a saved choice swaps in post-paint — no
     hydration mismatch). Declared BEFORE saveNote so the hint toast's
     dependency array can reference setSort. */
  const [sort, setSortState] = useState<AlaSort>("deadline");
  useEffect(() => {
    setSortState(loadAlaSort());
  }, []);
  /* UI-driven changes persist; programmatic resets (palette deep-focus, the
     cross-tab jump) call setSortState directly so a transient action never
     overwrites the saved preference. */
  const setSort = useCallback((s: AlaSort) => {
    setSortState(s);
    try {
      window.localStorage.setItem(ALA_SORT_KEY, s);
    } catch {
      /* storage unavailable — preference applies for this session only */
    }
  }, []);

  /** Optimistic save + rollback; throws so the editor popover stays open on failure. */
  const saveNote = useCallback(
    async (externalId: string, note: string, priority: number) => {
      const prev = qc.getQueryData<AlaNoteRow[]>(qk.alaNotes) ?? [];
      const clean = note.trim();
      const optimistic: AlaNoteRow[] =
        clean === "" && priority === 0
          ? prev.filter((n) => n.externalId !== externalId)
          : [
              ...prev.filter((n) => n.externalId !== externalId),
              {
                externalId,
                note: clean,
                priority,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ];
      qc.setQueryData<AlaNoteRow[]>(qk.alaNotes, optimistic);
      try {
        await saveAlaNote({ externalId, note: clean, priority });
        qc.invalidateQueries({ queryKey: qk.alaNotes });
        /* One-time nudge: a fresh Medium/High flag is the perfect moment to
           teach the priority sort. Fires at most once per device, and only
           while the saved sort isn't already "priority". */
        if (priority >= 2) {
          try {
            if (window.localStorage.getItem(ALA_SORT_HINT_KEY) !== "1" && loadAlaSort() !== "priority") {
              window.localStorage.setItem(ALA_SORT_HINT_KEY, "1");
              toast.info("Triage by priority?", {
                description: "Your flag can float the hottest ALAs to the top of each subject group.",
                action: { label: "Try it", onClick: () => setSort("priority") },
                duration: 8000,
              });
            }
          } catch {
            /* storage unavailable — skip the hint silently */
          }
        }
      } catch (e) {
        qc.setQueryData<AlaNoteRow[]>(qk.alaNotes, prev);
        toast.error(e instanceof ApiError ? e.message : "Could not save the note — try again");
        throw e;
      }
    },
    [qc, setSort]
  );

  const now = useNow();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<AlaStatusFilter>("all");
  /** Subject filter (group code) — the third axis alongside status and the radar day drill-down. */
  const [subject, setSubject] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** Radar drill-down: calendar-day offset (0 = today) the list is filtered to. */
  const [dayOffset, setDayOffset] = useState<number | null>(null);

  /* Deep-focus from the command palette (erp:focus-ala, detail = search text):
     isolates the target ALA row by pre-filling the search box. */
  useEffect(() => {
    const handler = (e: Event) => {
      const q = (e as CustomEvent<string>).detail;
      if (typeof q === "string" && q.trim()) {
        setQuery(q);
        setStatus("all");
        setSubject(null);
        setSortState("deadline"); // transient deep-focus — does NOT clobber the saved sort
        setDayOffset(null);
      }
    };
    window.addEventListener("erp:focus-ala", handler);
    return () => window.removeEventListener("erp:focus-ala", handler);
  }, []);

  /* Consume the cross-tab pending filter once mounted (dashboard "flagged
     ALAs" card → Reminders tab with the Noted filter pre-applied). */
  useEffect(() => {
    if (pendingFilter) {
      setQuery("");
      setStatus(pendingFilter);
      setSubject(null);
      setDayOffset(null);
      onPendingFilterConsumed?.();
    }
  }, [pendingFilter, onPendingFilterConsumed]);

  /* Quick-filter from the command palette (erp:filter-ala, detail = status key):
     a fresh triage entry — clears every other axis (search/subject/day) and
     applies the requested status. "all" just resets everything. */
  useEffect(() => {
    const handler = (e: Event) => {
      const s = (e as CustomEvent<string>).detail;
      if (s === "all" || s === "overdue" || s === "soon" || s === "pending" || s === "submitted" || s === "noted") {
        setQuery("");
        setStatus(s);
        setSubject(null);
        setDayOffset(null);
      }
    };
    window.addEventListener("erp:filter-ala", handler);
    return () => window.removeEventListener("erp:filter-ala", handler);
  }, []);

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
    let soon = 0;
    let submitted = 0;
    for (const a of data?.assignments ?? []) {
      if (a.status === "ACTIVE") {
        const dueMs = new Date(a.dueAt).getTime();
        if (dueMs < now) overdue++;
        else {
          pending++;
          if (dueMs - now <= 7 * 86_400_000) soon++;
        }
      } else submitted++;
    }
    const notedCount = [...(data?.assignments ?? [])].filter((a) => !!a.externalId && noteMap.has(a.externalId)).length;
    return { all: (data?.assignments.length ?? 0) as number, pending, overdue, soon, submitted, noted: notedCount };
  }, [data, now, noteMap]);

  /* Search + status filter + radar day drill-down — applied per row, then empty groups drop out. */
  const dayStartMs = useMemo(() => {
    if (dayOffset == null) return null;
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime() + dayOffset * 86_400_000;
  }, [dayOffset, now]);

  const visibleGroups = useMemo<AlaGroup[]>(() => {
    const q = query.trim().toLowerCase();
    let list = groups;
    /* Subject axis: whole groups drop out (code is the group identity). */
    if (subject != null) list = list.filter((g) => g.code === subject);
    if (q || status !== "all" || dayStartMs != null) {
      list = list
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
            if (dayStartMs != null) {
              const due = new Date(a.dueAt);
              due.setHours(0, 0, 0, 0);
              if (due.getTime() !== dayStartMs) return false;
            }
            if (status === "all") return true;
            const done = a.status !== "ACTIVE";
            if (status === "noted") return !!a.externalId && noteMap.has(a.externalId);
            if (status === "submitted") return done;
            if (done) return false;
            const dueMs = new Date(a.dueAt).getTime();
            if (status === "overdue") return dueMs < now;
            if (status === "soon") return dueMs >= now && dueMs - now <= 7 * 86_400_000;
            return dueMs >= now;
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
    if (sort === "priority") {
      /* Your flags first: rows ordered by local priority (High → None), then
         deadline; groups ranked by their best flagged row. Unflagged rows keep
         their deadline order inside each group. */
      const prioOf = (a: Reminder) => (a.externalId ? noteMap.get(a.externalId)?.priority ?? 0 : 0);
      const bestOf = (g: AlaGroup) => g.items.reduce((m, a) => Math.max(m, prioOf(a)), 0);
      list = [...list]
        .map((g) => ({
          ...g,
          items: [...g.items].sort(
            (a, b) =>
              prioOf(b) - prioOf(a) || new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
          ),
        }))
        .sort(
          (x, y) =>
            bestOf(y) - bestOf(x) ||
            (x.nextPendingMs ?? Number.POSITIVE_INFINITY) - (y.nextPendingMs ?? Number.POSITIVE_INFINITY) ||
            (x.name ?? x.code).localeCompare(y.name ?? y.code)
        );
    } else if (sort === "course") {
      list = [...list].sort((x, y) => (x.name ?? x.code).localeCompare(y.name ?? y.code));
    } else if (sort === "overdue") {
      // Triage view: the heaviest overdue walls first, then nearest deadline, then A–Z.
      list = [...list].sort(
        (x, y) =>
          y.overdue - x.overdue ||
          (x.nextPendingMs ?? Number.POSITIVE_INFINITY) - (y.nextPendingMs ?? Number.POSITIVE_INFINITY) ||
          (x.name ?? x.code).localeCompare(y.name ?? y.code)
      );
    }
    return list;
  }, [groups, query, status, subject, sort, now, dayStartMs, noteMap]);

  const total = data?.assignments.length ?? 0;
  const submitted = counts.submitted;
  const pending = counts.pending + counts.overdue;
  const searching = query.trim() !== "" || status !== "all" || subject != null;
  const hasActiveDeadlines = counts.pending + counts.overdue > 0;

  /* Scoped export: while any filter axis is engaged, the .ics contains exactly
     what the list shows (visible ACTIVE rows) instead of the whole semester. */
  const filtering = searching || dayOffset != null;
  const scopedActive = filtering
    ? visibleGroups.flatMap((g) => g.items).filter((a) => a.status === "ACTIVE")
    : null;

  const exportAlaIcs = () => {
    if (!data) return;
    const active = scopedActive ?? data.assignments.filter((a) => a.status === "ACTIVE");
    if (active.length === 0) {
      toast.info("Nothing to export", {
        description: "No open deadlines in the current view — clear a filter first.",
      });
      return;
    }
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
      description: filtering
        ? `${active.length} visible deadline${active.length === 1 ? "" : "s"} (current filters) — import into your calendar app.`
        : `${active.length} open deadline${active.length === 1 ? "" : "s"} — import into your calendar app.`,
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
              className="relative size-8 text-muted-foreground"
              disabled={!hasActiveDeadlines}
              onClick={exportAlaIcs}
              aria-label={
                filtering && scopedActive
                  ? `Export the ${scopedActive.length} visible open deadlines as a calendar (.ics) file`
                  : "Export all open ALA deadlines as a calendar (.ics) file"
              }
              title={
                filtering && scopedActive
                  ? `Export the ${scopedActive.length} visible open deadlines (.ics) — current filters apply`
                  : "Export all open deadlines as .ics"
              }
            >
              <Download className="size-4" aria-hidden="true" />
              {filtering && scopedActive != null && scopedActive.length > 0 && (
                <span
                  className="absolute -right-1 -top-1 flex size-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[8px] font-bold leading-none text-primary-foreground shadow-sm"
                  aria-hidden="true"
                >
                  {scopedActive.length > 9 ? "9+" : scopedActive.length}
                </span>
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              asChild
            >
              <a
                href={`${ERP_BASE}/student/assignment`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open the ALA & Assignments page in the ERP portal (new tab)"
                title="Open the ERP Assignments page — submit there, then sync to update this list"
              >
                <ExternalLink className="size-4" aria-hidden="true" />
              </a>
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
            {/* Semester-wide completion bar — the "how much is behind me" big picture */}
            <div className="flex items-center gap-2.5">
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={total > 0 ? Math.round((submitted / total) * 100) : 0}
                aria-label={`ALA completion: ${submitted} of ${total} submitted`}
                className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-[width] duration-500"
                  style={{ width: `${total > 0 ? Math.max(2, Math.round((submitted / total) * 100)) : 0}%` }}
                />
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                <span className="font-semibold text-emerald-700 dark:text-emerald-400">{submitted}</span>
                /{total} submitted
              </span>
            </div>
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
                    data-testid="ala-sort-select"
                    className="h-8 w-[150px] shrink-0 gap-1 bg-background text-xs"
                    aria-label="Sort ALA groups"
                  >
                    <ArrowDownUp className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deadline" className="text-xs">Nearest deadline</SelectItem>
                    <SelectItem value="priority" className="text-xs">Highest priority</SelectItem>
                    <SelectItem value="overdue" className="text-xs">Most overdue</SelectItem>
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

            {/* Status filter chips with live counts + active day-filter pill */}
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
              {dayOffset != null && dayStartMs != null && (
                <button
                  type="button"
                  onClick={() => setDayOffset(null)}
                  aria-label={`Clear the day filter (showing rows due ${fmtDay(new Date(dayStartMs).toISOString())})`}
                  title="Show every deadline again"
                  className="flex items-center gap-1.5 rounded-full border border-amber-500/50 bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-800 shadow-sm transition-colors hover:bg-amber-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-300"
                >
                  <CalendarDays className="size-3.5" aria-hidden="true" />
                  Due {fmtDay(new Date(dayStartMs).toISOString())}
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              )}
            </div>

            {/* Subject filter chips — the third axis (status × subject × day) */}
            {groups.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by subject">
                {groups.map((g) => {
                  const active = subject === g.code;
                  const open = g.items.length - g.submitted;
                  return (
                    <button
                      key={g.code}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSubject(active ? null : g.code)}
                      title={`${g.name ?? "Unmapped course"} (${g.code}) — ${open} open, ${g.overdue} overdue`}
                      aria-label={`Filter the ALA list to ${g.name ?? g.code} — ${open} open, ${g.overdue} overdue`}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active
                          ? "border-primary/60 bg-primary/10 text-primary shadow-sm"
                          : "border-border/70 bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      )}
                    >
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          subjectDot(g.code),
                          active && "ring-2 ring-ring/40 ring-offset-1"
                        )}
                        aria-hidden="true"
                      />
                      <span className="max-w-32 truncate text-[11px] font-semibold tracking-tight">
                        {g.name ?? "Unmapped"}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-1.5 text-[10px] font-bold tabular-nums",
                          active ? "bg-primary/15 text-primary" : "bg-muted"
                        )}
                      >
                        {open}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Priority legend — teaches the local-flag color language; the rows
               themselves carry the full tooltips (aria-hidden is enough here). */}
            <div
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[10px] text-muted-foreground"
              aria-hidden="true"
            >
              <span className="inline-flex items-center gap-1">
                <Flag className="size-2.5 text-red-500" />
                High
              </span>
              <span className="inline-flex items-center gap-1">
                <Flag className="size-2.5 text-violet-500" />
                Medium
              </span>
              <span className="inline-flex items-center gap-1">
                <Flag className="size-2.5 text-sky-500" />
                Low
              </span>
              <span className="inline-flex items-center gap-1">
                <StickyNote className="size-2.5 text-primary/70" />
                private note
              </span>
              <span className="text-muted-foreground/60">— your local triage layer, never shown on the ERP</span>
            </div>

            {/* Live result count + clear-all — only while any filter axis is engaged */}
            {(searching || dayOffset != null) && (
              <div className="flex flex-wrap items-center gap-2 px-1 text-[11px] text-muted-foreground">
                <span className="tabular-nums" aria-live="polite">
                  <span className="font-semibold text-foreground">
                    {visibleGroups.reduce((n, g) => n + g.items.length, 0)}
                  </span>{" "}
                  of {total} rows · {visibleGroups.length} subject{visibleGroups.length === 1 ? "" : "s"} shown
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setStatus("all");
                    setSubject(null);
                    setDayOffset(null);
                  }}
                  className="flex items-center gap-1 rounded-full border border-border/70 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Clear all filters
                  <X className="size-3" aria-hidden="true" />
                </button>
              </div>
            )}

            {/* Overdue digest — collapses to nothing the moment any filter is active */}
            {!searching && dayOffset == null && (
              <AlaOverdueDigest groups={groups} onViewOverdue={() => setStatus("overdue")} />
            )}

            {/* Deadline overviews — radar ↔ month calendar toggle; stays visible for the selected day */}
            {!searching && data && (
              <AlaDeadlineViews
                assignments={data.assignments}
                now={now}
                selectedOffset={dayOffset}
                onPickDay={setDayOffset}
              />
            )}

            {visibleGroups.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-border/80 bg-card/40 px-6 py-8 text-center">
                <Search className="size-6 text-muted-foreground/50" aria-hidden="true" />
                <p className="text-sm font-medium">Nothing matches</p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  No ALA rows match {query.trim() ? `“${query.trim()}”` : "this filter"}.
                  Try a different search or clear a filter chip.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-1 h-7 text-xs"
                  onClick={() => {
                    setQuery("");
                    setStatus("all");
                    setSubject(null);
                    setDayOffset(null);
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
                  notes={noteMap}
                  onSaveNote={saveNote}
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

/** Remembered reminders filter + layout — device-local view preferences. */
const REMINDERS_PREF_KEY = "erp:remindersPrefs";

function loadReminderPrefs(): { filter: RemindersFilter; view: "timeline" | "subject" } {
  const fallback = { filter: "all" as RemindersFilter, view: "timeline" as const };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(REMINDERS_PREF_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<{ filter: string; view: string }>;
    return {
      filter: p.filter === "erp" || p.filter === "personal" || p.filter === "all" ? p.filter : fallback.filter,
      view: p.view === "timeline" || p.view === "subject" ? p.view : fallback.view,
    };
  } catch {
    return fallback;
  }
}

export function RemindersTab({
  pendingAlaFilter = null,
  onConsumePendingAlaFilter,
}: {
  /** Set by the page right before switching to this tab (see page.tsx);
   *  AlaSection applies it once on mount. */
  pendingAlaFilter?: AlaStatusFilter | null;
  onConsumePendingAlaFilter?: () => void;
}) {
  /* Filter + layout hydrate from localStorage after mount (SSR renders the
     defaults; a saved choice swaps in post-paint — no hydration mismatch). */
  const [filter, setFilterState] = useState<RemindersFilter>("all");
  const [includeDone, setIncludeDone] = useState(false);
  const [view, setViewState] = useState<"timeline" | "subject">("timeline");
  useEffect(() => {
    const saved = loadReminderPrefs();
    setFilterState(saved.filter);
    setViewState(saved.view);
  }, []);
  const setFilter = (f: RemindersFilter) => {
    setFilterState(f);
    try {
      window.localStorage.setItem(
        REMINDERS_PREF_KEY,
        JSON.stringify({ filter: f, view })
      );
    } catch {
      /* storage unavailable — preference applies for this session only */
    }
  };
  const setView = (v: "timeline" | "subject") => {
    setViewState(v);
    try {
      window.localStorage.setItem(
        REMINDERS_PREF_KEY,
        JSON.stringify({ filter, view: v })
      );
    } catch {
      /* storage unavailable — preference applies for this session only */
    }
  };

  /* r104: palette deep-link (erp:filter-reminders, detail = scope key).
     The command palette's "Your reminders" group routes here so the rows it
     advertised are the rows the student lands on. Routes through setFilter
     so the choice persists like a manual toggle (deliberate user action). */
  useEffect(() => {
    const handler = (e: Event) => {
      const f = (e as CustomEvent<string>).detail;
      if (f === "all" || f === "erp" || f === "personal") setFilter(f);
    };
    window.addEventListener("erp:filter-reminders", handler);
    return () => window.removeEventListener("erp:filter-reminders", handler);
  });

  const { data, isPending, isError, error } = useQuery({
    queryKey: qk.reminders(filter, includeDone),
    queryFn: () => fetchReminders(filter, includeDone),
    refetchInterval: 20_000,
  });

  return (
    <div className="space-y-4">
      <BrowserRemindersBanner />
      <AlaSection
        pendingFilter={pendingAlaFilter}
        onPendingFilterConsumed={onConsumePendingAlaFilter}
      />
      <Card className="rounded-xl border-border/60">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div
            role="tablist"
            aria-label="Filter reminders"
            title="Filter is remembered on this device"
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
