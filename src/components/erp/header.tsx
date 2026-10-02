"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertCircle,
  Bell,
  CheckCircle2,
  GraduationCap,
  Info,
  Moon,
  OctagonAlert,
  RefreshCw,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { fetchDashboard, postSync, markAllNotificationsRead, qk } from "./api";
import { ago, fmtDT, useNow } from "./shared";
import type { AppMode, AppNotification, NotificationSeverity } from "./types";

function ModeBadge({ mode }: { mode: AppMode | undefined }) {
  if (mode === "live") {
    return (
      <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" variant="outline">
        <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
        LIVE
      </Badge>
    );
  }
  if (mode === "demo") {
    return (
      <Badge className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400" variant="outline">
        <span className="size-1.5 rounded-full bg-amber-500" aria-hidden="true" />
        DEMO
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <span className="size-1.5 rounded-full bg-muted-foreground/50" aria-hidden="true" />
      NOT CONNECTED
    </Badge>
  );
}

const SEVERITY_ICON: Record<NotificationSeverity, React.ElementType> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertCircle,
  critical: OctagonAlert,
};

const SEVERITY_CLASS: Record<NotificationSeverity, string> = {
  info: "text-muted-foreground bg-muted",
  success: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
  warning: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
  critical: "text-red-600 dark:text-red-400 bg-red-500/10",
};

function NotificationItem({ n, now }: { n: AppNotification; now: number }) {
  const Icon = SEVERITY_ICON[n.severity] ?? Info;
  return (
    <li
      className={cn(
        "flex items-start gap-2.5 rounded-lg p-2.5 transition-colors hover:bg-muted/60",
        !n.read && "bg-primary/[0.04]"
      )}
    >
      <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md", SEVERITY_CLASS[n.severity] ?? SEVERITY_CLASS.info)}>
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium leading-snug">
          <span className="truncate">{n.title}</span>
          {!n.read && <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label="unread" />}
        </p>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.message}</p>
        <p className="mt-1 text-[11px] text-muted-foreground/80" title={fmtDT(n.createdAt)}>
          {ago(n.createdAt, now)}
        </p>
      </div>
    </li>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const isDark = resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {mounted && isDark ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
    </Button>
  );
}

function NotificationsBell({ notifications, unreadCount }: { notifications: AppNotification[]; unreadCount: number }) {
  const qc = useQueryClient();
  const now = useNow();
  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.dashboard });
      toast.success("All notifications marked as read");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications (${unreadCount} unread)`}>
          <Bell className="size-4.5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white tabular-nums">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,26rem)] p-0">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <h4 className="text-sm font-semibold tracking-tight">Notifications</h4>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            disabled={unreadCount === 0 || markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            <CheckCircle2 className={cn("size-3.5", markAll.isPending && "animate-spin")} aria-hidden="true" />
            Mark all read
          </Button>
        </div>
        <Separator />
        <ul className="max-h-96 overflow-y-auto p-2" aria-label="Notification list">
          {notifications.length === 0 ? (
            <li className="px-3 py-8 text-center text-sm text-muted-foreground">No notifications yet</li>
          ) : (
            notifications.map((n) => <NotificationItem key={n.id} n={n} now={now} />)
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function AppHeader() {
  const qc = useQueryClient();
  const now = useNow();
  const { data } = useQuery({ queryKey: qk.dashboard, queryFn: fetchDashboard });

  const sync = data?.erp?.sync;
  const mode = data?.mode;
  const lastSyncAt = sync?.lastSuccessAt ?? sync?.lastSyncAt ?? null;
  const isSyncing = sync?.status === "syncing";

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

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/65">
      <TooltipProvider delayDuration={150}>
        <div className="mx-auto flex max-w-6xl items-center gap-2.5 px-4 py-2.5 sm:gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <GraduationCap className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="text-base font-semibold leading-tight tracking-tight">ERP Sync</h1>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">
              Gyanmanjari Innovative University
            </p>
          </div>

          <ModeBadge mode={mode} />

          {lastSyncAt ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="hidden cursor-default text-xs text-muted-foreground md:inline-flex">
                  Last ERP sync:&nbsp;<span className="font-medium text-foreground/80">{ago(lastSyncAt, now)}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent>{fmtDT(lastSyncAt)}</TooltipContent>
            </Tooltip>
          ) : (
            !data && <Skeleton className="hidden h-4 w-28 md:block" />
          )}

          <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => syncNow.mutate()}
              disabled={syncNow.isPending || isSyncing}
              aria-label="Synchronize with ERP now"
            >
              <RefreshCw className={cn("size-4", (syncNow.isPending || isSyncing) && "animate-spin")} aria-hidden="true" />
              <span className="hidden sm:inline">{syncNow.isPending ? "Syncing…" : "Sync Now"}</span>
            </Button>

            {data ? (
              <NotificationsBell notifications={data.notifications} unreadCount={data.unreadCount} />
            ) : (
              <Button variant="ghost" size="icon" aria-label="Notifications" disabled>
                <Bell className="size-4.5" />
              </Button>
            )}

            <ThemeToggle />
          </div>
        </div>
      </TooltipProvider>
      <p className="sr-only">
        Data synchronized from the college ERP, read-only. {lastSyncAt ? `Last sync ${format(new Date(lastSyncAt), "d MMM, h:mm a")}.` : "Not synced yet."}
      </p>
    </header>
  );
}
