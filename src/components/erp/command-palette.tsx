"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import {
  ALargeSmall,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarClock,
  Check,
  ExternalLink,
  FlaskConical,
  GraduationCap,
  Keyboard,
  LayoutDashboard,
  ListFilter,
  Moon,
  Printer,
  RefreshCw,
  Settings as SettingsIcon,
  Sun,
  Target,
  Timer,
  Zap,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { cycleTextSize, TEXT_SIZES } from "@/lib/text-size";
import { fetchAssignments, postDemoEvolve, postSync, putSelectedSemester, qk } from "./api";
import { ERP_BASE } from "./shared";
import type { AttendanceStatus, SubjectView } from "./types";
import { useTextSize } from "./text-size-card";

const STATUS_DOT: Record<AttendanceStatus, string> = {
  safe: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  none: "bg-muted-foreground/50",
};

export type PaletteTab = "dashboard" | "attendance" | "reminders" | "settings";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (tab: PaletteTab) => void;
  onShowShortcuts: () => void;
  onSyncNow: () => void;
  syncing: boolean;
  demoMode: boolean;
  subjects: SubjectView[] | undefined;
  /** Active semester partition ("all" or "1".."8"). */
  semester?: string;
}

/**
 * Global command palette (⌘K / Ctrl+K): quick navigation, actions, subject
 * jump-to-details, ALA quick-filters and ERP portal deep-links.
 */
export function CommandPalette({
  open,
  onOpenChange,
  onNavigate,
  onShowShortcuts,
  onSyncNow,
  syncing,
  demoMode,
  subjects,
  semester = "all",
}: CommandPaletteProps) {
  const { resolvedTheme, setTheme } = useTheme();

  const run = (fn: () => void) => {
    onOpenChange(false);
    // let the dialog close before side effects (avoids focus fights)
    window.setTimeout(fn, 60);
  };

  const openSubject = (code: string) => {
    run(() => {
      onNavigate("attendance");
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("erp:open-subject", { detail: code }));
      }, 120);
    });
  };

  const newReminder = () => {
    run(() => {
      onNavigate("reminders");
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("erp:new-reminder"));
      }, 120);
    });
  };

  const toggleTheme = () => {
    run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"));
  };

  const [textSize, setTextSizeState] = useTextSize();
  const cycleText = () => {
    const nextSize = cycleTextSize(textSize);
    run(() => {
      setTextSizeState(nextSize);
      toast.success(
        `Text size: ${TEXT_SIZES.find((s) => s.key === nextSize)?.label ?? nextSize}`,
        { description: "Adjust any time in Settings → Text size." }
      );
    });
  };

  /* Deadline launcher — joins the shared assignments query cache (already
     polled by the ALA section and the app badge), so it costs no extra fetch. */
  const assignmentsQ = useQuery({ queryKey: qk.assignments, queryFn: fetchAssignments, staleTime: 15_000 });
  const nowMs = React.useMemo(() => Date.now(), [assignmentsQ.data]);
  const { deadlineItems, activeDeadlineCount, overdueCount, soonCount } = React.useMemo(() => {
    const active = (assignmentsQ.data?.assignments ?? []).filter((a) => a.status === "ACTIVE");
    const sorted = [...active].sort(
      (a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
    );
    const dueMs = (a: { dueAt: string }) => new Date(a.dueAt).getTime();
    return {
      deadlineItems: sorted.slice(0, 8),
      activeDeadlineCount: active.length,
      overdueCount: active.filter((a) => dueMs(a) < nowMs).length,
      soonCount: active.filter((a) => {
        const d = dueMs(a);
        return d >= nowMs && d - nowMs <= 7 * 86_400_000;
      }).length,
    };
  }, [assignmentsQ.data, nowMs]);
  const openDeadline = (title: string) => {
    run(() => {
      onNavigate("reminders");
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("erp:focus-ala", { detail: title }));
      }, 150);
    });
  };

  /* ALA quick-filter — a fresh triage entry: the AlaSection listener clears
     every other axis (search/subject/day) and applies the requested status. */
  const filterAla = (status: string) => {
    run(() => {
      onNavigate("reminders");
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("erp:filter-ala", { detail: status }));
      }, 150);
    });
  };

  const setSemester = (value: string) => {
    run(async () => {
      try {
        await putSelectedSemester(value);
        window.dispatchEvent(new CustomEvent("erp:invalidate-all"));
        toast.success(
          value === "all" ? "Showing all semesters" : `Showing Semester ${value}`,
          {
            description:
              value === "all"
                ? "Every ERP-synchronized subject is visible again."
                : "Only this semester's ERP-synchronized subjects are shown now.",
          }
        );
      } catch (e) {
        toast.error("Could not change semester", {
          description: e instanceof Error ? e.message : String(e),
        });
      }
    });
  };

  const NAV = [
    { tab: "dashboard" as const, label: "Dashboard", icon: LayoutDashboard, kbd: "1" },
    { tab: "attendance" as const, label: "Attendance", icon: BarChart3, kbd: "2" },
    { tab: "reminders" as const, label: "Reminders", icon: CalendarClock, kbd: "3" },
    { tab: "settings" as const, label: "Settings", icon: SettingsIcon, kbd: "4" },
  ];

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search subjects or run a command…" />
      <CommandList className="max-h-[min(60vh,26rem)]">
        <CommandEmpty>No results found.</CommandEmpty>

        {subjects && subjects.length > 0 && (
          <>
            <CommandGroup heading="Subjects">
              {subjects.map((s) => (
                <CommandItem
                  key={s.code}
                  value={`${s.code} ${s.name} ${s.percentage.toFixed(1)}% target`}
                  onSelect={() => openSubject(s.code)}
                >
                  <span
                    className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[s.status] ?? "bg-muted-foreground")}
                    aria-hidden="true"
                  />
                  <span className="font-mono text-xs font-semibold">{s.code}</span>
                  <span className="truncate text-sm text-muted-foreground">{s.name}</span>
                  <span className="ml-auto flex items-center gap-1.5 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                    <span className={cn("font-semibold", s.status === "danger" && "text-red-600 dark:text-red-400", s.status === "warning" && "text-amber-600 dark:text-amber-400", s.status === "safe" && "text-emerald-600 dark:text-emerald-400")}>
                      {s.percentage.toFixed(1)}%
                    </span>
                    <span aria-hidden="true">·</span>
                    <Target className="size-3" aria-hidden="true" />
                    {s.targetPct}%
                    {s.hasCustomTarget && (
                      <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                        custom
                      </span>
                    )}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {deadlineItems.length > 0 && (
          <>
            <CommandGroup
              heading={`Upcoming deadlines${assignmentsQ.data ? ` · ${activeDeadlineCount} active` : ""}`}
            >
              {deadlineItems.map((a) => {
                const due = new Date(a.dueAt).getTime();
                const overdue = due < nowMs;
                const soon = !overdue && due - nowMs <= 7 * 86_400_000;
                return (
                  <CommandItem
                    key={a.id}
                    value={`${a.title} ${a.subjectCode ?? ""} ala assignment deadline`}
                    onSelect={() => openDeadline(a.title)}
                  >
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        overdue ? "bg-red-500" : soon ? "bg-amber-500" : "bg-emerald-500"
                      )}
                      aria-hidden="true"
                    />
                    <span className="truncate font-medium">{a.title}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {a.subjectCode ?? "—"}
                    </span>
                    <span
                      className={cn(
                        "ml-auto whitespace-nowrap text-xs font-medium tabular-nums",
                        overdue
                          ? "text-red-600 dark:text-red-400"
                          : soon
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-emerald-600 dark:text-emerald-400"
                      )}
                    >
                      {overdue
                        ? `${formatDistanceToNowStrict(new Date(a.dueAt))} overdue`
                        : `in ${formatDistanceToNowStrict(new Date(a.dueAt))}`}
                    </span>
                  </CommandItem>
                );
              })}
              {activeDeadlineCount > deadlineItems.length && (
                <CommandItem
                  value="show all deadlines open reminders ala assignments"
                  onSelect={() => filterAla("all")}
                  className="text-muted-foreground"
                >
                  <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
                  <span>
                    Show all <b className="font-semibold tabular-nums text-foreground">{activeDeadlineCount}</b>{" "}
                    active deadlines
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">Reminders tab</span>
                </CommandItem>
              )}
            </CommandGroup>
            <CommandSeparator />

            <CommandGroup heading="ALA quick filters">
              <CommandItem
                value="ala overdue filter late assignments triage"
                onSelect={() => filterAla("overdue")}
                disabled={overdueCount === 0}
              >
                <AlertTriangle className="size-4 shrink-0 text-red-500" aria-hidden="true" />
                <span>Show overdue ALAs</span>
                <span className="ml-auto rounded-full bg-red-500/10 px-1.5 text-[10px] font-bold tabular-nums text-red-600 dark:text-red-400">
                  {overdueCount}
                </span>
              </CommandItem>
              <CommandItem
                value="ala soon due within week filter triage"
                onSelect={() => filterAla("soon")}
                disabled={soonCount === 0}
              >
                <Timer className="size-4 shrink-0 text-amber-500" aria-hidden="true" />
                <span>Show ALAs due within 7 days</span>
                <span className="ml-auto rounded-full bg-amber-500/15 px-1.5 text-[10px] font-bold tabular-nums text-amber-700 dark:text-amber-400">
                  {soonCount}
                </span>
              </CommandItem>
              <CommandItem
                value="ala clear filters show everything reset"
                onSelect={() => filterAla("all")}
              >
                <ListFilter className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>Clear ALA filters — show the full list</span>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="Semester partition">
          <CommandItem
            value="semester all show every subject"
            onSelect={() => setSemester("all")}
            disabled={semester === "all"}
          >
            <GraduationCap className="size-4 text-muted-foreground" aria-hidden="true" />
            Show all semesters
            {semester === "all" && <Check className="ml-auto size-3.5 text-primary" aria-hidden="true" />}
          </CommandItem>
          {Array.from({ length: 8 }, (_, i) => {
            const sem = String(i + 1);
            const active = semester === sem;
            return (
              <CommandItem
                key={sem}
                value={`semester ${sem} show partition`}
                onSelect={() => setSemester(sem)}
                disabled={active}
              >
                <GraduationCap className={active ? "size-4 text-primary" : "size-4 text-muted-foreground"} aria-hidden="true" />
                Show Semester {sem} only
                {active && <Check className="ml-auto size-3.5 text-primary" aria-hidden="true" />}
              </CommandItem>
            );
          })}
        </CommandGroup>
        <CommandSeparator />

        <CommandGroup heading="Navigate">
          {NAV.map((n) => (
            <CommandItem key={n.tab} onSelect={() => run(() => onNavigate(n.tab))}>
              <n.icon className="size-4 text-muted-foreground" aria-hidden="true" />
              {n.label}
              <CommandShortcut>{n.kbd}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => run(onSyncNow)} disabled={syncing}>
            <RefreshCw className={syncing ? "size-4 animate-spin text-muted-foreground" : "size-4 text-muted-foreground"} aria-hidden="true" />
            {syncing ? "Syncing…" : "Sync with ERP now"}
            <CommandShortcut>S</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={newReminder}>
            <CalendarClock className="size-4 text-muted-foreground" aria-hidden="true" />
            New personal reminder
          </CommandItem>
          <CommandItem onSelect={toggleTheme}>
            {resolvedTheme === "dark" ? (
              <Sun className="size-4 text-muted-foreground" aria-hidden="true" />
            ) : (
              <Moon className="size-4 text-muted-foreground" aria-hidden="true" />
            )}
            Switch to {resolvedTheme === "dark" ? "light" : "dark"} theme
            <CommandShortcut>T</CommandShortcut>
          </CommandItem>
          {demoMode && (
            <CommandItem
              onSelect={() =>
                run(async () => {
                  try {
                    const res = await postDemoEvolve();
                    toast.success(res.message ?? "ERP change simulated and synced");
                    window.dispatchEvent(new CustomEvent("erp:invalidate-all"));
                  } catch (e) {
                    toast.error("Simulation failed", { description: e instanceof Error ? e.message : String(e) });
                  }
                })
              }
            >
              <FlaskConical className="size-4 text-amber-500" aria-hidden="true" />
              Simulate ERP change (demo)
            </CommandItem>
          )}
          <CommandItem
            value="what-if simulator overall attendance project miss attend classes future"
            onSelect={() =>
              run(() => {
                onNavigate("attendance");
                window.setTimeout(() => window.dispatchEvent(new CustomEvent("erp:goto-whatif")), 180);
              })
            }
          >
            <Zap className="size-4 text-amber-500" aria-hidden="true" />
            Open the what-if simulator
          </CommandItem>
          <CommandItem
            value="print report save pdf attendance"
            onSelect={() => run(() => window.print())}
          >
            <Printer className="size-4 text-muted-foreground" aria-hidden="true" />
            Print attendance report (PDF)
            <CommandShortcut>Ctrl+P</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={cycleText} value="text size font accessibility larger smaller">
            <ALargeSmall className="size-4 text-muted-foreground" aria-hidden="true" />
            Text size: {TEXT_SIZES.find((s) => s.key === textSize)?.label ?? "Default"}
            <CommandShortcut>cycle</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(onShowShortcuts)}>
            <Keyboard className="size-4 text-muted-foreground" aria-hidden="true" />
            Keyboard shortcuts
            <CommandShortcut>?</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="ERP portal · opens in a new tab">
          {[
            { href: `${ERP_BASE}/student/dashboard`, label: "Open the ERP dashboard" },
            { href: `${ERP_BASE}/student/attendance`, label: "Open the ERP attendance page" },
            { href: `${ERP_BASE}/student/assignment`, label: "Open the ERP assignments page" },
          ].map((l) => (
            <CommandItem
              key={l.href}
              value={`${l.label} erp portal website ${l.href}`}
              onSelect={() => run(() => window.open(l.href, "_blank", "noopener,noreferrer"))}
            >
              <ExternalLink className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              {l.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
