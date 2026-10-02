"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  BarChart3,
  CalendarClock,
  FlaskConical,
  Keyboard,
  LayoutDashboard,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  TriangleAlert,
  X,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { AppHeader } from "@/components/erp/header";
import { DashboardTab } from "@/components/erp/dashboard-tab";
import { AttendanceTab } from "@/components/erp/attendance-tab";
import { RemindersTab } from "@/components/erp/reminders-tab";
import { SettingsTab } from "@/components/erp/settings-tab";
import { CommandPalette } from "@/components/erp/command-palette";
import { useDueNotifications } from "@/components/erp/use-due-notifications";
import { fetchDashboard, postSync, qk } from "@/components/erp/api";
import { fmtDT } from "@/components/erp/shared";

type TabKey = "dashboard" | "attendance" | "reminders" | "settings";

const TAB_ITEMS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "attendance", label: "Attendance", icon: BarChart3 },
  { key: "reminders", label: "Reminders", icon: CalendarClock },
  { key: "settings", label: "Settings", icon: SettingsIcon },
];

const SHORTCUTS: { keys: string[]; description: string }[] = [
  { keys: ["⌘K"], description: "Open the command palette" },
  { keys: ["1"], description: "Go to Dashboard" },
  { keys: ["2"], description: "Go to Attendance" },
  { keys: ["3"], description: "Go to Reminders" },
  { keys: ["4"], description: "Go to Settings" },
  { keys: ["S"], description: "Sync with the ERP now" },
  { keys: ["T"], description: "Toggle dark / light theme" },
  { keys: ["?"], description: "Show this shortcuts help" },
];

function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base tracking-tight">
            <Keyboard className="size-4 text-emerald-500" aria-hidden="true" />
            Keyboard shortcuts
          </DialogTitle>
          <DialogDescription className="text-xs">
            Shortcuts are ignored while typing in a field.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-1.5">
          {SHORTCUTS.map((s) => (
            <li key={s.description} className="flex items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-2">
              <span className="text-sm text-foreground/90">{s.description}</span>
              <kbd className="kbd">{s.keys[0]}</kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

/* Sync failure banner — honest reporting, previously synced data still shown */
function SyncFailureBanner({ message, lastSuccessAt }: { message: string; lastSuccessAt: string | null }) {
  const qc = useQueryClient();
  const retry = useMutation({
    mutationFn: postSync,
    onSuccess: (res) => {
      qc.invalidateQueries();
      if (res.ok) toast.success(res.message ?? "Sync recovered");
      else toast.error(res.errorCode ?? "SYNC_FAILED", { description: res.message });
    },
    onError: (e) => {
      qc.invalidateQueries();
      toast.error("Sync failed again", { description: e.message });
    },
  });

  return (
    <Alert className="rounded-xl border-red-500/40 bg-red-500/[0.06] text-red-700 dark:text-red-400">
      <TriangleAlert className="size-4" aria-hidden="true" />
      <AlertTitle className="font-semibold">ERP Sync Failed — {message}</AlertTitle>
      <AlertDescription className="text-red-700/80 dark:text-red-400/80">
        Last successful sync: {lastSuccessAt ? fmtDT(lastSuccessAt) : "never"}. Your previously synchronized data is
        still being shown.
        <Button
          size="sm"
          variant="outline"
          className="ml-3 mt-2 h-7 gap-1 border-red-500/40 text-red-700 hover:bg-red-500/10 hover:text-red-800 dark:text-red-400 sm:mt-0"
          onClick={() => retry.mutate()}
          disabled={retry.isPending}
          aria-label="Retry the failed ERP synchronization"
        >
          <RefreshCw className={cn("size-3.5", retry.isPending && "animate-spin")} aria-hidden="true" />
          Try Again
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/* Dismissible demo-mode explainer strip */
function DemoStrip({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/[0.07] px-4 py-3 text-amber-800 dark:text-amber-300">
      <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p className="flex-1 text-xs leading-relaxed sm:text-sm">
        <b>Demo mode</b> — attendance comes from a simulated ERP so you can explore the system.{" "}
        <button
          type="button"
          onClick={onOpenSettings}
          className="underline decoration-amber-500/60 underline-offset-2 transition-colors hover:decoration-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Connect your real ERP account in Settings.
        </button>
      </p>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0 text-amber-700 hover:bg-amber-500/20 hover:text-amber-900 dark:text-amber-300"
        aria-label="Dismiss demo mode notice"
        onClick={() => setDismissed(true)}
      >
        <X className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}

export default function Home() {
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const qc = useQueryClient();
  const { resolvedTheme, setTheme } = useTheme();
  const { data } = useQuery({ queryKey: qk.dashboard, queryFn: fetchDashboard, refetchInterval: 20_000 });

  /* System notifications when a reminder becomes due (device-local opt-in) */
  useDueNotifications();

  const sync = data?.erp?.sync;
  const mode = data?.mode;

  const syncNow = useMutation({
    mutationFn: postSync,
    onSuccess: (res) => {
      qc.invalidateQueries();
      if (res.ok) {
        toast.success(res.message ?? "Sync complete", {
          description: res.changes ? `${res.changes} change(s) applied from the ERP.` : "Everything is already up to date.",
        });
      } else {
        toast.error(res.errorCode ?? "SYNC_FAILED", { description: res.message });
      }
    },
    onError: (e) => {
      qc.invalidateQueries();
      toast.error("Sync failed", { description: e.message });
    },
  });

  /* Global keyboard shortcuts (ignored while typing in fields) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)
      ) {
        return;
      }
      const key = e.key;
      if (key === "?" || (key === "/" && e.shiftKey)) {
        e.preventDefault();
        setShowShortcuts((v) => !v);
        return;
      }
      if (key >= "1" && key <= "4") {
        const idx = Number(key) - 1;
        setTab(TAB_ITEMS[idx].key);
        return;
      }
      if (key === "s" || key === "S") {
        if (!syncNow.isPending && sync?.status !== "syncing") syncNow.mutate();
        return;
      }
      if (key === "t" || key === "T") {
        setTheme(resolvedTheme === "dark" ? "light" : "dark");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resolvedTheme, syncNow.isPending, sync?.status]);

  /* Cross-component events (command palette → tabs) */
  useEffect(() => {
    const invalidate = () => qc.invalidateQueries();
    window.addEventListener("erp:invalidate-all", invalidate);
    return () => window.removeEventListener("erp:invalidate-all", invalidate);
  }, [qc]);

  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      {/* Decorative ambient gradient (subtle, theme-aware) */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-emerald-500/[0.07] blur-3xl" />
        <div className="absolute -right-24 top-64 h-56 w-56 rounded-full bg-amber-500/[0.05] blur-3xl" />
        <div className="absolute -left-24 top-96 h-56 w-56 rounded-full bg-emerald-500/[0.04] blur-3xl" />
      </div>
      <AppHeader onOpenPalette={() => setPaletteOpen(true)} />

      <main className="relative mx-auto w-full max-w-6xl flex-1 px-4 py-4 sm:py-6">
        <div className="space-y-4">
          {sync?.status === "failed" && (
            <SyncFailureBanner
              message={sync.lastErrorMessage ?? "Unknown error"}
              lastSuccessAt={sync.lastSuccessAt}
            />
          )}
          {mode === "demo" && <DemoStrip onOpenSettings={() => setTab("settings")} />}

          <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="space-y-4">
            <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl p-1 sm:grid-cols-4">
              {TAB_ITEMS.map(({ key, label, icon: Icon }, i) => (
                <TabsTrigger
                  key={key}
                  value={key}
                  className="gap-1.5 rounded-lg px-3 py-2.5 text-xs font-medium tracking-tight data-[state=active]:shadow-sm sm:text-sm"
                  aria-label={`${label} tab`}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {label}
                  <kbd className="kbd kbd-hint" aria-hidden="true">{i + 1}</kbd>
                </TabsTrigger>
              ))}
            </TabsList>

            {TAB_ITEMS.map(({ key, label, icon: Icon }) => (
              <TabsContent key={key} value={key} className="mt-0 focus-visible:outline-none">
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, ease: "easeOut" }}
                >
                  {key === "dashboard" && (
                    <DashboardTab
                      onOpenAttendance={() => setTab("attendance")}
                      onOpenSettings={() => setTab("settings")}
                    />
                  )}
                  {key === "attendance" && <AttendanceTab onOpenSettings={() => setTab("settings")} />}
                  {key === "reminders" && <RemindersTab />}
                  {key === "settings" && <SettingsTab />}
                </motion.div>
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </main>

      <ShortcutsDialog open={showShortcuts} onOpenChange={setShowShortcuts} />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNavigate={(t) => setTab(t)}
        onShowShortcuts={() => setShowShortcuts(true)}
        onSyncNow={() => {
          if (!syncNow.isPending && sync?.status !== "syncing") syncNow.mutate();
        }}
        syncing={syncNow.isPending || sync?.status === "syncing"}
        demoMode={mode === "demo"}
        subjects={data?.subjects}
        semester={data?.semester}
      />

      <footer className="relative mt-auto border-t border-border/60 bg-card/50">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-1 px-4 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] text-center text-xs text-muted-foreground sm:flex-row sm:text-left">
          <p>
            Automatic ERP-Sync Student System · Gyanmanjari Innovative University · Data source:{" "}
            <span className="font-medium text-foreground/70">erp.gmiu.edu.in (read-only)</span>
          </p>
          <p className="flex items-center gap-2 tabular-nums">
            {sync?.lastSyncAt ? `Data updated ${fmtDT(sync.lastSyncAt)}` : "No data yet"}
            <button
              type="button"
              onClick={() => setShowShortcuts(true)}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 px-1.5 py-0.5 text-[11px] transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Show keyboard shortcuts"
            >
              <Keyboard className="size-3" aria-hidden="true" />
              <kbd className="text-[10px] font-semibold">?</kbd>
            </button>
          </p>
        </div>
      </footer>
    </div>
  );
}
