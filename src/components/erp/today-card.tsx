"use client";

/**
 * Today card — an SMS-style pocket brief of where the student stands right now.
 *
 * One compact card on the dashboard that:
 *  - renders the EXACT plain-text message that "Copy text" puts on the clipboard
 *    (WYSIWYG: the bubble is the message),
 *  - keeps the message GSM-7 friendly (ASCII only) so the segment counter is
 *    honest — paste it into any chat app and it travels as a normal SMS-sized text,
 *  - supports printing ONLY this card (portal + body.print-today isolation),
 *    separate from the dashboard's full attendance report.
 *
 * No auto-sending anywhere — the student stays in control of every share.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, CheckCheck, Copy, MessageSquareText, Printer, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AlaUpcomingRow, AttendanceView, SubjectView } from "./types";

/* ------------------------------------------------------------------ */
/* SMS segment math (GSM-7 vs UCS-2, concat rules)                     */
/* ------------------------------------------------------------------ */

/** GSM 03.38 basic character set (single chars). */
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
/** GSM 03.38 extension table (each costs 2 chars). */
const GSM7_EXT = "^{}\\[~]|€";

export function smsSegments(text: string): {
  segments: number;
  chars: number;
  encoding: "GSM-7" | "UCS-2";
} {
  let effective = 0;
  let nonGsm = 0;
  const chars = [...text].length;
  for (const ch of text) {
    if (GSM7_BASIC.includes(ch)) effective += 1;
    else if (GSM7_EXT.includes(ch)) effective += 2;
    else nonGsm += 1;
  }
  if (nonGsm === 0) {
    return { segments: effective <= 160 ? 1 : Math.ceil(effective / 153), chars, encoding: "GSM-7" };
  }
  return { segments: chars <= 70 ? 1 : Math.ceil(chars / 67), chars, encoding: "UCS-2" };
}

/* ------------------------------------------------------------------ */
/* Message builder — ASCII-only output                                 */
/* ------------------------------------------------------------------ */

const IST_TZ = "Asia/Kolkata";

/** Calendar parts of an instant, rendered in IST. */
function istParts(now: number) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TZ,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(now));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return {
    weekday: get("weekday").toUpperCase(),
    day: get("day"),
    month: get("month").toUpperCase(),
    year: get("year"),
    hhmm: `${get("hour")}:${get("minute")}`,
  };
}

/** Force dynamic strings into the SMS-safe ASCII plane (typographic chars out). */
function ascii(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00b7/g, "|")
    .replace(/[^\x20-\x7e\n]/g, "");
}

export interface TodaySmsInput {
  now: number;
  overall: AttendanceView;
  target: number;
  subjects: SubjectView[];
  warningSubjects: number;
  alaPending: number;
  alaTotal: number;
  alaOverdue: number;
  alaDueWeek: number;
  nextDue: AlaUpcomingRow | null;
  notedCount: number;
  lastSyncAt: string | null;
}

/** Build the exact SMS text shown in the bubble (and used for copy/share). */
export function buildTodaySms(input: TodaySmsInput): string {
  const p = istParts(input.now);
  const lines: string[] = [];

  lines.push(`ERP SYNC - ${p.weekday} ${p.day} ${p.month} ${p.year}`);

  const o = input.overall;
  if (o.total === 0) {
    lines.push("OVERALL no classes recorded yet");
  } else {
    lines.push(
      `OVERALL ${o.present}/${o.total} (${o.percentage.toFixed(2)}%) vs ${input.target}% target - ${o.status.toUpperCase()}`
    );
    if (o.classesToTarget > 0) {
      lines.push(
        `NEED ${o.classesToTarget} more attended class${o.classesToTarget === 1 ? "" : "es"} to reach ${input.target}%`
      );
    } else if (o.canSkip > 0) {
      lines.push(`CAN SKIP ${o.canSkip} class${o.canSkip === 1 ? "" : "es"} and stay above ${input.target}%`);
    } else {
      lines.push("ON TARGET - keep it up");
    }
    const budget = input.subjects.reduce((n, s) => n + (s.total > 0 ? s.canSkip : 0), 0);
    lines.push(
      budget > 0
        ? `BUDGET ${budget} safe skip${budget === 1 ? "" : "s"} across subjects`
        : "BUDGET 0 - attend everything"
    );
  }

  const worst = input.subjects
    .filter((s) => s.total > 0 && (s.status === "danger" || s.status === "warning"))
    .sort((a, b) => a.percentage - b.percentage)
    .slice(0, 2);
  if (worst.length > 0) {
    lines.push(
      `WORST ${worst
        .map((s) => `${s.code} ${s.percentage.toFixed(1)}% (${s.present}/${s.total})`)
        .join(", ")}`
    );
  }

  if (input.alaTotal > 0) {
    let ala = `ALAS ${input.alaPending} pending / ${input.alaTotal} tracked`;
    const bits: string[] = [];
    if (input.alaOverdue > 0) bits.push(`${input.alaOverdue} overdue`);
    if (input.alaDueWeek > 0) bits.push(`${input.alaDueWeek} due in 7 days`);
    if (bits.length > 0) ala += ` (${bits.join(", ")})`;
    lines.push(ala);
  }

  if (input.nextDue) {
    const d = istParts(new Date(input.nextDue.dueAt).getTime());
    const title = ascii(input.nextDue.title);
    const clipped = title.length > 28 ? `${title.slice(0, 27)}...` : title;
    lines.push(
      `NEXT ${clipped} (${input.nextDue.subjectCode ?? "?"}) due ${d.weekday} ${d.day} ${d.month}`
    );
  }

  if (input.notedCount > 0) {
    lines.push(`NOTES ${input.notedCount} private note${input.notedCount === 1 ? "" : "s"} on this device`);
  }

  const synced = input.lastSyncAt ? istParts(new Date(input.lastSyncAt).getTime()).hhmm : null;
  lines.push(`SYNCED ${synced ?? "not yet"} IST - erp.gmiu.edu.in`);

  return ascii(lines.join("\n"));
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function TodayCard(props: TodaySmsInput & { className?: string }) {
  const {
    now,
    overall,
    target,
    subjects,
    warningSubjects,
    alaPending,
    alaTotal,
    alaOverdue,
    alaDueWeek,
    nextDue,
    notedCount,
    lastSyncAt,
    className,
  } = props;

  const smsText = useMemo(
    () =>
      buildTodaySms({
        now,
        overall,
        target,
        subjects,
        warningSubjects,
        alaPending,
        alaTotal,
        alaOverdue,
        alaDueWeek,
        nextDue,
        notedCount,
        lastSyncAt,
      }),
    [now, overall, target, subjects, warningSubjects, alaPending, alaTotal, alaOverdue, alaDueWeek, nextDue, notedCount, lastSyncAt]
  );
  const seg = useMemo(() => smsSegments(smsText), [smsText]);
  const header = istParts(now);

  /* --- copy ---------------------------------------------------------- */
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(smsText);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable (insecure context / permission denied) — stay inert */
    }
  };

  /* --- native share (mobile) ----------------------------------------- */
  const [canShare, setCanShare] = useState(false);
  const [shared, setShared] = useState(false);
  const shareTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);
  const shareText = async () => {
    try {
      await navigator.share({ title: "ERP Sync - today card", text: smsText });
      setShared(true);
      if (shareTimer.current) clearTimeout(shareTimer.current);
      shareTimer.current = setTimeout(() => setShared(false), 2000);
    } catch {
      /* user dismissed the sheet / share unavailable — stay inert */
    }
  };

  /* --- print ONLY this card ------------------------------------------ */
  /* Arming mounts the portal clone and tags <body> with .print-today;
     the print stylesheet then hides every other direct body child.
     'afterprint' (or a safety timeout) always disarms. */
  const [printArmed, setPrintArmed] = useState(false);
  useEffect(() => {
    if (!printArmed) return;
    const done = () => setPrintArmed(false);
    const raf = requestAnimationFrame(() => window.print());
    window.addEventListener("afterprint", done);
    const safety = setTimeout(done, 60_000);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("afterprint", done);
      clearTimeout(safety);
    };
  }, [printArmed]);
  useEffect(() => {
    if (!printArmed) return;
    document.body.classList.add("print-today");
    return () => document.body.classList.remove("print-today");
  }, [printArmed]);

  const chipBtn =
    "h-7 gap-1 rounded-full border border-border/40 bg-background/40 px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground";

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          >
            <MessageSquareText className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base tracking-tight">Today card</CardTitle>
            <CardDescription className="text-xs">
              A pocket brief of where you stand — like a text message. Copy it into any chat, or print just this card.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* actions */}
        <div className="flex flex-wrap items-center gap-1.5 print:hidden">
          <Button variant="ghost" size="sm" className={chipBtn} onClick={copyText} disabled={!smsText}
            aria-label="Copy today's summary as plain text" title="Copy the exact text shown below">
            {copied ? (
              <Check className="size-3.5 text-emerald-500" aria-hidden="true" />
            ) : (
              <Copy className="size-3.5" aria-hidden="true" />
            )}
            {copied ? "Copied" : "Copy text"}
          </Button>
          {canShare && (
            <Button variant="ghost" size="sm" className={chipBtn} onClick={shareText} disabled={!smsText}
              aria-label="Share today's summary via your device" title="Open your device's share sheet with this text">
              <Share2 className="size-3.5" aria-hidden="true" />
              {shared ? "Shared" : "Share"}
            </Button>
          )}
          <Button variant="ghost" size="sm" className={chipBtn} onClick={() => setPrintArmed(true)} disabled={!smsText}
            aria-label="Print only the today card" title="Print or save just this card as PDF — the rest of the app is hidden on paper">
            <Printer className="size-3.5" aria-hidden="true" />
            Print card
          </Button>
          <span className="ml-auto hidden text-[10px] tabular-nums text-muted-foreground/70 sm:inline" aria-hidden="true">
            {seg.encoding === "GSM-7" ? "SMS-ready" : "unicode"} · {seg.segments} segment{seg.segments === 1 ? "" : "s"} · {seg.chars} chars
          </span>
        </div>

        {/* the message bubble — WYSIWYG with the clipboard text */}
        <div
          className="relative rounded-2xl rounded-br-md border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-transparent px-4 py-3.5 shadow-sm"
          role="figure"
          aria-label="Today's summary written as a plain-text message"
        >
          <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-foreground/90 sm:text-[12.5px]">
            {smsText}
          </pre>
        </div>

        {/* delivered caption */}
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/80" aria-hidden="true">
          <CheckCheck className="size-3 text-emerald-500/80" />
          <span>generated {header.hhmm} IST · updates every minute · never sent anywhere automatically</span>
        </div>
      </CardContent>

      {/* print-only clone: mounted via portal while printing is armed */}
      {printArmed &&
        typeof document !== "undefined" &&
        createPortal(
          <div id="today-card-print" className="hidden" aria-hidden="true">
            <div className="mx-auto max-w-[620px] bg-white p-8 text-black">
              <div className="mb-3 flex items-end justify-between border-b-2 border-black/80 pb-2">
                <div>
                  <p className="text-base font-bold tracking-tight">Today card</p>
                  <p className="text-xs text-black/70">Gyanmanjari Innovative University · erp.gmiu.edu.in</p>
                </div>
                <p className="text-xs tabular-nums text-black/70">
                  {header.weekday} {header.day} {header.month} {header.year} · {header.hhmm} IST
                </p>
              </div>
              <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-black">
                {smsText}
              </pre>
              <p className="mt-3 text-[10px] text-black/60">
                Pocket brief generated by ERP Sync — the same text is available via &quot;Copy text&quot; on the dashboard.
              </p>
            </div>
          </div>,
          document.body
        )}
    </Card>
  );
}
