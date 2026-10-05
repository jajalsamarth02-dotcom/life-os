"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  WifiOff,
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
import { RemindersTab, type AlaStatusFilter } from "@/components/erp/reminders-tab";
import { SettingsTab, type SettingsFocus } from "@/components/erp/settings-tab";
import { CommandPalette } from "@/components/erp/command-palette";
import { useDueNotifications } from "@/components/erp/use-due-notifications";
import { useOffline } from "@/components/erp/use-offline";
import { duePersonalCount, useAppBadge } from "@/components/erp/use-app-badge";
import { fetchAssignments, fetchDashboard, fetchReminders, postSync, qk } from "@/components/erp/api";
import { fmtDT } from "@/components/erp/shared";

type TabKey = "dashboard" | "attendance" | "reminders" | "settings";

const TAB_ITEMS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "attendance", label: "Attendance", icon: BarChart3 },
  { key: "reminders", label: "Reminders", icon: CalendarClock },
  { key: "settings", label: "Settings", icon: SettingsIcon },
];

const TAB_KEYS: string[] = TAB_ITEMS.map((t) => t.key);

/** Resolve a URL hash like "#attendance" to a tab, or null when absent/unknown. */
function tabFromHash(): TabKey | null {
  if (typeof window === "undefined") return null;
  const h = window.location.hash.replace(/^#/, "");
  return TAB_KEYS.includes(h) ? (h as TabKey) : null;
}

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
  const [tab, setTabState] = useState<TabKey>("dashboard");

  /* Cross-tab triage jump: the dashboard's flagged-ALA card sets a pending
     "Noted" filter, switches to Reminders, and AlaSection consumes it once
     mounted (Radix unmounts inactive tabs, so a plain event would be missed). */
  const [pendingAlaFilter, setPendingAlaFilter] = useState<AlaStatusFilter | null>(null);
  const openFlaggedAlas = useCallback(() => {
    setPendingAlaFilter("noted");
    setTabState("reminders");
    if (window.location.hash !== "#reminders") {
      window.history.replaceState(null, "", "#reminders");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const consumePendingAlaFilter = useCallback(() => setPendingAlaFilter(null), []);

  /* r108 cross-tab sweep jump: the dashboard's housekeeping nudge sets a
     pending-cleanup signal, switches to Reminders, and AlaSection opens the
     sweep dialog once on mount (same consume-once pattern as the flagged
     filter above — Radix unmounts inactive tabs, so a plain event would be
     missed). The dialog lands pre-fed with the ALA list where the ghosts
     actually live (the timeline GET excludes erp:assign:* rows). */
  const [pendingCleanup, setPendingCleanup] = useState(false);
  const openHousekeeping = useCallback(() => {
    setPendingCleanup(true);
    setTabState("reminders");
    if (window.location.hash !== "#reminders") {
      window.history.replaceState(null, "", "#reminders");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const consumePendingCleanup = useCallback(() => setPendingCleanup(false), []);

  /* Deep link from the dashboard's setup checklist: switch to Settings and
     spotlight the exact card the row points at (consumed once on mount). */
  const [pendingSettingsFocus, setPendingSettingsFocus] = useState<SettingsFocus | null>(null);
  const openSettingsFocus = useCallback(
    (f: SettingsFocus) => {
      setPendingSettingsFocus(f);
      setTabState("settings");
      if (window.location.hash !== "#settings") {
        window.history.replaceState(null, "", "#settings");
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    []
  );
  const consumePendingSettingsFocus = useCallback(() => setPendingSettingsFocus(null), []);

  /* Tab → URL hash: every navigation leaves a shareable deep link
     (/#attendance …). replaceState keeps the browser history clean. */
  const setTab = useCallback((t: TabKey) => {
    setTabState(t);
    if (window.location.hash !== `#${t}`) {
      window.history.replaceState(null, "", `#${t}`);
    }
  }, []);

  /* URL → tab: honors deep links from PWA shortcuts / shared links on first
     load, then follows manual hash edits and history traversal live. Runs
     post-hydration so the server-rendered markup never mismatches. */
  useEffect(() => {
    const applyHash = () => {
      const t = tabFromHash();
      if (t) setTabState(t);
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  const [showShortcuts, setShowShortcuts] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const qc = useQueryClient();
  const { resolvedTheme, setTheme } = useTheme();
  const { data } = useQuery({ queryKey: qk.dashboard, queryFn: fetchDashboard, refetchInterval: 20_000 });

  /* System notifications when a reminder becomes due (device-local opt-in) */
  useDueNotifications();

  /* Offline awareness: views keep rendering from the last synced cache. */
  const online = useOffline();

  /* PWA badge (r102, two halves — the app icon's actionable queue):
     (1) overdue ERP ALAs — ACTIVE + past-due, same rows/rule as the
         Reminders tab's overdue banner;
     (2) due PERSONAL reminders — ACTIVE + past-due, counted by the pinned
         duePersonalCount pure (ERP reminder rows are deliberately excluded
         there: they mirror the ALAs half #1 already counts).
     No-ops without setAppBadge. */
  const { data: alaData } = useQuery({
    queryKey: qk.assignments,
    queryFn: fetchAssignments,
    refetchInterval: 60_000,
  });
  const overdueAlaCount = useMemo(() => {
    const now = Date.now();
    return (alaData?.assignments ?? []).filter(
      (a) => a.status === "ACTIVE" && new Date(a.dueAt).getTime() < now
    ).length;
  }, [alaData?.assignments]);
  /* Joins the "personal, no done" reminders endpoint (60s cadence, same as
     the ALA poll) — the count only, no rendering cost. */
  const { data: personalData } = useQuery({
    queryKey: qk.reminders("personal", false),
    queryFn: () => fetchReminders("personal", false),
    refetchInterval: 60_000,
  });
  const duePersonal = useMemo(() => {
    const now = Date.now();
    return duePersonalCount(personalData ?? [], now);
  }, [personalData]);
  const badgeCount = overdueAlaCount + duePersonal;
  useAppBadge(badgeCount);

  /* Live tab title: overall attendance at a glance + the unread-convention
     "(N)" prefix mirroring the app badge (same two-half rule: overdue ALAs
     + due personal reminders). Gives desktop tabs and iOS <17 (no
     setAppBadge) the same at-a-glance signal. Written only on change to
     avoid needless document mutations. */
  useEffect(() => {
    const pct = data?.overall?.percentage;
    const next =
      typeof pct === "number"
        ? `${badgeCount > 0 ? `(${badgeCount}) ` : ""}ERP Sync · ${pct.toFixed(2)}%`
        : "ERP Sync — Automatic ERP-Sync Student System";
    if (document.title !== next) document.title = next;
  }, [data?.overall?.percentage, badgeCount]);

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
    <div className="relative flex min-h-screen flex-col overflow-x-clip bg-background">
      {/* Decorative ambient gradient (subtle, theme-aware) — never printed */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden print:hidden">
        <div className="absolute -top-32 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-emerald-500/[0.07] blur-3xl" />
        <div className="absolute -right-24 top-64 h-56 w-56 rounded-full bg-amber-500/[0.05] blur-3xl" />
        <div className="absolute -left-24 top-96 h-56 w-56 rounded-full bg-emerald-500/[0.04] blur-3xl" />
      </div>
      <div className="print:hidden">
        <AppHeader onOpenPalette={() => setPaletteOpen(true)} />
      </div>

      <main className="relative mx-auto w-full max-w-6xl flex-1 px-4 py-4 sm:py-6">
        <div className="space-y-4">
          {!online && (
            <div
              role="status"
              className="flex items-center gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200"
            >
              <WifiOff className="size-4 shrink-0" aria-hidden="true" />
              <p>
                <b>You're offline.</b> Showing the last synced data — everything updates automatically once you
                reconnect.
              </p>
            </div>
          )}
          {sync?.status === "failed" && (
            <SyncFailureBanner
              message={sync.lastErrorMessage ?? "Unknown error"}
              lastSuccessAt={sync.lastSuccessAt}
            />
          )}
          {mode === "demo" && <DemoStrip onOpenSettings={() => setTab("settings")} />}

          <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="space-y-4">
            <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl p-1 print:hidden sm:grid-cols-4">
              {TAB_ITEMS.map(({ key, label, icon: Icon }, i) => (
                <TabsTrigger
                  key={key}
                  value={key}
                  className="relative gap-1.5 rounded-lg px-3 py-2.5 text-xs font-medium tracking-tight data-[state=active]:bg-transparent data-[state=active]:shadow-none sm:text-sm dark:data-[state=active]:bg-transparent"
                  aria-label={`${label} tab`}
                >
                  {key === tab && (
                    <motion.span
                      layoutId="erp-tab-thumb"
                      className="absolute inset-0 rounded-lg bg-background shadow-sm dark:bg-input/30"
                      transition={{ type: "spring", stiffness: 500, damping: 40 }}
                    />
                  )}
                  <span className="relative z-10 inline-flex items-center gap-1.5">
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    {label}
                    <kbd className="kbd kbd-hint" aria-hidden="true">{i + 1}</kbd>
                  </span>
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
                      onOpenReminders={() => setTab("reminders")}
                      onOpenFlaggedAlas={openFlaggedAlas}
                      onOpenSetupStep={openSettingsFocus}
                      onOpenHousekeeping={openHousekeeping}
                    />
                  )}
                  {key === "attendance" && <AttendanceTab onOpenSettings={() => setTab("settings")} />}
                  {key === "reminders" && (
                    <RemindersTab
                      pendingAlaFilter={pendingAlaFilter}
                      onConsumePendingAlaFilter={consumePendingAlaFilter}
                      pendingCleanup={pendingCleanup}
                      onConsumePendingCleanup={consumePendingCleanup}
                    />
                  )}
                  {key === "settings" && (
                    <SettingsTab
                      focus={pendingSettingsFocus}
                      onConsumeFocus={consumePendingSettingsFocus}
                    />
                  )}
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
        onOpenSettingsFocus={openSettingsFocus}
        onOpenHousekeeping={openHousekeeping}
      />

      <footer className="relative mt-auto border-t border-border/60 bg-card/50 print:hidden">
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
