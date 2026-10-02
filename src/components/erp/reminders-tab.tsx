"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Lock,
  Plus,
  Trash2,
  Undo2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Download } from "lucide-react";
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
import { Card, CardContent } from "@/components/ui/card";
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
  createReminder,
  deleteReminder,
  fetchReminders,
  qk,
  updateReminderStatus,
  ApiError,
} from "./api";
import { dueGroup, fmtDT, GROUP_META, SourceBadge, TypeIcon, typeLabel, useNow } from "./shared";
import { downloadCsv } from "./trend-chart";
import type { DueGroup } from "./shared";
import type { RemindersFilter, Reminder, ReminderType } from "./types";

/* ------------------------------------------------------------------ */

const NEW_TYPES: ReminderType[] = ["EXAM", "PRACTICAL_EXAM", "VIVA", "ASSIGNMENT", "SUBMISSION", "OTHER"];

function ReminderRow({ r, onDeleted }: { r: Reminder; onDeleted: (r: Reminder) => void }) {
  const qc = useQueryClient();
  const now = useNow();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isWarn = r.type === "ATTENDANCE_WARNING";
  const done = r.status !== "ACTIVE";
  const overdue = r.status === "ACTIVE" && new Date(r.dueAt).getTime() < now;

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
        </div>
        {r.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{r.description}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className={cn("text-xs", overdue ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground")}>
            {overdue ? "Overdue · " : ""}
            {fmtDT(r.dueAt)}
          </span>
          {isWarn && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
              <Lock className="size-3" aria-hidden="true" />
              auto-managed by ERP sync
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
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

  const create = useMutation({
    mutationFn: () =>
      createReminder({
        title: title.trim(),
        type,
        description: description.trim() || undefined,
        dueAt: new Date(dueAtLocal).toISOString(),
      }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Reminder created");
      setOpen(false);
      setTitle("");
      setDescription("");
      setDueAtLocal("");
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

export function RemindersTab() {
  const [filter, setFilter] = useState<RemindersFilter>("all");
  const [includeDone, setIncludeDone] = useState(false);

  const { data, isPending, isError, error } = useQuery({
    queryKey: qk.reminders(filter, includeDone),
    queryFn: () => fetchReminders(filter, includeDone),
    refetchInterval: 20_000,
  });

  return (
    <div className="space-y-4">
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

          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={includeDone} onCheckedChange={setIncludeDone} aria-label="Show completed reminders" />
            Show completed
          </label>

          <div className="ml-auto flex items-center gap-2">
            {data && data.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() =>
                  downloadCsv(
                    `reminders-${new Date().toISOString().slice(0, 10)}.csv`,
                    ["Title", "Source", "Type", "Due at", "Status", "Description"],
                    data.map((r) => [r.title, r.source, typeLabel(r.type), fmtDT(r.dueAt), r.status, r.description ?? ""])
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
        <RemindersList items={data ?? []} />
      )}
    </div>
  );
}
