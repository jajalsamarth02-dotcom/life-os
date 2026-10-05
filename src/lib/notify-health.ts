/**
 * The canonical notify-channel health module — ONE rulebook that decides how
 * a push channel's DELIVERY health reads, no matter which surface asks.
 *
 * Round 106 origin ("the channel that cried Done"): the student's WhatsApp
 * channel had been failing since its Oct 2 setup ("ERROR: apikey can not be
 * empty or it has an invalid format" — a malformed CallMeBot key), yet the
 * dashboard's setup checklist proudly showed "Done — Live on 91********13"
 * because its done-test only checked configured && enabled, never delivery.
 * Meanwhile the Settings card printed the provider's raw HTML ("<b>empty</b>")
 * and a bare ISO timestamp. One surface lied, the other was unreadable.
 *
 * One rulebook, three consumers:
 *  - parseNotifyHealth  — the verdict matrix (unconfigured → saved-off →
 *                         unverified → live | failing) with a human detail
 *                         line and a compact IST at-label;
 *  - stripProviderHtml  — CallMeBot answers with HTML snippets; display
 *                         surfaces get clean text (the raw string survives
 *                         in title attributes for debugging);
 *  - apikeyShapeHint    — a non-blocking shape hint that steers a malformed
 *                         key back to the pairing flow without ever blocking
 *                         a save (the provider owns the format truth).
 *
 * The age voice is freshnessAgeLabel from sync-freshness (r105) — ONE ladder
 * for every "how long ago" in the app; the IST stamp is istFormat. A verdict
 * is about the CHANNEL's last delivery attempt, deliberately independent of
 * data freshness: a channel can be live while its data is stale and vice
 * versa. Honest surfaces never merge the two truths.
 */
import { istFormat } from "./ist";
import { freshnessAgeLabel } from "./sync-freshness";

export interface NotifyHealthInput {
  enabled: boolean;
  configured: boolean;
  /** Raw stored last result: "<ISO> (auto|manual) → sent|FAILED: <snippet>". */
  lastResult: string | null;
  nowMs: number;
}

export type NotifyHealthVerdict =
  | "live" /** enabled + configured + last attempt delivered */
  | "failing" /** enabled + configured + last attempt FAILED */
  | "unverified" /** enabled + configured, never attempted (or unreadable) */
  | "saved-off" /** configured but deliberately switched off */
  | "unconfigured"; /** nothing saved yet */

export type NotifyHealthTone = "emerald" | "red" | "amber" | "muted";

export interface NotifyHealth {
  verdict: NotifyHealthVerdict;
  /** Compact chip label — "Delivered", "Send failed", "Unverified", … */
  label: string;
  /** One human sentence. Provider HTML stripped; never ends mid-word. */
  detail: string;
  tone: NotifyHealthTone;
  /** "14:10 IST · 13m ago" — null when there is no attempt to speak of. */
  atLabel: string | null;
  /** Which path produced the attempt: the scheduler or the student's hand. */
  trigger: "auto" | "manual" | null;
}

/** CallMeBot answers with HTML ("<b>empty</b>"); ntfy can echo markup too.
 *  Tags become spaces (never glued words), the handful of entities the
 *  providers actually emit are decoded, whitespace collapses. */
export function stripProviderHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** The stored shape composed by sendPendingDigest — ISO stamp, trigger,
 *  outcome, snippet. `[\s\S]*` so multi-line provider bodies survive. */
const RESULT_RE = /^(\S+) \((auto|manual)\) → (sent|FAILED): ([\s\S]*)$/;

function atLabelFor(iso: string, nowMs: number): string | null {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return `${istFormat(t, "HH:mm")} IST · ${freshnessAgeLabel(nowMs, t)}`;
}

export function parseNotifyHealth(input: NotifyHealthInput): NotifyHealth {
  const { enabled, configured, lastResult, nowMs } = input;

  if (!configured) {
    return {
      verdict: "unconfigured",
      label: "Not set up",
      detail: "Add the credentials to start sending.",
      tone: "muted",
      atLabel: null,
      trigger: null,
    };
  }
  if (!enabled) {
    return {
      verdict: "saved-off",
      label: "Saved but off",
      detail: "Credentials saved — sending is switched off.",
      tone: "muted",
      atLabel: null,
      trigger: null,
    };
  }
  if (!lastResult) {
    return {
      verdict: "unverified",
      label: "Unverified",
      detail: "Enabled, but nothing has been sent yet — press Send test to verify the pair.",
      tone: "amber",
      atLabel: null,
      trigger: null,
    };
  }

  const m = RESULT_RE.exec(lastResult);
  if (!m) {
    /* A result exists but its shape is foreign (legacy row, manual edit) —
     * claim neither success nor failure; ask for a fresh attempt. */
    return {
      verdict: "unverified",
      label: "Unverified",
      detail: "The last send result is unreadable — press Send test to verify the pair.",
      tone: "amber",
      atLabel: null,
      trigger: null,
    };
  }

  const [, iso, triggerRaw, outcome, rawReason] = m;
  const trigger: "auto" | "manual" = triggerRaw === "auto" ? "auto" : "manual";
  const atLabel = atLabelFor(iso, nowMs);
  const reason = stripProviderHtml(rawReason);

  if (outcome === "sent") {
    return {
      verdict: "live",
      label: "Delivered",
      detail: `Last ${trigger} message delivered${reason ? ` — ${reason}` : ""}.`,
      tone: "emerald",
      atLabel,
      trigger,
    };
  }
  return {
    verdict: "failing",
    label: "Send failed",
    detail: `Last ${trigger} attempt failed${reason ? ` — ${reason}` : ""}.`,
    tone: "red",
    atLabel,
    trigger,
  };
}

/** Non-blocking shape hint — CallMeBot apikeys are short digit codes (like
 *  123456). Returns guidance text when the typed key looks unusual, null
 *  when it looks normal (or is empty). Never blocks a save: the provider
 *  owns the format truth, this is only a steer toward the pairing flow. */
export function apikeyShapeHint(apikey: string): string | null {
  const k = apikey.trim();
  if (!k) return null;
  if (/^\d{4,12}$/.test(k)) return null;
  return "CallMeBot apikeys are usually short digit codes (like 123456) — if yours keeps failing, send the pairing message from your WhatsApp again and save the fresh key.";
}
