"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  BarChart3,
  CalendarClock,
  Check,
  FlaskConical,
  GraduationCap,
  Keyboard,
  LayoutDashboard,
  Moon,
  RefreshCw,
  Settings as SettingsIcon,
  Sun,
  Target,
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
import { postDemoEvolve, postSync, putSelectedSemester } from "./api";
import type { AttendanceStatus, SubjectView } from "./types";

const STATUS_DOT: Record<AttendanceStatus, string> = {
  safe: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
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
 * Global command palette (⌘K / Ctrl+K): quick navigation, actions and
 * subject jump-to-details.
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
          <CommandItem onSelect={() => run(onShowShortcuts)}>
            <Keyboard className="size-4 text-muted-foreground" aria-hidden="true" />
            Keyboard shortcuts
            <CommandShortcut>?</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
