"use client";

/**
 * Today card — an SMS-style pocket brief of where the student stands right now.
 *
 * One compact card on the dashboard that:
 *  - renders the EXACT plain-text message that "Copy text" puts on the clipboard
 *    (WYSIWYG: the bubble is the message),
 *  - folds today's class schedule (batch-pick resolved, IST clock) into the
 *    brief — how many are left, the next/ongoing class, or an honest
 *    "none scheduled" / "all done" — from the same shared timetable cache the
 *    week plan and timetable card use, so every surface agrees on "today",
 *  - keeps the message GSM-7 friendly (ASCII only) so the segment counter is
 *    honest — paste it into any chat app and it travels as a normal SMS-sized text,
 *  - supports printing ONLY this card (portal + body.print-today isolation),
 *    separate from the dashboard's full attendance report.
 *
 * No auto-sending anywhere — the student stays in control of every share.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarClock, Check, CheckCheck, Copy, MessageSquareText, Printer, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AlaUpcomingRow, AttendanceView, SubjectView, TimetableSlotRow } from "./types";
import { istNow, humanizeMins } from "./shared";

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

/** Calendar parts of an instant, rendered in IST. Some ICU builds render
 *  midnight as "24" — folded back to "00" here too (shared.tsx's istNow
 *  already does this for the schedule math; the DISPLAY side must agree,
 *  or the bubble header would print "generated 24:00 IST"). */
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
  const h = Number(get("hour")) % 24;
  return {
    weekday: get("weekday").toUpperCase(),
    day: get("day"),
    month: get("month").toUpperCase(),
    year: get("year"),
    hhmm: `${String(h).padStart(2, "0")}:${get("minute")}`,
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

/** One of TODAY's class slots — batch-pick resolved and already filtered to
 *  the current weekday by the caller (the exact same math as the week plan
 *  and the timetable card, so the surfaces can never disagree). */
export interface TodayClassBrief {
  startMin: number;
  endMin: number;
  subjectCode: string;
}

/** Live snapshot of today's first remaining class; minutes run on the IST
 *  clock — the same clock the bubble header prints. Shared by the CLASSES
 *  SMS line and the card's live chip via one pure code path. */
export interface TodayLiveClass {
  kind: "ongoing" | "upcoming";
  cls: TodayClassBrief;
  /** ongoing: minutes until it ends · upcoming: minutes until it starts. */
  mins: number;
  /** Classes not over yet (the ongoing one included). */
  leftCount: number;
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
  /** Today's attending slots — null/undefined when no timetable data has
   *  synced yet (the CLASSES line is then honestly omitted, never faked). */
  todayClasses?: TodayClassBrief[] | null;
}

/** Minutes-since-midnight → "HH:MM" (24h, zero-padded — GSM-7 friendly). */
function hhmmFromMin(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** The today-card's live class state — ONE pure path for both the CLASSES
 *  SMS line and the card's live chip, so the two can never disagree.
 *  HONEST AT ANY DISTANCE: a class 8 hours out is still "next", never "done"
 *  (the live smoke caught exactly that leak in Round 62 — the 90-min calm
 *  window is the CHIP's business, see todayChipClass). Ongoing wins over
 *  upcoming; null only when nothing is left today (or no data). */
export function todayLiveClass(
  todayClasses: TodayClassBrief[] | null | undefined,
  now: number
): TodayLiveClass | null {
  if (!todayClasses || todayClasses.length === 0) return null;
  /* Round 72: the local hh:mm parse is GONE — this is shared.tsx's istNow,
   * the ONE IST clock every schedule surface already uses. Beyond the dedup
   * it also folds the ICU "24:00" midnight quirk (the old parse read
   * nowMin=1440 at IST midnight, silently flipping "upcoming" to "all done"). */
  const nowMin = istNow(now).min;
  const left = todayClasses
    .filter((c) => c.endMin > nowMin)
    .sort((a, b) => a.startMin - b.startMin);
  const first = left[0];
  if (!first) return null;
  if (nowMin >= first.startMin) {
    return { kind: "ongoing", cls: first, mins: first.endMin - nowMin, leftCount: left.length };
  }
  return { kind: "upcoming", cls: first, mins: first.startMin - nowMin, leftCount: left.length };
}

/** Chip variant of the state: an upcoming class more than 90 minutes out
 *  keeps the card calm (null). Ongoing classes always show. The SMS line
 *  deliberately does NOT use this — the bubble must stay honest at any
 *  distance ("next 18:00" at 07:00 is true; "done" would be a lie). */
export function todayChipClass(
  todayClasses: TodayClassBrief[] | null | undefined,
  now: number
): TodayLiveClass | null {
  const st = todayLiveClass(todayClasses, now);
  if (st && st.kind === "upcoming" && st.mins > 90) return null;
  return st;
}

/** How LOUD the chip should be — the urgency ladder both class chips share
 *  (today-card + header), so the surfaces can never disagree on tone:
 *   - "ongoing":  class happening NOW → EMERALD, live pulse (r82: was amber
 *                 — amber now means "a transition is approaching", the same
 *                 language the banner/rows/week-chips speak since r78);
 *   - "wrapping": ongoing with ≤ JUST_ENDED_WINDOW_MIN left → amber, slow
 *                 ping (the end is near — symmetric with imminent);
 *   - "imminent": starts in ≤ IMMINENT_MIN → amber, FAST ping (get moving);
 *   - "soon":     inside the 90-min calm window → emerald, calm;
 *   - null:       nothing to say (no class / too far out). */
export type ChipUrgency = "ongoing" | "wrapping" | "imminent" | "soon";

export const IMMINENT_MIN = 10;

/** The end-of-class mirror of IMMINENT_MIN (r78 "wrapping up"): the last
 *  JUST_ENDED_WINDOW_MIN minutes of an ongoing class flip amber across ALL
 *  schedule surfaces. Home moved here in r82 so the chip-urgency ladder can
 *  consume it without a today-card → timetable-card import (which would
 *  cycle — timetable-card imports IMMINENT_MIN from here). One constant,
 *  re-exported by timetable-card for its row/chip/bar consumers. */
export const JUST_ENDED_WINDOW_MIN = 15;

export function chipUrgency(st: TodayLiveClass | null): ChipUrgency | null {
  if (!st) return null;
  if (st.kind === "ongoing") {
    /* r82: the last sync-cadence window of the class is a TRANSITION — the
       chips now flip amber for it exactly like the banner (r78), row (r79)
       and week-grid chip (r80) already do. One threshold, imported from
       this module by every surface. */
    return st.mins <= JUST_ENDED_WINDOW_MIN ? "wrapping" : "ongoing";
  }
  return st.mins <= IMMINENT_MIN ? "imminent" : "soon";
}

/** The post-class bridge, chip edition (r83): when todayLiveClass has run
 *  dry — no ongoing, nothing upcoming — but the LAST class ended within
 *  JUST_ENDED_WINDOW_MIN, the day isn't "done" yet: the auto-sync hasn't
 *  recorded the class. Returns the just-ended class + minutes since its
 *  end, or null (a live state still speaks / bridge closed / no data).
 *  The today-card chip thereby keeps speaking the five-state language
 *  until the sync takes over, instead of vanishing the instant the class
 *  ends — the same honest gap the timetable rows and week-grid chips have
 *  bridged since r75/r76. r84: also returns drainPct — the same depleting
 *  amber math as the timetable's justEndedDrainPct (r81), computed inline
 *  over the SAME pinned constant (today-card cannot import timetable-card
 *  without cycling; the test suite pins the two against each other), so
 *  the chip's bridge visibly burns down while the sync is pending. Pure —
 *  pinned in tests. */
export function justEndedChip(
  todayClasses: TodayClassBrief[] | null | undefined,
  now: number
): { cls: TodayClassBrief; sinceMin: number; drainPct: number } | null {
  if (!todayClasses || todayClasses.length === 0) return null;
  /* Precedence: an ongoing/upcoming state is the day's voice — the chip
     must not say "just ended" while a later class still speaks. */
  if (todayLiveClass(todayClasses, now)) return null;
  const nowMin = istNow(now).min;
  const lastEnd = Math.max(...todayClasses.map((c) => c.endMin));
  const sinceMin = nowMin - lastEnd;
  if (sinceMin < 0 || sinceMin > JUST_ENDED_WINDOW_MIN) return null;
  const cls = todayClasses.find((c) => c.endMin === lastEnd) as TodayClassBrief;
  /* 100 at the end minute → 0 at the window boundary (inclusive). */
  const drainPct = ((JUST_ENDED_WINDOW_MIN - sinceMin) / JUST_ENDED_WINDOW_MIN) * 100;
  return { cls, sinceMin, drainPct };
}

/** The week-ahead "next up" pure (r87 → r90): once today is fully done
 *  — every caller guards this first (header chip: !shown && !justEnded;
 *  deadline strip: allDone) — the day arc should still answer "when IS the
 *  next one?". Strictly LATER THIS WEEK: days-ahead = (day − today + 7)
 *  % 7 ≥ 1; the +7 wrap is what keeps a Saturday honest about Monday (a
 *  naive day > today comparison breaks at the week boundary). Earliest day
 *  wins, then earliest start. Today is deliberately excluded (d ≥ 1): the
 *  muted family's promise is "later this week", and the callers' guards
 *  already mean today has nothing left to say. r90: promoted from the
 *  header's inline 3-liner (live-verified r87) so the header chip and the
 *  strip's done state share ONE math and can never drift. Pure — pinned
 *  in tests (r90). */
export function nextUpcomingThisWeek(
  slots: TimetableSlotRow[] | null | undefined,
  now: number
): TimetableSlotRow | null {
  if (!slots || slots.length === 0) return null;
  const { day: today } = istNow(now);
  return (
    slots
      .map((s) => ({ s, d: (s.dayOfWeek - today + 7) % 7 }))
      .filter((x) => x.d >= 1)
      .sort((a, b) => a.d - b.d || a.s.startMin - b.s.startMin)[0]?.s ?? null
  );
}

/** Cyclic days-ahead for one weekday vs the IST clock (r91): 0 = today,
 *  1 = tomorrow … 6 = the day before today next week. The SAME +7 wrap the
 *  week-ahead selection uses — exported so the header chip and the strip's
 *  done line qualify their "Mon 11:00" with ONE distance math instead of
 *  two drifting re-derivations. Pure — pinned in tests (r91). */
export function daysAheadThisWeek(dayOfWeek: number, now: number): number {
  return (dayOfWeek - istNow(now).day + 7) % 7;
}

/** Display twin of daysAheadThisWeek (r91): 0 reads "today", 1 reads
 *  "tomorrow" (the friendly, still-honest case), every other gap reads
 *  "in Nd" — the humanizeMins dialect ("in 4h") one unit up. Pure —
 *  pinned in tests (r91). */
export function daysAheadLabel(d: number): string {
  return d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d}d`;
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

  /* Today's schedule — a time-sensitive fact, so it sits right after the
     attendance block and before the worst-subjects roll-up. Honest absence
     when no timetable has synced; "none scheduled" for a genuinely free day. */
  if (input.todayClasses) {
    const tc = input.todayClasses;
    if (tc.length === 0) {
      lines.push("CLASSES TODAY none scheduled");
    } else {
      const live = todayLiveClass(tc, input.now);
      if (!live) {
        lines.push(
          tc.length === 1 ? "CLASSES TODAY done (1 class)" : `CLASSES TODAY all ${tc.length} done`
        );
      } else if (live.kind === "ongoing") {
        lines.push(
          `CLASSES TODAY ${live.leftCount} left - in class ${live.cls.subjectCode} until ${hhmmFromMin(live.cls.endMin)}`
        );
      } else {
        lines.push(
          `CLASSES TODAY ${live.leftCount} left - next ${hhmmFromMin(live.cls.startMin)} ${live.cls.subjectCode}`
        );
      }
    }
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
/* Bubble render helpers (styled render of the SAME text)              */
/* ------------------------------------------------------------------ */

/** Keywords that open the brief's lines — highlighted in the bubble's
 *  RENDER only. The clipboard/print text stays byte-identical: these are
 *  spans around the exact same characters, nothing added, nothing moved.
 *  Exported so the tone picker's test can walk the FULL table. */
export const SMS_KEYWORDS = [
  "CLASSES TODAY", // longest first — before any shorter prefix could match
  "OVERALL",
  "NEED",
  "CAN SKIP",
  "ON TARGET",
  "BUDGET",
  "WORST",
  "ALAS",
  "NEXT",
  "NOTES",
  "SYNCED",
];

/** Split one brief line into { keyword, rest } for the bubble's styled
 *  render — null when the line opens with no known keyword (the header,
 *  "ERP SYNC - ...", stays plain). Exact character content is preserved
 *  either way; rest always begins with the original whitespace. */
export function smsLineParts(line: string): { keyword: string; rest: string } | null {
  for (const k of SMS_KEYWORDS) {
    if (line === k) return { keyword: k, rest: "" };
    if (line.startsWith(k + " ")) return { keyword: k, rest: line.slice(k.length) };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

/** Bubble keyword tones — the styled render color-codes line-openers by
 *  their ROLE in the brief (clipboard text is untouched; these are paint
 *  classes on the exact same characters):
 *   - "WORST" → amber: the app's warning/danger language (status chips, ALA
 *     overdue) — the weakest subjects must read as a caution, not a win;
 *   - "NEXT" → violet: the app's focus language (retry-story spotlight,
 *     subject drawer) — the one actionable deadline deserves the eye;
 *   - everything else → emerald: the card's own identity color.
 *  Unknown keywords (future lines added without a tone decision) fall back
 *  to emerald — a new line must never render unpainted or crash. */
export type SmsKeywordTone = "emerald" | "amber" | "violet";

export function smsKeywordTone(keyword: string): SmsKeywordTone {
  if (keyword === "WORST") return "amber";
  if (keyword === "NEXT") return "violet";
  return "emerald";
}

/** Classes for each tone — kept beside the picker so the bubble render
 *  stays a lookup, never an inline ternary chain that can drift. */
export const SMS_TONE_CLASS: Record<SmsKeywordTone, string> = {
  emerald: "text-emerald-700 dark:text-emerald-400",
  amber: "text-amber-700 dark:text-amber-400",
  violet: "text-violet-700 dark:text-violet-400",
};

/* Short weekday labels for the week-ahead pill (r93) — the same strings the
   header chip (r87 local DAYS) and the deadline strip (r90 DAY_NAMES) print.
   A future consolidation into shared.tsx can retire the three copies; the
   VALUES are stable constants, the pinned MATH is what must stay single. */
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Legacy clipboard fallback for insecure contexts (plain-HTTP views, older
 *  WebViews where navigator.clipboard is undefined or rejects): an off-screen
 *  textarea + execCommand("copy"). execCommand is deprecated but STILL the
 *  only clipboard write path those contexts have — the honest ladder is
 *  async-clipboard first, this second, a visible failure state last.
 *  Selection is restored so an accidental user selection is never clobbered.
 *  Guarded for non-DOM environments (bun tests import this module). */
export function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.left = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    const sel = document.getSelection();
    const prev = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    if (prev && sel) {
      sel.removeAllRanges();
      sel.addRange(prev);
    }
    return ok;
  } catch {
    return false;
  }
}

export function TodayCard(props: TodaySmsInput & { className?: string; /** r93: the full-week attending list — feeds the week-ahead pill (FIFTH surface of the "next up this week" family); null/undefined = no timetable synced → the pill stays honestly absent. */ weekSlots?: TimetableSlotRow[] | null }) {
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
    todayClasses,
    weekSlots,
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
        todayClasses,
      }),
    [now, overall, target, subjects, warningSubjects, alaPending, alaTotal, alaOverdue, alaDueWeek, nextDue, notedCount, lastSyncAt, todayClasses]
  );
  const seg = useMemo(() => smsSegments(smsText), [smsText]);
  const header = istParts(now);
  /* Line-split once for the styled bubble render (same characters — the
     clipboard keeps the plain string; only the paint is highlighted). */
  const smsLines = useMemo(() => smsText.split("\n"), [smsText]);

  /* Live class chip — same pure core as the CLASSES SMS line, plus the
     90-min calm window (an 18:00 class at 07:00 must not shout) and the
     ≤10-min IMMINENT escalation (amber + fast pulse — get moving). */
  const liveClass = useMemo(() => todayChipClass(todayClasses, now), [todayClasses, now]);
  const urgency = chipUrgency(liveClass);
  /* r83: the post-class bridge — while the auto-sync hasn't recorded the
     last class, the chip keeps speaking (amber, elapsed clock) instead of
     vanishing; the deep-link lands on the timetable row's drain bar. */
  const justEnded = useMemo(() => justEndedChip(todayClasses, now), [todayClasses, now]);
  /* r93: after the bridge closes, the today-card's chip no longer goes dark
     while the header chip, strip and grid all speak — the FIFTH surface of
     the week-ahead family, the SAME pinned pures (selection + distance),
     muted by the r87 ladder (information, not an alarm). Precedence: the
     live state first, the bridge second, the week ahead last — one voice
     at a time. */
  const weekNextInfo = useMemo(() => {
    const w = nextUpcomingThisWeek(weekSlots ?? null, now);
    return w
      ? { slot: w, label: daysAheadLabel(daysAheadThisWeek(w.dayOfWeek, now)) }
      : null;
  }, [weekSlots, now]);

  /* Chip click → deep-link to the timetable card. Event-based (same pattern
     as the palette's erp:copy-summary commands): TodayCard stays prop-light
     and headless QA can drive the jump without clicking the chip. */
  const focusTimetable = () => {
    try {
      window.dispatchEvent(new CustomEvent("erp:focus-timetable"));
    } catch {
      /* exotic env without CustomEvent — the chip stays a calm status pill */
    }
  };

  /* --- copy ---------------------------------------------------------- */
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyText = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(smsText);
      ok = true;
    } catch {
      /* Round 72: insecure context (plain HTTP / older WebView) or permission
       * denied — instead of staying INERT, try the legacy path once before
       * admitting defeat. The student taps "Copy text" on a phone; a silent
       * no-op reads as a broken app. */
      ok = legacyCopy(smsText);
    }
    setCopied(ok);
    setCopyFailed(!ok);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => {
      setCopied(false);
      setCopyFailed(false);
    }, 2000);
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
            ) : copyFailed ? (
              <Copy className="size-3.5 text-amber-500" aria-hidden="true" />
            ) : (
              <Copy className="size-3.5" aria-hidden="true" />
            )}
            {copied ? "Copied" : copyFailed ? "Copy failed — select the bubble text instead" : "Copy text"}
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
          {liveClass && urgency && (
            <button
              type="button"
              onClick={focusTimetable}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium tabular-nums transition-all hover:brightness-105 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 active:scale-[0.98] print:hidden",
                urgency === "soon" || urgency === "ongoing"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              )}
              aria-label={
                urgency === "ongoing"
                  ? "Ongoing class — jump to today's schedule in the timetable"
                  : urgency === "wrapping"
                    ? "Class wrapping up — jump to today's schedule in the timetable"
                    : urgency === "imminent"
                      ? "Class starting imminently — jump to today's schedule in the timetable"
                      : "Next class — jump to today's schedule in the timetable"
              }
              title={
                urgency === "ongoing"
                  ? "One of today's classes is happening right now — click to jump to the schedule"
                  : urgency === "wrapping"
                    ? "This class ends within minutes — click to jump to the schedule"
                    : urgency === "imminent"
                      ? "This class starts within minutes — click to jump to the schedule"
                      : "Today's next class starts within 90 minutes — click to jump to the schedule"
              }
            >
              <span className="relative flex size-1.5" aria-hidden="true">
                <span
                  className={cn(
                    "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:hidden",
                    urgency === "soon" || urgency === "ongoing" ? "bg-emerald-500" : "bg-amber-500"
                  )}
                  style={{ animationDuration: urgency === "imminent" ? "1.1s" : "2.2s" }}
                />
                <span
                  className={cn(
                    "relative inline-flex size-1.5 rounded-full",
                    urgency === "soon" || urgency === "ongoing" ? "bg-emerald-500" : "bg-amber-500"
                  )}
                />
              </span>
              {urgency === "ongoing"
                ? `In class ${liveClass.cls.subjectCode} · ends ${hhmmFromMin(liveClass.cls.endMin)}`
                : urgency === "wrapping"
                  ? `Wrapping up ${liveClass.cls.subjectCode} · ends ${hhmmFromMin(liveClass.cls.endMin)}`
                  : urgency === "imminent"
                    ? `${liveClass.cls.subjectCode} starts in ${humanizeMins(liveClass.mins)}`
                    : `Next ${liveClass.cls.subjectCode} ${hhmmFromMin(liveClass.cls.startMin)} · in ${humanizeMins(liveClass.mins)}`}
            </button>
          )}
          {!liveClass && justEnded && (
            <button
              type="button"
              onClick={focusTimetable}
              className="relative inline-flex cursor-pointer items-center gap-1.5 overflow-hidden rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium tabular-nums text-amber-700 transition-all hover:brightness-105 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 active:scale-[0.98] print:hidden dark:text-amber-300"
              aria-label="Class just ended — jump to today's schedule in the timetable"
              title="The class finished — the next auto-sync (within 15 minutes) records it. Click to jump to the schedule."
            >
              <span className="relative flex size-1.5" aria-hidden="true">
                <span
                  className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-60 motion-reduce:hidden"
                  style={{ animationDuration: "2.2s" }}
                />
                <span className="relative inline-flex size-1.5 rounded-full bg-amber-500" />
              </span>
              Just ended {justEnded.cls.subjectCode} · {humanizeMins(justEnded.sinceMin)} ago
              {/* r84: the bridge drains visibly — the r81 depleting amber
                  bar, chip edition (aria-hidden decorative; the honest
                  anchor stays the tooltip's worst-case window). */}
              <span
                aria-hidden="true"
                className="absolute inset-x-1.5 bottom-0 h-0.5 overflow-hidden rounded-full bg-amber-500/15"
              >
                <span
                  className="block h-full rounded-full bg-gradient-to-r from-amber-500/50 to-amber-500 transition-[width] duration-1000 ease-linear"
                  style={{ width: `${justEnded.drainPct}%` }}
                />
              </span>
            </button>
          )}
          {!liveClass && !justEnded && weekNextInfo && (
            /* r93: the week-ahead pill — the today-card's chip keeps answering
               "when IS the next one?" after the bridge closes, in the muted
               r87 ladder tone. Same deep-link (erp:focus-timetable) as the
               live/bridge chips; visually the QUIETEST member of the family. */
            <button
              type="button"
              onClick={focusTimetable}
              className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-border/70 bg-muted/50 px-2.5 py-1 text-[11px] font-medium tabular-nums text-muted-foreground transition-all hover:brightness-105 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 active:scale-[0.98] print:hidden"
              aria-label={`Next class this week — ${weekNextInfo.slot.subjectCode} ${DAY_SHORT[weekNextInfo.slot.dayOfWeek]} ${hhmmFromMin(weekNextInfo.slot.startMin)} (${weekNextInfo.label})`}
              title="Today's classes are done — the next one later this week. Click to jump to the schedule."
            >
              <CalendarClock className="size-3 shrink-0" aria-hidden="true" />
              <span className="font-mono text-[10px] font-semibold">{weekNextInfo.slot.subjectCode}</span>
              <span className="tabular-nums">
                {DAY_SHORT[weekNextInfo.slot.dayOfWeek]} {hhmmFromMin(weekNextInfo.slot.startMin)}
              </span>
              <span className="tabular-nums text-muted-foreground/70" aria-hidden="true">
                · {weekNextInfo.label}
              </span>
            </button>
          )}
          <span
            className={cn(
              "ml-auto hidden text-[10px] tabular-nums sm:inline",
              seg.segments > 1 ? "text-amber-600/80 dark:text-amber-400/80" : "text-muted-foreground/70"
            )}
            aria-hidden="true"
            title={
              seg.encoding === "GSM-7"
                ? "GSM-7 plain text: 1 segment carries up to 160 chars; longer texts travel as 153-char concatenated segments"
                : "Contains non-Latin characters — encoded UCS-2, so 1 segment carries only 70 chars"
            }
          >
            {seg.encoding === "GSM-7" ? "SMS-ready" : "unicode"} · {seg.segments} segment{seg.segments === 1 ? "" : "s"} · {seg.chars} chars
          </span>
        </div>

        {/* the message bubble — WYSIWYG with the clipboard text */}
        <div
          className="relative rounded-2xl rounded-br-md border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-transparent px-4 py-3.5 shadow-sm"
          role="figure"
          aria-label="Today's summary written as a plain-text message"
        >
          {/* SMS bubble tail — the chat-app cue that this box IS the message
              (pure paint: rotated square sharing the bubble's border/bg). */}
          <span
            aria-hidden="true"
            className="absolute -bottom-[9px] right-6 size-4 rotate-45 rounded-br-[3px] border-b border-r border-emerald-500/20 bg-emerald-500/10"
          />
          <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-foreground/90 sm:text-[12.5px]">
            {smsLines.map((ln, i) => {
              const parts = smsLineParts(ln);
              return (
                <span key={i}>
                  {parts ? (
                    <>
                      <span className={cn("font-semibold", SMS_TONE_CLASS[smsKeywordTone(parts.keyword)])}>
                        {parts.keyword}
                      </span>
                      {parts.rest}
                    </>
                  ) : (
                    ln
                  )}
                  {i < smsLines.length - 1 ? "\n" : ""}
                </span>
              );
            })}
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
