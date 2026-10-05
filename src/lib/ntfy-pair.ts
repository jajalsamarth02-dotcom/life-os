/**
 * ntfy push setup rulebook — the guided setup's brain (r111).
 *
 * ntfy is the free, credential-less push channel: the student subscribes
 * their ntfy app to a PRIVATE TOPIC, the app saves that topic, and every
 * digest/alert lands as a push. There is no pairing conversation (unlike
 * CallMeBot), but there IS one security-critical artifact — the topic name
 * is a capability: ANYONE who knows it can read the alerts and push to the
 * student's device. This module turns the setup into copy-pasteable
 * artifacts and pins the topic-quality bar in ONE place:
 *
 *   generateNtfyTopic      — an unguessable topic from any random source
 *   randomNtfyTopic        — the browser wrapper (crypto-quality, then dice)
 *   isValidNtfyTopic       — ntfy's own topic charset rules
 *   ntfyTopicHint          — the human reason a topic was rejected
 *   normalizeNtfyServerHost— "https://ntfy.example.com/" → "ntfy.example.com"
 *   buildNtfyAppDeepLink   — ntfy://<host>/<topic> (Android auto-subscribes)
 *   buildNtfyWebLink       — https://<host>/<topic> (web app: iOS/desktop)
 *   ntfySetupFallbackText  — the clipboard fallback for a phone without the app
 *   ntfyCareAction         — which care affordance a health verdict offers (r110 rulebook)
 *
 * Boundaries (deliberate):
 *  - 12 random base36 chars (~62 bits) beats the old 8-char dice (~41.5
 *    bits) — topics are capability URLs and the bar must be unguessable,
 *    not merely long.
 *  - The DEFAULT server (ntfy.sh) is a sensible default, not gospel: a
 *    self-hosted server stays available in both the wizard and the card.
 *  - Pure display/string logic only: no fetches, no db, no sends. The
 *    wizard still asks before saving/testing/enabling (spec: nothing is
 *    sent anywhere until the student presses the button).
 */

import type { NotifyHealth } from "@/lib/notify-health";

/** The public ntfy.sh server — the default, never gospel. */
export const NTFY_DEFAULT_HOST = "ntfy.sh";

/** Every generated topic starts with this so its origin is recognizable. */
export const NTFY_TOPIC_PREFIX = "erp-sync-";

/**
 * Random chars appended to the prefix. 12 base36 chars ≈ 62 bits of
 * entropy — beyond ntfy's own "hard to guess" guidance for public topics.
 */
export const NTFY_TOPIC_RANDOM_LENGTH = 12;

/** ntfy's docs — the source of truth for topics, deep links and apps. */
export const NTFY_DOCS_URL = "https://docs.ntfy.sh/subscribe/phone/";

/** ntfy's own topic charset: letters, digits, underscore, hyphen (1–64). */
export const NTFY_TOPIC_RE = /^[A-Za-z0-9_-]{1,64}$/;

const BASE36 = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Build a topic from a random source — pure, so tests pin the exact
 * output for a stubbed generator. `rand()` must return [0, 1).
 */
export function generateNtfyTopic(rand: () => number): string {
  let suffix = "";
  for (let i = 0; i < NTFY_TOPIC_RANDOM_LENGTH; i++) {
    suffix += BASE36[Math.floor(rand() * BASE36.length) % BASE36.length];
  }
  return `${NTFY_TOPIC_PREFIX}${suffix}`;
}

/**
 * Browser wrapper: crypto-quality randomness when the runtime has it
 * (browsers and Node ≥ 19 both expose crypto.getRandomValues), Math.random
 * fallback otherwise. Not pure — the pure core above is the test-pinned one.
 */
export function randomNtfyTopic(): string {
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } };
  if (typeof g.crypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(NTFY_TOPIC_RANDOM_LENGTH);
    g.crypto.getRandomValues(bytes);
    let suffix = "";
    for (const b of bytes) suffix += BASE36[b % BASE36.length];
    return `${NTFY_TOPIC_PREFIX}${suffix}`;
  }
  return generateNtfyTopic(Math.random);
}

/** ntfy's topic rules in one call. */
export function isValidNtfyTopic(topic: string): boolean {
  return NTFY_TOPIC_RE.test((topic ?? "").trim());
}

/** The human reason a topic was rejected — null when it is fine. */
export function ntfyTopicHint(topic: string): string | null {
  const t = (topic ?? "").trim();
  if (!t) return null; // empty is "not typed yet", not an error — the save gate handles it
  if (t.length > 64) return "Too long — topics can be up to 64 characters.";
  if (!/^[A-Za-z0-9_-]+$/.test(t))
    return "Use only letters, numbers, dashes and underscores — no spaces, dots or slashes.";
  return null;
}

/**
 * Normalize the optional self-hosted server input into a bare host:
 *   ""                    → null           (means "use ntfy.sh")
 *   "https://ntfy.ex.com" → "ntfy.ex.com"
 *   "http://192.168.1.10" → "192.168.1.10" (caller learns scheme separately)
 *   "ntfy.ex.com/"        → "ntfy.ex.com"
 * Junk (no host, foreign scheme, spaces) → null. Returns the SCHEME too so
 * link builders can honor insecure self-hosted servers honestly.
 */
export function normalizeNtfyServer(input: string): { host: string; scheme: "https" | "http" } | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (!host || !host.includes(".") || /\s/.test(host)) return null;
  return { host, scheme: url.protocol === "http:" ? "http" : "https" };
}

/**
 * The Android deep link (ntfy's documented format): opens the app's topic
 * detail view and SUBSCRIBES when not already subscribed. Insecure
 * self-hosted servers append ?secure=false so the app does not refuse.
 * null when the topic is invalid or the server is junk.
 */
export function buildNtfyAppDeepLink(topic: string, server?: string | null): string | null {
  if (!isValidNtfyTopic(topic)) return null;
  /* Empty/absent → the documented default; an EXPLICIT but junk server →
   * null, never a silent ntfy.sh fallback (a wrong link the student taps
   * is worse than no link — same "never invent" rule as the apikey reader). */
  const explicit = server != null && server.trim() !== "";
  const srv = normalizeNtfyServer(server ?? "");
  if (explicit && !srv) return null;
  const host = srv?.host ?? NTFY_DEFAULT_HOST;
  const secure = srv ? srv.scheme === "https" : true;
  const q = secure ? "" : "?secure=false";
  return `ntfy://${host}/${encodeURIComponent(topic)}${q}`;
}

/**
 * The web-app link — works everywhere (iOS has no ntfy:// deep links; the
 * web app subscribes in-browser and the mobile web app can hand off).
 * Honors the server's own scheme for self-hosted instances.
 */
export function buildNtfyWebLink(topic: string, server?: string | null): string | null {
  if (!isValidNtfyTopic(topic)) return null;
  const explicit = server != null && server.trim() !== "";
  const srv = normalizeNtfyServer(server ?? "");
  if (explicit && !srv) return null;
  if (!srv) return `https://${NTFY_DEFAULT_HOST}/${encodeURIComponent(topic)}`;
  return `${srv.scheme}://${srv.host}/${encodeURIComponent(topic)}`;
}

/** Clipboard fallback for a device without the ntfy app installed yet. */
export function ntfySetupFallbackText(topic: string, server?: string | null): string {
  const srv = normalizeNtfyServer(server ?? "");
  const host = srv?.host ?? NTFY_DEFAULT_HOST;
  return (
    `Subscribe to your private topic in the ntfy app:\n\n` +
    `1. Install "ntfy" (Play Store / App Store) or open ${host} in a browser\n` +
    `2. Tap + and subscribe to the topic below\n` +
    `   Server: ${host}\n` +
    `   Topic:  ${topic}\n\n` +
    `Then paste the topic into ERP Sync and send a test. ` +
    `Anyone who knows this topic name can read your alerts — keep it private.`
  );
}

/* ---------- care routing (r110 rulebook, ntfy side) ---------- */

/**
 * What the app should OFFER for the ntfy channel, derived from the ONE
 * health verdict (parseNotifyHealth — the r106 single-verdict rule). The
 * palette's care group and the checklist row consume this instead of
 * re-deciding:
 *
 *   unconfigured → "setup"  — the guided wizard (a free channel, 3 taps)
 *   failing      → "repair" — the SAME wizard (a fresh topic + re-subscribe
 *                             is the guided fix; the old topic may be the problem)
 *   unverified   → "verify" — the Settings card's Send test (no wizard; the
 *                             topic may be fine, only a send can say so)
 *   saved-off    → "none"   — configured but deliberately off; respect it
 *   live         → "none"   — nothing to care for
 *
 * NEVER adds a "send" kind: the palette launches surfaces, it never fires
 * messages (the Settings test button stays the ONE send affordance).
 */
export type NtfyCareAction =
  | { kind: "setup"; label: string; focus: "ntfy-setup" }
  | { kind: "repair"; label: string; focus: "ntfy-setup" }
  | { kind: "verify"; label: string; focus: "notify" }
  | { kind: "none"; label: null; focus: null };

export function ntfyCareAction(verdict: NotifyHealth["verdict"]): NtfyCareAction {
  switch (verdict) {
    case "unconfigured":
      return { kind: "setup", label: "Set up free push alerts — guided", focus: "ntfy-setup" };
    case "failing":
      return { kind: "repair", label: "Repair ntfy push — guided", focus: "ntfy-setup" };
    case "unverified":
      return { kind: "verify", label: "Verify ntfy push — send a test", focus: "notify" };
    case "saved-off":
    case "live":
    default:
      return { kind: "none", label: null, focus: null };
  }
}
