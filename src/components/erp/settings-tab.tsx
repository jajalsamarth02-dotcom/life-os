"use client";

import * as React from "react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Bell,
  BellOff,
  CalendarClock,
  CheckCircle2,
  FlaskConical,
  Info,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  connectErp,
  disconnectErp,
  fetchErpStatus,
  fetchSettings,
  fetchSyncLogs,
  postDemoEvolve,
  putSettings,
  ApiError,
  qk,
} from "./api";
import { fmtDT, syncLogIcon } from "./shared";
import type { AppSettings, ErpConnectFailure } from "./types";

/* ------------------------------------------------------------------ */
/* ERP connection card                                                 */
/* ------------------------------------------------------------------ */

function ErpConnectionCard() {
  const qc = useQueryClient();
  const { data: erp, isPending } = useQuery({
    queryKey: qk.erpStatus,
    queryFn: fetchErpStatus,
    refetchInterval: 20_000,
  });

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [connectError, setConnectError] = useState<ErpConnectFailure | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const invalidateAll = () => qc.invalidateQueries();

  const connect = useMutation({
    mutationFn: () => connectErp(username.trim(), password),
    onSuccess: (res) => {
      setConnectError(null);
      setPassword("");
      invalidateAll();
      toast.success(`Connected as ${res.username}`, {
        description: `Initial sync fetched ${res.snapshotSubjects} subject(s).`,
      });
    },
    onError: (e) => {
      const body: ErpConnectFailure =
        e instanceof ApiError
          ? { ok: false, errorCode: e.errorCode ?? "UNKNOWN", error: e.message, details: e.details }
          : { ok: false, errorCode: "NETWORK", error: e.message };
      setConnectError(body);
    },
  });

  const disconnect = useMutation({
    mutationFn: disconnectErp,
    onSuccess: () => {
      invalidateAll();
      toast.success("ERP account disconnected");
    },
    onError: (e) => toast.error("Disconnect failed", { description: e.message }),
  });

  if (isPending || !erp) {
    return (
      <Card className="rounded-xl border-border/60">
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-64" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-28" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base tracking-tight">
          <KeyRound className="size-4 text-primary" aria-hidden="true" />
          ERP connection
        </CardTitle>
        <CardDescription>
          Connect with your own student credentials from erp.gmiu.edu.in.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {erp.connected ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
              <CheckCircle2 className="size-6 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  Connected as {erp.username}
                </p>
                <p className="text-xs text-muted-foreground">
                  Status: {erp.connectionStatus ?? "ok"} · Last verified: {fmtDT(erp.lastVerifiedAt)}
                </p>
              </div>
              {erp.liveAvailable !== "unknown" && (
                <Badge variant="outline" className="shrink-0">
                  live sync: {erp.liveAvailable}
                </Badge>
              )}
            </div>

            <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="gap-1.5 text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400" aria-label="Disconnect ERP account">
                  <LogOut className="size-4" aria-hidden="true" />
                  Disconnect
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Disconnect ERP account?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Your stored credentials will be deleted from the server. Synchronized attendance data stays
                    available until the next sync, but nothing new will be fetched until you reconnect.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-red-600 text-white hover:bg-red-700"
                    onClick={() => disconnect.mutate()}
                  >
                    Disconnect
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (username.trim() && password) connect.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="erp-email">ERP email / username</Label>
              <Input
                id="erp-email"
                type="text"
                inputMode="email"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="student@gyanmanjari.com"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="erp-password">ERP password</Label>
              <Input
                id="erp-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            {connectError && (
              <Alert variant="destructive" className="border-red-500/40">
                <AlertCircle className="size-4" />
                <AlertTitle>
                  {connectError.error}
                  {connectError.errorCode && (
                    <Badge variant="outline" className="ml-2 border-red-500/40 font-mono text-[10px] text-red-600 dark:text-red-400">
                      {connectError.errorCode}
                    </Badge>
                  )}
                </AlertTitle>
                {connectError.details && (
                  <AlertDescription className="mt-1 break-all font-mono text-[11px] leading-relaxed">
                    {connectError.details}
                  </AlertDescription>
                )}
              </Alert>
            )}

            <Button type="submit" disabled={connect.isPending || !username.trim() || !password} className="gap-1.5">
              {connect.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Connecting…
                </>
              ) : (
                <>
                  <Lock className="size-4" aria-hidden="true" />
                  Connect
                </>
              )}
            </Button>
          </form>
        )}

        <Separator />

        <div className="flex gap-3 rounded-lg bg-muted/60 p-3.5">
          <ShieldCheck className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            The ERP does not offer an official API. The app uses an authorized server-side session with your own
            credentials. Credentials are AES-256-GCM encrypted, never exposed to the browser. If the ERP blocks
            automation (CAPTCHA etc.), synchronization will be reported as unavailable — it is never bypassed.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Sync settings card                                                  */
/* ------------------------------------------------------------------ */

function SyncSettingsForm({ initial }: { initial: AppSettings }) {
  const qc = useQueryClient();
  const [target, setTarget] = useState<number>(initial.targetPercentage);
  const [interval, setIntervalMin] = useState<number>(initial.syncIntervalMinutes);
  const [autoSync, setAutoSync] = useState<boolean>(initial.autoSyncEnabled);

  const save = useMutation({
    mutationFn: () =>
      putSettings({ targetPercentage: target, syncIntervalMinutes: interval, autoSyncEnabled: autoSync }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Settings saved", {
        description: `Target ${target}% · sync every ${interval} min${autoSync ? " · auto-sync on" : " · auto-sync off"}`,
      });
    },
    onError: (e) => toast.error("Could not save settings", { description: e.message }),
  });

  return (
    <CardContent className="space-y-5">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="target-slider">Attendance target</Label>
            <span className="rounded-md bg-muted px-2 py-0.5 text-sm font-semibold tabular-nums">{target}%</span>
          </div>
          <Slider
            id="target-slider"
            value={[target]}
            min={50}
            max={95}
            step={1}
            aria-label="Attendance target percentage"
            onValueChange={(v) => setTarget(v[0] ?? 75)}
          />
          <p className="text-[11px] text-muted-foreground">Between 50% and 95%. Warnings are recalculated immediately.</p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="interval-slider">Sync interval</Label>
            <span className="rounded-md bg-muted px-2 py-0.5 text-sm font-semibold tabular-nums">
              {interval} min
            </span>
          </div>
          <Slider
            id="interval-slider"
            value={[interval]}
            min={5}
            max={120}
            step={5}
            aria-label="Automatic sync interval in minutes"
            onValueChange={(v) => setIntervalMin(v[0] ?? 15)}
          />
          <p className="text-[11px] text-muted-foreground">How often the engine checks the ERP for changes (5–120 minutes).</p>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 p-3">
          <div>
            <Label htmlFor="auto-sync" className="text-sm">Automatic background sync</Label>
            <p className="text-[11px] text-muted-foreground">Run scheduled syncs without opening the app</p>
          </div>
          <Switch id="auto-sync" checked={autoSync} onCheckedChange={setAutoSync} />
        </div>

        <Button onClick={() => save.mutate()} disabled={save.isPending} className="gap-1.5" aria-label="Save sync settings">
          {save.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
          Save settings
        </Button>
      </CardContent>
  );
}

function SyncSettingsCard() {
  const { data: settings } = useQuery({ queryKey: qk.settings, queryFn: fetchSettings });
  const { data: erp } = useQuery({ queryKey: qk.erpStatus, queryFn: fetchErpStatus });

  return (
    <Card className="rounded-xl border-border/60">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base tracking-tight">
            <Save className="size-4 text-primary" aria-hidden="true" />
            Sync settings
          </CardTitle>
          <CardDescription>Attendance target and synchronization cadence</CardDescription>
        </div>
        {erp?.sync.nextScheduledSyncAt && (
          <Badge variant="secondary" className="text-[11px]">
            next sync {fmtDT(erp.sync.nextScheduledSyncAt)}
          </Badge>
        )}
      </CardHeader>
      {settings ? (
        <SyncSettingsForm initial={settings} />
      ) : (
        <CardContent className="space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-9 w-28" />
        </CardContent>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Notification preferences                                            */
/* ------------------------------------------------------------------ */

const NOTIFY_META: { key: string; label: string; description: string; icon: React.ElementType; className: string }[] = [
  {
    key: "ATTENDANCE_WARNING",
    label: "Attendance warnings",
    description: "A subject drops below your target — the most important alert",
    icon: TriangleAlert,
    className: "text-amber-500",
  },
  {
    key: "REMINDER_CHANGE",
    label: "Deadline updates",
    description: "The ERP moved an exam or submission date",
    icon: CalendarClock,
    className: "text-primary",
  },
  {
    key: "ERP_CHANGE",
    label: "ERP data changes",
    description: "Every sync that applies changes to your mirror",
    icon: RefreshCw,
    className: "text-emerald-500",
  },
  {
    key: "SYNC_FAILURE",
    label: "Sync failures",
    description: "Recommended: know when data may be stale",
    icon: AlertCircle,
    className: "text-red-500",
  },
  {
    key: "SYNC_SUCCESS",
    label: "Connection restored",
    description: "When a failing ERP connection works again",
    icon: CheckCircle2,
    className: "text-emerald-500",
  },
];

function NotificationPrefsCard() {
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: qk.settings, queryFn: fetchSettings });
  const [draft, setDraft] = useState<Record<string, boolean> | null>(null);

  const prefs = draft ?? settings?.notifyPrefs ?? {};
  const enabledCount = NOTIFY_META.filter((m) => prefs[m.key] !== false).length;

  const save = useMutation({
    mutationFn: (next: Record<string, boolean>) => putSettings({ notifyPrefs: next }),
    onSuccess: (_s, next) => {
      setDraft(null);
      qc.invalidateQueries({ queryKey: qk.settings });
      const off = Object.entries(next).filter(([, v]) => !v).length;
      toast.success(
        off > 0 ? `Notifications updated — ${off} type${off === 1 ? "" : "s"} muted` : "All notifications enabled"
      );
    },
    onError: (e) => toast.error("Could not save notification preferences", { description: e.message }),
  });

  const setPref = (key: string, value: boolean) => {
    setDraft({ ...prefs, [key]: value });
  };

  const dirty =
    draft !== null &&
    NOTIFY_META.some((m) => (draft[m.key] ?? true) !== (settings?.notifyPrefs?.[m.key] ?? true));

  return (
    <Card className="rounded-xl border-border/60">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base tracking-tight">
            <Bell className="size-4 text-primary" aria-hidden="true" />
            Notifications
          </CardTitle>
          <CardDescription>Choose which events create a notification</CardDescription>
        </div>
        <Badge variant="secondary" className="text-[11px] tabular-nums">
          {enabledCount}/{NOTIFY_META.length} on
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {!settings ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {NOTIFY_META.map((m) => {
              const on = prefs[m.key] !== false;
              const Icon = on ? m.icon : BellOff;
              return (
                <div
                  key={m.key}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border p-3 transition-colors",
                    on ? "border-border/50 bg-card" : "border-border/40 bg-muted/40"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-lg",
                      on ? "bg-muted" : "bg-muted/60 opacity-50"
                    )}
                    aria-hidden="true"
                  >
                    <Icon className={cn("size-4", on ? m.className : "text-muted-foreground")} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Label htmlFor={`notify-${m.key}`} className={cn("text-sm", !on && "text-muted-foreground")}>
                      {m.label}
                    </Label>
                    <p className="truncate text-[11px] text-muted-foreground">{m.description}</p>
                  </div>
                  <Switch
                    id={`notify-${m.key}`}
                    checked={on}
                    onCheckedChange={(v) => setPref(m.key, v)}
                    disabled={save.isPending}
                    aria-label={`${on ? "Disable" : "Enable"} ${m.label} notifications`}
                  />
                </div>
              );
            })}
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted-foreground">
            Applies to future events — existing notifications are kept.
          </p>
          <Button
            size="sm"
            className="h-8 gap-1.5"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate(draft ?? {})}
            aria-label="Save notification preferences"
          >
            {save.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Save className="size-3.5" aria-hidden="true" />}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Demo mode card                                                      */
/* ------------------------------------------------------------------ */

function DemoModeCard({ liveConnected }: { liveConnected: boolean }) {
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: qk.settings, queryFn: fetchSettings });

  const toggle = useMutation({
    mutationFn: (demoMode: boolean) => putSettings({ demoMode }),
    onSuccess: (s) => {
      qc.invalidateQueries();
      toast.success(s.demoMode ? "Demo ERP simulator enabled" : "Demo ERP simulator disabled");
    },
    onError: (e) => toast.error("Could not change demo mode", { description: e.message }),
  });

  const evolve = useMutation({
    mutationFn: postDemoEvolve,
    onSuccess: (res) => {
      qc.invalidateQueries();
      toast.success(res.message ?? "ERP change simulated and synced", {
        description: "Watch the dashboard, warnings and reminders update automatically.",
      });
    },
    onError: (e) => toast.error("Simulation failed", { description: e.message }),
  });

  if (liveConnected) return null;
  const demoOn = settings?.demoMode ?? false;

  return (
    <Card className="rounded-xl border-amber-500/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base tracking-tight">
          <FlaskConical className="size-4 text-amber-500" aria-hidden="true" />
          Demo mode
          <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-700 dark:text-amber-400">
            SIMULATED
          </Badge>
        </CardTitle>
        <CardDescription>
          Explore the full sync pipeline with a simulated ERP that changes over time — no real credentials needed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 p-3">
          <div>
            <Label htmlFor="demo-switch" className="text-sm">Use demo ERP simulator</Label>
            <p className="text-[11px] text-muted-foreground">
              Turn off once you connect your real ERP account (connecting live disables demo automatically).
            </p>
          </div>
          {settings ? (
            <Switch
              id="demo-switch"
              checked={demoOn}
              onCheckedChange={(v) => toggle.mutate(v)}
              disabled={toggle.isPending}
            />
          ) : (
            <Skeleton className="h-5 w-9" />
          )}
        </div>

        <Button
          variant="outline"
          className="w-full gap-1.5 border-amber-500/40 text-amber-700 hover:bg-amber-500/10 hover:text-amber-800 dark:text-amber-400"
          onClick={() => evolve.mutate()}
          disabled={!demoOn || evolve.isPending}
          aria-label="Simulate an ERP-side change and sync it"
        >
          {evolve.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="size-4" aria-hidden="true" />
          )}
          Simulate ERP change (demo)
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Creates a realistic change on the simulated ERP (new classes, moved deadlines, added subjects) and runs an
          immediate sync, so you can watch detection → recalculation → notifications happen end-to-end.
        </p>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Sync history                                                        */
/* ------------------------------------------------------------------ */

function SyncHistoryCard() {
  const { data, isPending } = useQuery({
    queryKey: qk.sync,
    queryFn: fetchSyncLogs,
    refetchInterval: 20_000,
  });

  return (
    <Card className="rounded-xl border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-base tracking-tight">Sync history</CardTitle>
        <CardDescription>Last synchronization runs of the background engine</CardDescription>
      </CardHeader>
      <CardContent>
        {isPending || !data ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : data.logs.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No sync runs recorded yet</p>
        ) : (
          <div className="max-h-96 overflow-y-auto rounded-lg border border-border/50">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead className="w-10"><span className="sr-only">Status</span></TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead className="text-right">Changes</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead><span className="sr-only">Error details</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.logs.map((l) => {
                  const Icon = syncLogIcon(l.status);
                  return (
                    <TableRow key={l.id}>
                      <TableCell>
                        <Icon
                          className={cn(
                            "size-4",
                            l.status === "success" && "text-emerald-500",
                            l.status === "failed" && "text-red-500",
                            l.status === "running" && "animate-spin text-amber-500",
                            l.status === "skipped" && "text-muted-foreground"
                          )}
                          aria-label={`Sync ${l.status}`}
                        />
                      </TableCell>
                      <TableCell className="text-xs capitalize">{l.trigger}</TableCell>
                      <TableCell className="text-xs uppercase">{l.mode}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{l.changes}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{l.durationMs} ms</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtDT(l.startedAt)}</TableCell>
                      <TableCell>
                        {l.errorDetails ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="block max-w-32 cursor-default truncate font-mono text-[11px] text-red-600 dark:text-red-400">
                                {l.errorDetails}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-72 break-all">
                              <p className="font-mono text-[11px]">{l.errorDetails}</p>
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-xs text-muted-foreground/60">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

export function SettingsTab() {
  const { data: erp } = useQuery({ queryKey: qk.erpStatus, queryFn: fetchErpStatus });
  const liveConnected = erp?.connected === true;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <ErpConnectionCard />
        <SyncSettingsCard />
      </div>
      <NotificationPrefsCard />
      <DemoModeCard liveConnected={liveConnected} />
      <SyncHistoryCard />

      <Card className="rounded-xl border-border/60 bg-muted/40">
        <CardContent className="flex gap-3 p-4">
          <Info className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">Privacy &amp; data flow</p>
            <p>
              The ERP is the source of truth. This app stores a read-only synchronized copy for fast dashboards,
              calculations and reminders. It never writes to the ERP.
            </p>
            <p className="text-muted-foreground/70">
              erp.gmiu.edu.in · encrypted credential storage (AES-256-GCM) · synchronization status is always
              reported honestly — simulated data is clearly labeled as DEMO.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
