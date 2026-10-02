"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  BarChart3,
  CalendarClock,
  FlaskConical,
  LayoutDashboard,
  RefreshCw,
  Settings as SettingsIcon,
  TriangleAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { AppHeader } from "@/components/erp/header";
import { DashboardTab } from "@/components/erp/dashboard-tab";
import { AttendanceTab } from "@/components/erp/attendance-tab";
import { RemindersTab } from "@/components/erp/reminders-tab";
import { SettingsTab } from "@/components/erp/settings-tab";
import { fetchDashboard, postSync, qk } from "@/components/erp/api";
import { fmtDT } from "@/components/erp/shared";

type TabKey = "dashboard" | "attendance" | "reminders" | "settings";

const TAB_ITEMS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "attendance", label: "Attendance", icon: BarChart3 },
  { key: "reminders", label: "Reminders", icon: CalendarClock },
  { key: "settings", label: "Settings", icon: SettingsIcon },
];

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
  const { data } = useQuery({ queryKey: qk.dashboard, queryFn: fetchDashboard, refetchInterval: 20_000 });

  const sync = data?.erp?.sync;
  const mode = data?.mode;

  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      {/* Decorative ambient gradient (subtle, theme-aware) */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-emerald-500/[0.07] blur-3xl" />
        <div className="absolute -right-24 top-64 h-56 w-56 rounded-full bg-amber-500/[0.05] blur-3xl" />
        <div className="absolute -left-24 top-96 h-56 w-56 rounded-full bg-emerald-500/[0.04] blur-3xl" />
      </div>
      <AppHeader />

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
              {TAB_ITEMS.map(({ key, label, icon: Icon }) => (
                <TabsTrigger
                  key={key}
                  value={key}
                  className="gap-1.5 rounded-lg px-3 py-2.5 text-xs font-medium tracking-tight data-[state=active]:shadow-sm sm:text-sm"
                  aria-label={`${label} tab`}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {label}
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

      <footer className="relative mt-auto border-t border-border/60 bg-card/50">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-1 px-4 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] text-center text-xs text-muted-foreground sm:flex-row sm:text-left">
          <p>
            Automatic ERP-Sync Student System · Gyanmanjari Innovative University · Data source:{" "}
            <span className="font-medium text-foreground/70">erp.gmiu.edu.in (read-only)</span>
          </p>
          <p className="tabular-nums">
            {sync?.lastSyncAt ? `Data updated ${fmtDT(sync.lastSyncAt)}` : "No data yet"}
          </p>
        </div>
      </footer>
    </div>
  );
}
