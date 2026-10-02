"use client";

import * as React from "react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Bell,
  BellOff,
  BellRing,
  CalendarClock,
  CheckCircle2,
  Database,
  Download,
  FileJson,
  FileSpreadsheet,
  FlaskConical,
  GraduationCap,
  Info,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  MessageCircle,
  MonitorSmartphone,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Target,
  Timer,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { isIOS, promptInstall, useCanInstall, useIsInstalled } from "./install-prompt";
import { compactErrorText } from "@/lib/compact-error";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  isEnabled as browserRemindersEnabled,
  permissionState as browserRemindersPermission,
  requestPermission as requestNotificationPermission,
  sendTestNotification,
  setEnabled as setBrowserRemindersEnabled,
  type PermissionState,
} from "@/lib/browser-reminders";
import {
  connectErp,
  disconnectErp,
  downloadBackup,
  fetchAttendance,
  fetchAlaNotes,
  fetchErpStatus,
  fetchSemesters,
  fetchSettings,
  fetchSyncLogs,
  fetchWaStatus,
  postDemoEvolve,
  postDemoReset,
  putSelectedSemester,
  putSettings,
  putSubjectTarget,
  postWaAction,
  restoreAlaNotes,
  ApiError,
  qk,
} from "./api";
import { CustomTargetChip, fmtDT, syncLogIcon } from "./shared";
import { TextSizeCard } from "./text-size-card";
import { downloadCsv } from "./trend-chart";
import type { AppSettings, ErpConnectFailure, SubjectView } from "./types";

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
/* Semester partition (Sem 1–8)                                        */
/* ------------------------------------------------------------------ */

const SEMESTER_OPTIONS = [
  { value: "all", label: "All" },
  ...Array.from({ length: 8 }, (_, i) => ({ value: String(i + 1), label: `Sem ${i + 1}` })),
];

export function semesterLabel(v: string | undefined | null): string {
  if (!v || v === "all") return "All semesters";
  return `Semester ${v}`;
}

function SemesterCard() {
  const qc = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: qk.semesters,
    queryFn: fetchSemesters,
    refetchInterval: 30_000,
  });

  const setSem = useMutation({
    mutationFn: (value: string) => putSelectedSemester(value),
    onSuccess: (s) => {
      qc.invalidateQueries(); // subject lists, overall, trend, timetable pickers — everything
      const count = data?.counts.reduce((a, c) => a + c.count, 0) ?? 0;
      const scoped =
        s.selectedSemester === "all"
          ? count
          : (data?.counts.find((c) => c.semester === Number(s.selectedSemester))?.count ?? 0);
      toast.success(`Showing ${semesterLabel(s.selectedSemester)}`, {
        description:
          scoped === 0
            ? "No subjects are synchronized for this semester yet — switch back to All or sync the ERP."
            : `${scoped} synchronized subject${scoped === 1 ? "" : "s"} from the ERP.`,
      });
    },
    onError: (e) => toast.error("Could not change semester", { description: e.message }),
  });

  const selected = data?.selected ?? "all";
  const detected = data?.detected ?? null;
  const countFor = (sem: number | null) =>
    data?.counts.find((c) => c.semester === sem)?.count ?? 0;
  const totalSubjects = data?.counts.reduce((a, c) => a + c.count, 0) ?? 0;
  const unclassified = countFor(null);

  return (
    <Card className="rounded-xl border-border/60">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-2 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base tracking-tight">
            <GraduationCap className="size-4 text-primary" aria-hidden="true" />
            Semester
          </CardTitle>
          <CardDescription className="text-xs">
            Partition your subjects — only the selected semester&apos;s ERP-synchronized subjects appear across
            the app. Semester info is read live from the ERP during sync.
          </CardDescription>
        </div>
        <Badge variant="secondary" className="shrink-0 text-[11px] tabular-nums">
          {selected === "all" ? `ALL · ${totalSubjects}` : `SEM ${selected} · ${countFor(Number(selected))}`}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {isPending || !data ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-lg" />
            ))}
          </div>
        ) : (
          <>
            <div
              className="grid grid-cols-3 gap-2 sm:grid-cols-5"
              role="group"
              aria-label="Semester partition"
            >
              {SEMESTER_OPTIONS.map((opt) => {
                const isSel = selected === opt.value;
                const count =
                  opt.value === "all"
                    ? totalSubjects
                    : countFor(Number(opt.value));
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      if (!isSel) setSem.mutate(opt.value);
                    }}
                    disabled={setSem.isPending}
                    aria-pressed={isSel}
                    aria-label={`Show ${opt.value === "all" ? "all semesters" : `semester ${opt.value}`} — ${count} subjects`}
                    className={cn(
                      "flex h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg border px-2 text-xs font-medium transition-all",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isSel
                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                        : "border-border/60 bg-card hover:border-primary/40 hover:bg-muted/60",
                      setSem.isPending && "opacity-70"
                    )}
                  >
                    <span className="truncate">{opt.label}</span>
                    <span
                      className={cn(
                        "text-[10px] tabular-nums",
                        isSel ? "opacity-80" : "text-muted-foreground"
                      )}
                    >
                      {count} {count === 1 ? "subj" : "subjs"}
                    </span>
                  </button>
                );
              })}
            </div>

            {detected !== null && selected !== String(detected) && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.08] px-3 py-2">
                <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                  The ERP currently reports <span className="font-semibold text-foreground">Semester {detected}</span>.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 border-emerald-500/40 px-2 text-xs text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-800 dark:text-emerald-400"
                  disabled={setSem.isPending}
                  onClick={() => setSem.mutate(String(detected))}
                  aria-label={`Switch to the ERP-reported semester ${detected}`}
                >
                  Use Sem {detected}
                </Button>
              </div>
            )}

            {unclassified > 0 && (
              <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                {unclassified} subject{unclassified === 1 ? " has" : "s have"} no semester from the ERP yet — they only
                appear under <span className="font-medium text-foreground">All</span> until the next sync classifies
                them.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Per-subject attendance targets                                      */
/* ------------------------------------------------------------------ */

const TARGET_OPTIONS = [60, 65, 70, 75, 80, 85, 90];

function TargetRow({ s }: { s: SubjectView }) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (v: number | null) => putSubjectTarget(s.code, v),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: qk.attendance });
      qc.invalidateQueries({ queryKey: qk.dashboard });
      qc.invalidateQueries({ queryKey: qk.settings });
      toast.success(
        res.hasCustomTarget
          ? `Target for ${s.code} set to ${res.targetPct}%`
          : `${s.code} reset to the global target (${res.targetPct}%)`
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save the target"),
  });

  return (
    <TableRow className={cn("transition-colors", mutation.isPending && "opacity-60")}>
      <TableCell className="py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">
            {s.code}
          </span>
          <span className="min-w-0 truncate text-sm">{s.name}</span>
        </div>
      </TableCell>
      <TableCell className="py-2.5 text-right">
        <div className="flex items-center justify-end gap-2">
          {s.hasCustomTarget ? (
            <CustomTargetChip target={s.targetPct} />
          ) : (
            <span className="text-[11px] text-muted-foreground">global</span>
          )}
        </div>
      </TableCell>
      <TableCell className="py-2.5 text-right">
        <div className="flex items-center justify-end gap-1.5">
          <Select
            value={s.hasCustomTarget ? String(s.targetPct) : "default"}
            onValueChange={(v) => {
              if (v === "default") {
                if (s.hasCustomTarget) mutation.mutate(null);
              } else {
                const n = Number(v);
                if (n !== s.targetPct) mutation.mutate(n);
              }
            }}
          >
            <SelectTrigger
              className="h-8 w-[122px] gap-1 text-xs"
              aria-label={`Attendance target for ${s.name}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default" className="text-xs">
                Default
              </SelectItem>
              {TARGET_OPTIONS.map((p) => (
                <SelectItem key={p} value={String(p)} className="text-xs">
                  {p}%
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {s.hasCustomTarget && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate(null)}
                  aria-label={`Reset ${s.name} to the global target`}
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Back to the global target</TooltipContent>
            </Tooltip>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function SubjectTargetsCard() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: qk.attendance,
    queryFn: fetchAttendance,
  });

  const customCount = data?.subjects.filter((s) => s.hasCustomTarget).length ?? 0;

  return (
    <Card className="rounded-xl border-border/60">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-2 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base tracking-tight">
            <Target className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            Per-subject targets
          </CardTitle>
          <CardDescription className="text-xs">
            Different papers can require different attendance. Each subject&apos;s target drives its status,
            warnings and what-if planning; the overall figure keeps the global target.
          </CardDescription>
        </div>
        <Badge variant="outline" className="shrink-0 tabular-nums">
          {customCount}/{data?.subjects.length ?? 0} custom
        </Badge>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : isError || !data ? (
          <p className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
            Could not load subjects: {error?.message ?? "unknown error"}
          </p>
        ) : data.subjects.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {data.semester !== "all"
              ? `No subjects synchronized for Semester ${data.semester} — targets can be set once the ERP syncs them.`
              : "No subjects synchronized yet — targets can be set after the first sync."}
          </p>
        ) : (
          <div className="max-h-96 overflow-x-auto overflow-y-auto rounded-lg border border-border/50">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead className="text-xs">Subject</TableHead>
                  <TableHead className="text-right text-xs">Current</TableHead>
                  <TableHead className="text-right text-xs">Target</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.subjects.map((s) => (
                  <TargetRow key={s.id} s={s} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Targets are stored locally and never sent to the ERP. Changing one recomputes that subject&apos;s
          warning immediately — no sync needed.
        </p>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Browser reminders (system notifications when something is due)      */
/* ------------------------------------------------------------------ */

function BrowserRemindersCard() {
  const [permission, setPermission] = React.useState<PermissionState>("default");
  const [enabled, setEnabled] = React.useState(false);
  const [requesting, setRequesting] = React.useState(false);

  React.useEffect(() => {
    const read = () => {
      setPermission(browserRemindersPermission());
      setEnabled(browserRemindersEnabled());
    };
    read();
    window.addEventListener("erp:browser-reminders-changed", read);
    return () => window.removeEventListener("erp:browser-reminders-changed", read);
  }, []);

  const enable = async () => {
    setRequesting(true);
    const result = await requestNotificationPermission();
    setRequesting(false);
    if (result === "granted") {
      setBrowserRemindersEnabled(true);
      toast.success("Browser reminders on", {
        description: "You'll get a system alert when a reminder becomes due.",
      });
    } else if (result === "denied") {
      toast.error("Permission denied", {
        description: "Allow notifications for this site in your browser settings to use reminders.",
      });
    }
  };

  const supported = permission !== "unsupported";

  return (
    <Card className="rounded-xl border-border/60">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base tracking-tight">
            <BellRing className="size-4 text-primary" aria-hidden="true" />
            Browser reminders
          </CardTitle>
          <CardDescription>System alerts when a reminder becomes due</CardDescription>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "text-[10px]",
            enabled && permission === "granted"
              ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
              : "text-muted-foreground"
          )}
        >
          {permission === "unsupported"
            ? "NOT SUPPORTED"
            : enabled && permission === "granted"
              ? "ON"
              : permission === "denied"
                ? "BLOCKED"
                : "OFF"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {!supported ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Info className="size-4 shrink-0" aria-hidden="true" />
            This browser does not support system notifications. In-app toasts still work.
          </p>
        ) : permission === "denied" ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden="true" />
            Notifications are blocked for this site. Re-enable them in your browser's site settings, then reload.
          </p>
        ) : permission === "granted" ? (
          <>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 p-3">
              <div>
                <Label htmlFor="browser-reminders" className="text-sm">Notify me when a reminder is due</Label>
                <p className="text-[11px] text-muted-foreground">
                  Fires once per reminder on this device; auto-managed attendance warnings are excluded.
                </p>
              </div>
              <Switch
                id="browser-reminders"
                checked={enabled}
                onCheckedChange={(v) => setBrowserRemindersEnabled(v)}
                aria-label="Toggle browser due-reminder notifications"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              disabled={!enabled}
              onClick={() => {
                const ok = sendTestNotification();
                if (ok) toast.success("Test notification sent");
                else toast.error("Could not show a notification");
              }}
            >
              <BellRing className="size-3.5" aria-hidden="true" />
              Send a test
            </Button>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Get a system-level alert the moment a deadline becomes due — even when this tab is in the
              background. Permission is asked once, per device.
            </p>
            <Button size="sm" className="h-8 gap-1.5" onClick={enable} disabled={requesting}>
              {requesting ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <BellRing className="size-3.5" aria-hidden="true" />}
              Enable browser reminders
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Install app (PWA)                                                   */
/* ------------------------------------------------------------------ */

function InstallAppCard() {
  const canInstall = useCanInstall();
  const installed = useIsInstalled();
  const [pending, setPending] = useState(false);
  const ios = isIOS();

  const install = async () => {
    setPending(true);
    const outcome = await promptInstall();
    setPending(false);
    if (outcome === "accepted") toast.success("App installed 🎉", { description: "Launch it from your home screen." });
    else if (outcome === "dismissed") toast.info("Install dismissed", { description: "You can install any time from Settings." });
  };

  return (
    <Card className="rounded-xl border-border/60">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base tracking-tight">
            <MonitorSmartphone className="size-4 text-primary" aria-hidden="true" />
            Install the app
          </CardTitle>
          <CardDescription>Full-screen, offline-friendly home-screen app (PWA)</CardDescription>
        </div>
        {installed && (
          <Badge variant="outline" className="border-emerald-500/40 text-[10px] text-emerald-700 dark:text-emerald-400">
            INSTALLED
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {installed ? (
          <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
            You're running the installed app. Data still syncs from the ERP whenever a connection is available.
          </p>
        ) : canInstall ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Install ERP Sync as an app — own window, home-screen icon, faster launches.
            </p>
            <Button size="sm" className="h-8 gap-1.5" onClick={install} disabled={pending}>
              {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <MonitorSmartphone className="size-3.5" aria-hidden="true" />}
              Install now
            </Button>
          </div>
        ) : ios ? (
          <ol className="list-inside list-decimal space-y-1 text-sm text-muted-foreground">
            <li>Open this page in Safari</li>
            <li>Tap the <span className="font-medium text-foreground">Share</span> button</li>
            <li>Choose <span className="font-medium text-foreground">Add to Home Screen</span></li>
          </ol>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Info className="size-4 shrink-0" aria-hidden="true" />
            Use your browser menu → <span className="font-medium text-foreground">Install app / Add to Home screen</span> when
            offered. The button appears here automatically when your browser supports it.
          </p>
        )}
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
  const [confirmReset, setConfirmReset] = React.useState(false);

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

  const reset = useMutation({
    mutationFn: postDemoReset,
    onSuccess: (res) => {
      qc.invalidateQueries();
      setConfirmReset(false);
      const w = res.wiped;
      (res.ok ? toast.success : toast.error)(res.message, {
        description: `Wiped ${w.subjects} subjects, ${w.timetableSlots} slots, ${w.snapshots} snapshots, ${w.notifications} notifications — then re-synced from a fresh simulated ERP.`,
      });
    },
    onError: (e) => toast.error("Reset failed", { description: e.message }),
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

        <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              className="h-8 w-full gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              disabled={!demoOn || reset.isPending}
              aria-label="Reset demo data to the pristine baseline"
            >
              {reset.isPending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RotateCcw className="size-3.5" aria-hidden="true" />
              )}
              Reset demo data
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset demo data?</AlertDialogTitle>
              <AlertDialogDescription>
                This wipes everything the demo has generated — subjects, attendance counts, the weekly timetable,
                snapshots, history, ERP reminders and notifications — then immediately re-syncs a freshly seeded
                simulated ERP. Your settings (targets, cadence, notification prefs) and personal reminders are kept.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500/40"
                onClick={(e) => {
                  e.preventDefault();
                  reset.mutate();
                }}
              >
                {reset.isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                Reset &amp; re-sync
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
          <div className="max-h-96 overflow-x-auto overflow-y-auto rounded-lg border border-border/50">
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
                                {compactErrorText(l.errorDetails, 120)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-72 break-all">
                              <p className="font-mono text-[11px]">{compactErrorText(l.errorDetails)}</p>
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
/* Data & backups card                                                 */
/* ------------------------------------------------------------------ */

const LAST_BACKUP_KEY = "erp:lastBackupAt";
const LAST_RESTORE_KEY = "erp:lastRestoreAt";

function readLocalStamp(key: string): string | null {
  try {
    const v = localStorage.getItem(key);
    return v ? new Date(v).toLocaleString() : null;
  } catch {
    return null;
  }
}

/** Days since the last full backup on this device; null = never backed up here. */
function daysSinceLastBackup(): number | null {
  try {
    const raw = localStorage.getItem(LAST_BACKUP_KEY);
    if (!raw) return null;
    return (Date.now() - new Date(raw).getTime()) / 86_400_000;
  } catch {
    return null;
  }
}

/** Download any text payload as a file (JSON notes export). */
function downloadJson(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** One staged restore candidate, parsed client-side before the write. */
interface StagedRestore {
  fileName: string;
  exportedAt: string | null;
  rows: { externalId: string; note: string; priority: number }[];
  withText: number;
  withPriority: number;
}

const EXT_PREFIX = "erp:assign:";

/** Accept a full app backup (meta.alaNotes) or a bare notes export (notes). */
function parseRestoreFile(text: string, fileName: string): StagedRestore | null {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  const raw = Array.isArray(obj.alaNotes) ? obj.alaNotes : Array.isArray(obj.notes) ? obj.notes : null;
  if (!raw) return null;

  const rows: StagedRestore["rows"] = [];
  for (const item of raw) {
    const rec = item as Record<string, unknown> | null;
    const externalId = typeof rec?.externalId === "string" ? rec.externalId : "";
    if (!externalId.startsWith(EXT_PREFIX)) continue;
    const note = typeof rec?.note === "string" ? rec.note : "";
    const priority = typeof rec?.priority === "number" && Number.isInteger(rec.priority) ? Math.min(Math.max(rec.priority, 0), 3) : 0;
    rows.push({ externalId, note, priority });
  }
  if (rows.length === 0) return null;

  const meta = (obj.meta ?? null) as Record<string, unknown> | null;
  return {
    fileName,
    exportedAt: typeof meta?.exportedAt === "string" ? meta.exportedAt : null,
    rows,
    withText: rows.filter((r) => r.note.trim() !== "").length,
    withPriority: rows.filter((r) => r.priority > 0).length,
  };
}

function DataBackupCard() {
  const qc = useQueryClient();
  const { data: att } = useQuery({ queryKey: qk.attendance, queryFn: fetchAttendance });
  const { data: notes } = useQuery({ queryKey: qk.alaNotes, queryFn: fetchAlaNotes });
  const notedCount = notes?.length ?? 0;
  const [busy, setBusy] = useState<null | "backup" | "csv" | "restore">(null);
  const [staged, setStaged] = useState<StagedRestore | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [staleDays, setStaleDays] = useState<number | null>(null);
  const [stamps, setStamps] = useState<{ backup: string | null; restore: string | null }>({
    backup: null,
    restore: null,
  });
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  /* Surface persisted "last backup / restore" stamps on mount (+ staleness). */
  React.useEffect(() => {
    setStamps({ backup: readLocalStamp(LAST_BACKUP_KEY), restore: readLocalStamp(LAST_RESTORE_KEY) });
    const days = daysSinceLastBackup();
    setStaleDays(days !== null && days >= 7 ? Math.floor(days) : null);
  }, []);

  /* Full JSON backup via GET /api/export — the portable copy of everything the
     local mirror knows, including the private ALA notes overlay. Encrypted
     credentials are excluded server-side. */
  const runBackup = async () => {
    setBusy("backup");
    try {
      const filename = await downloadBackup();
      localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString());
      setStamps((s) => ({ ...s, backup: new Date().toLocaleString() }));
      setStaleDays(null);
      toast.success("Backup downloaded", { description: filename });
    } catch (e) {
      toast.error("Backup failed", {
        description: e instanceof Error ? e.message : "Could not build the backup",
      });
    } finally {
      setBusy(null);
    }
  };

  /* One-row-per-subject CSV of the live attendance snapshot. */
  const runCsv = () => {
    if (!att) return;
    setBusy("csv");
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      downloadCsv(
        `attendance-${stamp}.csv`,
        ["Code", "Subject", "Present", "Held", "Attendance %", "Target %", "Status", "Custom target"],
        att.subjects.map((s) => [
          s.code,
          s.name,
          s.present,
          s.total,
          s.percentage.toFixed(2),
          s.targetPct,
          s.status,
          s.hasCustomTarget ? "yes" : "no",
        ])
      );
      toast.success("Subjects CSV exported", {
        description: `${att.subjects.length} subjects · overall ${att.overall.percentage.toFixed(2)}%`,
      });
    } finally {
      setBusy(null);
    }
  };

  /* Read + stage a dropped or browsed backup file (nothing written yet). */
  const stageFile = async (file: File) => {
    if (busy) return;
    setBusy("restore");
    try {
      const text = await file.text();
      const parsed = parseRestoreFile(text, file.name);
      if (!parsed) {
        toast.error("Not a restorable backup", {
          description: "No ALA annotations found — use a JSON file produced by this app.",
        });
        return;
      }
      setStaged(parsed);
    } catch {
      toast.error("Could not read that file");
    } finally {
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  /* Lightweight notes-layer export — the file the restore dropzone accepts. */
  const exportNotesOnly = () => {
    if (!notes || notes.length === 0) return;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const filename = `erp-sync-ala-notes-${stamp}.json`;
    downloadJson(
      filename,
      JSON.stringify(
        {
          meta: {
            app: "erp-sync",
            schemaVersion: 1,
            exportedAt: new Date().toISOString(),
            note: "Private ALA notes & priority flags (local overlay only). Restorable via Settings → Data & backups.",
          },
          notes: notes.map((n) => ({
            externalId: n.externalId,
            note: n.note,
            priority: n.priority,
            createdAt: n.createdAt,
            updatedAt: n.updatedAt,
          })),
        },
        null,
        2
      )
    );
    toast.success(`Exported ${notes.length} noted ${notes.length === 1 ? "ALA" : "ALAs"}`, {
      description: filename,
    });
  };

  /* The actual write — only runs after the user confirms the dialog. */
  const runRestore = async () => {
    if (!staged) return;
    setBusy("restore");
    try {
      const res = await restoreAlaNotes(staged.rows);
      localStorage.setItem(LAST_RESTORE_KEY, new Date().toISOString());
      setStamps((s) => ({ ...s, restore: new Date().toLocaleString() }));
      const parts: string[] = [];
      if (res.created) parts.push(`${res.created} added`);
      if (res.updated) parts.push(`${res.updated} updated`);
      if (res.cleared) parts.push(`${res.cleared} cleared`);
      if (res.skipped) parts.push(`${res.skipped} skipped (no matching ALA row)`);
      if (res.invalid) parts.push(`${res.invalid} invalid`);
      toast.success(`Restored ${res.created + res.updated} noted ${res.created + res.updated === 1 ? "ALA" : "ALAs"}`, {
        description: parts.join(" · ") || "Nothing to change — your notes already match the backup.",
      });
      await qc.invalidateQueries({ queryKey: qk.alaNotes });
      await qc.invalidateQueries({ queryKey: qk.assignments });
    } catch (e) {
      toast.error("Restore failed", {
        description: e instanceof Error ? e.message : "Could not restore the notes",
      });
    } finally {
      setBusy(null);
      setStaged(null);
    }
  };

  return (
    <Card className="rounded-xl border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base tracking-tight">
          <Database className="size-4 text-primary" aria-hidden="true" />
          Data &amp; backups
        </CardTitle>
        <CardDescription>Your data is yours — take a portable copy any time</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {staleDays !== null && (
          <p className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-400" role="status">
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
            Last backup was {staleDays} {staleDays === 1 ? "day" : "days"} ago — take a fresh copy below.
          </p>
        )}

        <div className="flex items-start justify-between gap-3 rounded-lg border border-border/50 p-3 transition-colors hover:bg-muted/40">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Database className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium">Full backup (JSON)</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Subjects, ALAs &amp; reminders, private ALA notes, timetable, sync logs, change events,
                notifications and settings — one portable file.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0 gap-1.5"
            onClick={runBackup}
            disabled={busy !== null}
            aria-label="Download the full JSON backup"
          >
            {busy === "backup" ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="size-3.5" aria-hidden="true" />
            )}
            Download
          </Button>
        </div>

        <div className="flex items-start justify-between gap-3 rounded-lg border border-border/50 p-3 transition-colors hover:bg-muted/40">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <FileSpreadsheet className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium">Subjects (CSV)</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                One row per subject with attendance, target and status — opens in Excel or Sheets.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0 gap-1.5"
            onClick={runCsv}
            disabled={busy !== null || !att}
            aria-label="Export the subject attendance table as CSV"
          >
            {busy === "csv" ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <FileSpreadsheet className="size-3.5" aria-hidden="true" />
            )}
            Export
          </Button>
        </div>

        {/* Restore dropzone — dashed idle, solid+glow while dragging a file over. */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Restore noted ALAs from a backup file — drop a JSON backup here or press Enter to browse"
          onClick={() => !busy && fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!busy) fileInputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void stageFile(file);
          }}
          className={cn(
            "group cursor-pointer rounded-lg border-2 border-dashed p-3 outline-none transition-all",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            dragOver
              ? "scale-[1.01] border-primary bg-primary/10 shadow-[0_0_0_4px_hsl(var(--primary)/0.08)]"
              : "border-border/70 hover:border-primary/50 hover:bg-primary/[0.04]"
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <span
                className={cn(
                  "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md transition-colors",
                  dragOver ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"
                )}
              >
                {busy === "restore" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <FileJson className="size-4" aria-hidden="true" />
                )}
              </span>
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium">
                  Restore noted ALAs
                  {dragOver && <span className="ml-1.5 text-primary">— drop to stage</span>}
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Drag a backup JSON here or click to browse. Your private notes &amp; priority flags come
                  back — nothing is overwritten until you confirm.
                </p>
              </div>
            </div>
            <Badge
              variant="secondary"
              className={cn(
                "shrink-0 tabular-nums",
                notedCount > 0 && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              )}
              aria-label={`${notedCount} noted ${notedCount === 1 ? "ALA" : "ALAs"} currently stored`}
            >
              {notedCount} noted
            </Badge>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void stageFile(file);
            }}
          />
        </div>

        {/* Notes-only export — completes the loop: this exact file feeds the dropzone. */}
        {notedCount > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2">
            <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">{notedCount} noted</span> on this device — a
              notes-only JSON keeps them safe without the full backup.
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 gap-1.5 text-xs"
              onClick={exportNotesOnly}
              disabled={busy !== null}
              aria-label={`Export the ${notedCount} noted ALAs as a notes-only JSON file`}
            >
              <Download className="size-3.5" aria-hidden="true" />
              Export notes
            </Button>
          </div>
        )}

        {(stamps.backup || stamps.restore) && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] leading-relaxed text-muted-foreground/70">
            {stamps.backup && (
              <span className="inline-flex items-center gap-1">
                <Download className="size-3" aria-hidden="true" /> Backed up {stamps.backup}
              </span>
            )}
            {stamps.restore && (
              <span className="inline-flex items-center gap-1">
                <Upload className="size-3" aria-hidden="true" /> Restored {stamps.restore}
              </span>
            )}
          </p>
        )}

        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground/80">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
          <span>Encrypted ERP credentials and WhatsApp keys are never included in any export.</span>
        </p>
      </CardContent>

      {/* Write confirmation — restore only proceeds after an explicit OK. */}
      <AlertDialog open={staged !== null} onOpenChange={(open) => !open && setStaged(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Upload className="size-4 text-primary" aria-hidden="true" />
              Restore {staged?.rows.length ?? 0} noted {staged?.rows.length === 1 ? "ALA" : "ALAs"}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  From <span className="font-medium text-foreground">{staged?.fileName}</span>
                  {staged?.exportedAt && (
                    <> · exported {new Date(staged.exportedAt).toLocaleString()}</>
                  )}
                </p>
                <ul className="space-y-1 text-muted-foreground">
                  <li>· {staged?.withText ?? 0} with a private note</li>
                  <li>· {staged?.withPriority ?? 0} with a priority flag</li>
                </ul>
                <p>
                  Matching ALA rows are <span className="font-medium text-foreground">overwritten</span> with
                  the backup state; rows no longer in your ERP mirror are skipped. Nothing is deleted in bulk.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "restore"}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault(); // keep the dialog open until the write finishes
                void runRestore();
              }}
              disabled={busy === "restore"}
              className="gap-1.5"
            >
              {busy === "restore" ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="size-3.5" aria-hidden="true" />
              )}
              Restore {staged?.rows.length ?? 0}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* WhatsApp alerts card (CallMeBot)                                    */
/* ------------------------------------------------------------------ */

function WhatsAppCard() {
  const qc = useQueryClient();
  const { data: status } = useQuery({ queryKey: qk.waStatus, queryFn: fetchWaStatus });
  const [phone, setPhone] = useState("");
  const [apikey, setApikey] = useState("");
  const [digestTime, setDigestTime] = useState("");
  const [busy, setBusy] = useState<null | "save" | "test" | "digest" | "time" | "clearTime">(null);

  const refresh = () => qc.invalidateQueries({ queryKey: qk.waStatus });

  const run = async (action: "save" | "test" | "digest") => {
    setBusy(action);
    try {
      if (action === "save") {
        if (!phone.trim() || !apikey.trim()) {
          toast.error("Phone and apikey are both required.");
          return;
        }
        await postWaAction("save", { phone: phone.trim(), apikey: apikey.trim() });
        toast.success("WhatsApp settings saved", { description: "The apikey is stored AES-256-GCM encrypted." });
        setApikey("");
        refresh();
      } else if (action === "test") {
        const res = await postWaAction("test");
        (res.ok ? toast.success : toast.error)(res.ok ? "Test message sent — check WhatsApp" : "The provider did not accept the test", {
          description: res.snippet,
        });
        refresh();
      } else {
        const res = await postWaAction("digest");
        (res.ok ? toast.success : toast.error)(res.ok ? "Digest sent — check WhatsApp" : "The provider did not accept the digest", {
          description: res.snippet,
        });
        refresh();
      }
    } catch (e) {
      toast.error("WhatsApp action failed", { description: e instanceof ApiError ? e.message : "Try again." });
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (enabled: boolean) => {
    try {
      await postWaAction("enable", { enabled });
      toast[enabled ? "success" : "info"](enabled ? "WhatsApp alerts enabled" : "WhatsApp alerts disabled", {
        description: enabled
          ? status?.digestTime
            ? `A pending-work digest arrives daily at ${status.digestTime} IST, plus sync-triggered alerts when something changed.`
            : "A short pending-work digest is sent at most once a day, right after a scheduled sync, when something changed."
          : undefined,
      });
      refresh();
    } catch (e) {
      toast.error("Could not update the setting", { description: e instanceof ApiError ? e.message : "Try again." });
    }
  };

  const saveDigestTime = async (time: string | null) => {
    setBusy(time ? "time" : "clearTime");
    try {
      await postWaAction("setDigestTime", { time });
      toast.success(
        time ? `Daily digest scheduled for ${time} IST` : "Fixed daily digest removed",
        {
          description: time
            ? "Sent every day at that IST time, even if nothing changed since the last sync."
            : "Auto digests now fire only after scheduled syncs when something changed.",
        }
      );
      refresh();
    } catch (e) {
      toast.error("Could not save the digest time", { description: e instanceof ApiError ? e.message : "Try again." });
    } finally {
      setBusy(null);
    }
  };

  const enabled = status?.enabled ?? false;
  const configured = status?.configured ?? false;
  const savedTime = status?.digestTime ?? null;

  return (
    <Card className="rounded-xl border-border/60">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base tracking-tight">
            <MessageCircle className="size-4 text-emerald-500" aria-hidden="true" />
            WhatsApp alerts
            <Badge variant="outline" className="text-[9px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
              Beta
            </Badge>
          </CardTitle>
          <CardDescription>Pending ALA/assignment digests straight to your WhatsApp</CardDescription>
        </div>
        <Switch
          checked={enabled}
          disabled={!configured}
          onCheckedChange={toggle}
          aria-label="Enable WhatsApp alerts"
        />
      </CardHeader>
      <CardContent className="space-y-3">
        {!configured ? (
          <ol className="list-inside list-decimal space-y-1 text-sm text-muted-foreground">
            <li>
              Get a free apikey at{" "}
              <a
                href="https://www.callmebot.com/blog/free-api-for-send-whatsapp-messages/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                callmebot.com
              </a>{" "}
              (one WhatsApp message from your phone to their bot)
            </li>
            <li>Paste your number and the apikey below — stored encrypted, never exported</li>
            <li>Send a test, then flip the switch on</li>
          </ol>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary" className="font-mono text-[10px]">{status?.phoneMasked}</Badge>
            {enabled ? (
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <BellRing className="size-3" aria-hidden="true" />
                {savedTime
                  ? `auto-digest on — daily at ${savedTime} IST, plus after syncs when something changed`
                  : "auto-digest on (max 1/day, after scheduled syncs when something changed)"}
              </span>
            ) : (
              <span>Sending is off — flip the switch to enable auto digests.</span>
            )}
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Input
            inputMode="tel"
            placeholder={configured ? status?.phoneMasked ?? "Phone" : "Phone (e.g. 91 98XXXXXXXX)"}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-label="WhatsApp phone number with country code"
          />
          <Input
            type="password"
            placeholder={configured ? "apikey saved — paste to replace" : "CallMeBot apikey"}
            value={apikey}
            onChange={(e) => setApikey(e.target.value)}
            aria-label="CallMeBot apikey"
          />
          <Button size="sm" variant="outline" className="h-9 gap-1.5" disabled={busy !== null} onClick={() => run("save")}>
            {busy === "save" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Save className="size-3.5" aria-hidden="true" />}
            Save
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" className="h-8 gap-1.5" disabled={!configured || busy !== null} onClick={() => run("test")}>
            {busy === "test" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <MessageCircle className="size-3.5" aria-hidden="true" />}
            Send test
          </Button>
          <Button size="sm" variant="secondary" className="h-8 gap-1.5" disabled={!configured || busy !== null} onClick={() => run("digest")}>
            {busy === "digest" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <CalendarClock className="size-3.5" aria-hidden="true" />}
            Send pending-work digest now
          </Button>
        </div>

        <div className="rounded-lg border border-border/60 bg-muted/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-medium">
              <Timer className="size-3.5 text-primary" aria-hidden="true" />
              Daily digest time (IST)
              {savedTime && (
                <Badge variant="outline" className="border-primary/40 font-mono text-[10px] text-primary">
                  {savedTime}
                </Badge>
              )}
            </span>
            <span className="text-[10px] text-muted-foreground">optional</span>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            Schedule one guaranteed digest per day at a fixed IST time — sent even when nothing changed
            since the last sync. Leave empty to only notify after scheduled syncs.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input
              type="time"
              step={60}
              className="h-9 w-32 font-mono text-xs"
              value={digestTime}
              onChange={(e) => setDigestTime(e.target.value)}
              placeholder={savedTime ?? "20:30"}
              aria-label="Daily digest time in IST, 24-hour"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-9 gap-1.5"
              disabled={!configured || busy !== null || !digestTime}
              onClick={() => saveDigestTime(digestTime)}
              aria-label="Save daily digest time"
            >
              {busy === "time" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Timer className="size-3.5" aria-hidden="true" />}
              Schedule
            </Button>
            {savedTime && (
              <Button
                size="sm"
                variant="ghost"
                className="h-9 gap-1.5 text-muted-foreground hover:text-destructive"
                disabled={busy !== null}
                onClick={() => {
                  setDigestTime("");
                  void saveDigestTime(null);
                }}
                aria-label="Remove daily digest schedule"
              >
                {busy === "clearTime" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <X className="size-3.5" aria-hidden="true" />}
                Remove
              </Button>
            )}
          </div>
        </div>

        {status?.lastResult && (
          <p className="truncate rounded-lg bg-muted/60 px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground" title={status.lastResult}>
            last: {status.lastResult}
          </p>
        )}

        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Uses the free CallMeBot relay with YOUR paired phone. Nothing is sent while disabled or unconfigured;
          messages are generated only from real synced ERP data.
        </p>
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
      <SemesterCard />
      <SubjectTargetsCard />
      <NotificationPrefsCard />
      <WhatsAppCard />
      <div className="grid gap-4 lg:grid-cols-2">
        <BrowserRemindersCard />
        <InstallAppCard />
      </div>
      <TextSizeCard />
      <DemoModeCard liveConnected={liveConnected} />
      <DataBackupCard />
      <SyncHistoryCard />

      <Card className="rounded-xl border-border/60 bg-muted/40">
        <CardContent className="flex gap-3 p-4">
          <Info className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">Privacy &amp; data flow</p>
            <p>
              The ERP is the source of truth. This app stores a synchronized copy for fast dashboards,
              calculations and reminders. The only write to the ERP is an ALA submission that YOU trigger
              explicitly, row by row.
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
