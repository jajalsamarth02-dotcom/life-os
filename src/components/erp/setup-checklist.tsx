"use client";

/**
 * "Finish setup" checklist (dashboard, row 0.4).
 *
 * Derives each row from the LIVE config state — WhatsApp (CallMeBot), ntfy
 * push, the calendar subscription token and the optional fixed digest time —
 * via the SAME React Query keys the Settings cards use, so the two views can
 * never disagree and no duplicate fetches exist. Rows deep-link into the exact
 * Settings section (page.tsx hands the tab switch + spotlight through).
 *
 * Honesty rules: unknown state never renders as "done"; a saved-but-disabled
 * channel reads as its own amber "Saved but off" state, not as either extreme.
 * r106: "done" now means DELIVERED, not merely enabled — the channel's last
 * send result (via lib/notify-health, the one rulebook shared with Settings)
 * demotes a configured+enabled channel whose last attempt FAILED to its own
 * red "Send failed" state, and an enabled-but-never-tested one to amber
 * "Unverified". A failing channel can never collapse the card to the
 * "Setup complete" strip (coreDone counts real deliveries only).
 * When the three core steps are live the card collapses to a slim strip (the
 * optional digest row never blocks completion) that the user can hide —
 * device-local, and a newly pending core step resurfaces it regardless.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AlarmClock,
  AlertTriangle,
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Info,
  ListChecks,
  MessageCircle,
  PartyPopper,
  Radio,
  X,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { parseNotifyHealth } from "@/lib/notify-health";
import { cn } from "@/lib/utils";
import { fetchCalendarToken, fetchNtfyStatus, fetchWaStatus, qk } from "./api";
import type { SettingsFocus } from "./settings-tab";

/** Device-local dismissal of the collapsed strip (only honored while core steps stay done). */
const HIDE_KEY = "erp:setupDoneHidden";

type RowState = "done" | "attention" | "partial" | "todo";

interface RowSpec {
  key: string;
  title: string;
  desc: string;
  state: RowState;
  /** Chip caption — driven by the health verdict for channel rows. */
  chipText: string;
  optional?: boolean;
  target: SettingsFocus;
  icon: LucideIcon;
  chipClass: string;
}

function StateChip({ state, chipText }: { state: RowState; chipText: string }) {
  if (state === "done") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-3.5" aria-hidden="true" />
        Done
      </span>
    );
  }
  if (state === "attention") {
    return (
      <Badge
        variant="outline"
        className="shrink-0 border-red-500/50 bg-red-500/[0.06] text-[10px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400"
      >
        <AlertTriangle className="size-3" aria-hidden="true" />
        {chipText}
      </Badge>
    );
  }
  if (state === "partial") {
    return (
      <Badge
        variant="outline"
        className="shrink-0 border-amber-500/50 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400"
      >
        <CircleDashed className="size-3" aria-hidden="true" />
        {chipText}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="shrink-0 border-violet-500/50 text-[10px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400"
    >
      To do
    </Badge>
  );
}

function RowButton({ row, onOpenStep }: { row: RowSpec; onOpenStep?: (f: SettingsFocus) => void }) {
  const Icon = row.icon;
  return (
    <button
      type="button"
      onClick={() => onOpenStep?.(row.target)}
      aria-label={`${row.title} — ${row.chipText.toLowerCase()}${
        row.state === "done" ? "" : " — open in Settings"
      }`}
      className={cn(
        "group flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        row.state === "done"
          ? "border-border/40 bg-muted/20 hover:bg-muted/40"
          : row.state === "attention"
            ? "border-red-500/30 bg-red-500/[0.04] hover:border-red-500/50 hover:bg-red-500/[0.07]"
            : "border-border/60 hover:border-violet-500/40 hover:bg-violet-500/[0.05]",
        row.optional && "border-dashed"
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          row.state === "attention" ? "bg-red-500/10 text-red-600 dark:text-red-400" : row.chipClass
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span
            className={cn(
              "text-sm font-medium tracking-tight",
              (row.state === "done" || row.state === "attention") && "text-muted-foreground"
            )}
          >
            {row.title}
          </span>
          {row.optional && (
            <Badge
              variant="outline"
              className="border-border/60 text-[9px] font-bold uppercase tracking-wider text-muted-foreground"
            >
              Optional
            </Badge>
          )}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground" title={row.desc}>
          {row.desc}
        </span>
      </span>
      <StateChip state={row.state} chipText={row.chipText} />
      <ChevronRight
        className={cn(
          "size-4 shrink-0 text-muted-foreground/50 transition-transform duration-150 group-hover:translate-x-0.5",
          row.state === "attention" ? "group-hover:text-red-500" : "group-hover:text-violet-500"
        )}
        aria-hidden="true"
      />
    </button>
  );
}

function SkeletonRow() {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border/40 px-3 py-2.5" aria-hidden="true">
      <span className="size-8 shrink-0 animate-pulse rounded-lg bg-muted" />
      <span className="min-w-0 flex-1 space-y-1.5">
        <span className="block h-3 w-32 animate-pulse rounded bg-muted" />
        <span className="block h-2.5 w-48 max-w-full animate-pulse rounded bg-muted/70" />
      </span>
      <span className="h-4 w-12 shrink-0 animate-pulse rounded bg-muted" />
    </li>
  );
}

export function SetupChecklist({ onOpenStep }: { onOpenStep?: (f: SettingsFocus) => void }) {
  /* Same query keys as the Settings cards — configure there, and this card
     reflects it on the next mount without any custom invalidation wiring. */
  const wa = useQuery({ queryKey: qk.waStatus, queryFn: fetchWaStatus });
  const ntfy = useQuery({ queryKey: qk.ntfyStatus, queryFn: fetchNtfyStatus });
  const cal = useQuery({ queryKey: qk.calendarToken, queryFn: fetchCalendarToken });

  const [hidden, setHidden] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(HIDE_KEY) === "1");
    } catch {
      setHidden(false); /* private mode — never hide */
    }
  }, []);

  const rows = useMemo<RowSpec[]>(() => {
    const out: RowSpec[] = [];
    const nowMs = Date.now();
    /* One health rulebook (lib/notify-health) for BOTH channel rows — the
     * same verdicts the Settings cards print; the two views cannot drift. */
    const channelState = (h: ReturnType<typeof parseNotifyHealth> | null) =>
      !h
        ? { state: "todo" as const, chipText: "To do" }
        : h.verdict === "live"
          ? { state: "done" as const, chipText: "Done" }
          : h.verdict === "failing"
            ? { state: "attention" as const, chipText: h.label }
            : { state: "partial" as const, chipText: h.label };
    if (wa.data) {
      const h = parseNotifyHealth({
        enabled: wa.data.enabled,
        configured: wa.data.configured,
        lastResult: wa.data.lastResult,
        nowMs,
      });
      const { state, chipText } = channelState(h);
      out.push({
        key: "wa",
        title: "WhatsApp alerts",
        state,
        chipText,
        desc:
          h.verdict === "live"
            ? `Live on ${wa.data.phoneMasked ?? "your number"} — last message ${h.atLabel ?? "delivered"}`
            : h.verdict === "unconfigured"
              ? "Pending-work digests straight to your WhatsApp"
              : h.atLabel
                ? `${h.detail} (${h.atLabel})`
                : h.detail,
        /* r110 care chain: a REJECTED key jumps straight INTO the repair
           wizard (Settings scrolls there AND opens it) — the row was already
           honest about the failure; now it lands one tap from the fix. */
        target: h.verdict === "failing" || h.verdict === "unconfigured" ? "wa-repair" : "notify",
        icon: MessageCircle,
        chipClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      });
    }
    if (ntfy.data) {
      const h = parseNotifyHealth({
        enabled: ntfy.data.enabled,
        configured: ntfy.data.configured,
        lastResult: ntfy.data.lastResult,
        nowMs,
      });
      const { state, chipText } = channelState(h);
      out.push({
        key: "ntfy",
        title: "Push via ntfy",
        state,
        chipText,
        desc:
          h.verdict === "live"
            ? `Push live on ${ntfy.data.topicMasked ?? "your topic"} — last message ${h.atLabel ?? "delivered"}`
            : h.verdict === "unconfigured"
              ? "Free push alerts — no phone number or apikey needed"
              : h.atLabel
                ? `${h.detail} (${h.atLabel})`
                : h.detail,
        target: "notify",
        icon: Radio,
        chipClass: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
      });
    }
    if (cal.data) {
      const done = !!cal.data.token;
      out.push({
        key: "cal",
        title: "Calendar subscription",
        state: done ? "done" : "todo",
        chipText: done ? "Done" : "To do",
        desc: done
          ? "Your phone's calendar updates itself — classes and deadlines, auto-refreshing"
          : "Classes and deadlines appear in your phone's calendar, auto-updating",
        target: "backup",
        icon: CalendarClock,
        chipClass: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
      });
    }
    /* Optional refinement — done when EITHER channel has a fixed daily time. */
    const digestTime = wa.data?.digestTime ?? ntfy.data?.digestTime ?? null;
    if (wa.data || ntfy.data) {
      out.push({
        key: "digest",
        title: "Daily digest time",
        state: digestTime ? "done" : "todo",
        chipText: digestTime ? "Done" : "To do",
        optional: true,
        desc: digestTime
          ? `Daily summary arrives at ${digestTime} IST`
          : "Pick one fixed time for the daily pending-work summary",
        target: "notify",
        icon: AlarmClock,
        chipClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      });
    }
    return out;
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [wa.data, ntfy.data, cal.data]);
  const coreDone =
    rows.find((r) => r.key === "wa")?.state === "done" &&
    rows.find((r) => r.key === "ntfy")?.state === "done" &&
    rows.find((r) => r.key === "cal")?.state === "done";
  const digestRow = rows.find((r) => r.key === "digest");
  const doneCount = rows.filter((r) => r.state === "done").length;
  const pct = rows.length > 0 ? Math.round((doneCount / rows.length) * 100) : 0;

  const hide = () => {
    setHidden(true);
    try {
      window.localStorage.setItem(HIDE_KEY, "1");
    } catch {
      /* private mode — this session only */
    }
  };

  if (hidden === null) return null;
  /* Dismissed users see nothing while statuses load (no skeleton flash). */
  if (hidden && (wa.isPending || ntfy.isPending || cal.isPending)) return null;
  if (hidden && coreDone) return null;
  /* A dismissed strip resurfaces the moment a core step is pending again. */

  /* Collapsed "all set" strip — shown once the three core channels are live. */
  if (coreDone) {
    return (
      <div
        role="status"
        className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3"
      >
        <PartyPopper className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        <p className="flex-1 text-xs leading-relaxed text-emerald-800 dark:text-emerald-300 sm:text-sm">
          <b>Setup complete</b> — WhatsApp, push and the calendar feed are all live.
          {digestRow?.state === "todo" && (
            <span className="text-emerald-700/75 dark:text-emerald-400/75">
              {" "}
              A fixed daily digest time is still optional.
            </span>
          )}
        </p>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 text-emerald-700 hover:bg-emerald-500/20 hover:text-emerald-900 dark:text-emerald-300"
          aria-label="Hide the setup strip"
          onClick={hide}
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    );
  }

  if (rows.length === 0) return null; /* every status errored — show nothing rather than guess */

  return (
    <Card className="overflow-hidden rounded-xl border-violet-500/25 bg-gradient-to-br from-violet-500/[0.06] via-transparent to-fuchsia-500/[0.04]">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400">
            <ListChecks className="size-4.5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold tracking-tight sm:text-base">Finish setup</h2>
              <Badge
                variant="outline"
                className="border-violet-500/40 text-[10px] font-semibold text-violet-600 dark:text-violet-400"
              >
                {doneCount} of {rows.length} done
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Two minutes, once — then every channel keeps you posted without opening the app.
            </p>
          </div>
          <BadgeCheck
            className="hidden size-5 shrink-0 text-violet-500/40 sm:block"
            aria-hidden="true"
          />
        </div>

        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-violet-500/15"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Setup progress"
        >
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
            initial={false}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        </div>

        <ul className="mt-3 space-y-2">
          {rows.map((row, i) => (
            <motion.li
              key={row.key}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, delay: 0.04 * i, ease: "easeOut" }}
            >
              <RowButton row={row} onOpenStep={onOpenStep} />
            </motion.li>
          ))}
        </ul>

        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Each row opens the exact place in Settings. Nothing is sent anywhere until you press Test
          yourself.
        </p>
      </CardContent>
    </Card>
  );
}
