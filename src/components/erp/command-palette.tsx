"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  BarChart3,
  CalendarClock,
  FlaskConical,
  Keyboard,
  LayoutDashboard,
  Moon,
  RefreshCw,
  Settings as SettingsIcon,
  Sun,
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
import { postDemoEvolve, postSync } from "./api";
import type { SubjectView } from "./types";

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
                  value={`${s.code} ${s.name}`}
                  onSelect={() => openSubject(s.code)}
                >
                  <BarChart3 className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="font-mono text-xs font-semibold">{s.code}</span>
                  <span className="truncate text-sm text-muted-foreground">{s.name}</span>
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                    {s.percentage.toFixed(1)}%
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

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
