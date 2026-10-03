/**
 * The canonical IST stamp module — ONE place that knows the student's clock.
 *
 * Convention (documented in components/erp/shared.tsx istNow since the early
 * rounds): the student's clock is Asia/Kolkata no matter what timezone the
 * DEVICE or the SERVER runs in — a parent checking from abroad, a UTC-server
 * browser, or the Node sync engine composing a WhatsApp body must all render
 * the same wall-clock time the student in India sees.
 *
 * Round 99 audit found the violation class: instant timestamps (sync times,
 * deadline dues, backup stamps) formatted with browser-local / server-local
 * clocks. Symptom, live-confirmed in a UTC headless browser: the header
 * sr-only line read "Last sync 3 Oct, 10:21 AM" while the DB instant was
 * 15:51 IST. This module is the single fix surface.
 *
 * Two renderers, by consumer:
 *  - istFormat(ms, pattern)  — client display stamps, date-fns patterns
 *                              byte-identical to the pre-r99 browser-local
 *                              shapes ("d MMM, h:mm a" → "3 Oct, 3:51 PM").
 *  - fmtDateIST/fmtDateTimeIST — server message stamps (engine.ts change
 *                              descriptions, notify bodies), en-IN style
 *                              kept from the pre-r99 toLocaleString shapes.
 *
 * NOT in scope (r99 ruling, documented so future sweeps don't re-litigate):
 * charts/calendars that build their grid in the browser-local frame and
 * label it with the same frame's days (history-heatmap caption, trend-chart
 * focusDay, reminders month navigation) — internally consistent, and
 * re-anchoring the grid is a separate, riskier change.
 */
import { format } from "date-fns";
import { tz } from "@date-fns/tz";

/** The student's timezone — the ONLY clock this app stamps with. */
export const IST_TZ = "Asia/Kolkata";

/** IST-pinned date-fns format. Same patterns as before; the timezone is no
 *  longer the device's — a UTC browser and an IST phone render identically.
 *  Bad/missing instants fall back to "—" like the shared formatters. */
export function istFormat(date: Date | number | string, fmt: string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  return format(d, fmt, { in: tz(IST_TZ) });
}

/** Compact date stamp for server-composed messages — "03 Oct 2026". */
export function fmtDateIST(d: Date): string {
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: IST_TZ,
  });
}

/** Clock stamp for server-composed messages — "03 Oct 2026, 03:51 pm".
 *  Feeds deadline change bodies ("moved from X to Y"): without the pinned
 *  zone a UTC server shifted every delivered time by -5:30. */
export function fmtDateTimeIST(d: Date): string {
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: IST_TZ,
  });
}
