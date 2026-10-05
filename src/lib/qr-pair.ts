/**
 * qr-pair — the scan-to-adopt rulebook (r112).
 *
 * Every adoption artifact the wizards hand the student (the CallMeBot
 * activation link, the ntfy topic link, the calendar subscription URL)
 * works ONLY on the device the browser is running on: a wa.me or ntfy://
 * deep link tapped on a desktop does nothing, and a token-protected
 * calendar URL has to be manually carried from the desktop to the phone.
 * The QR is the bridge — the student points their phone's camera at the
 * screen and the exact same link is already on the phone.
 *
 * This module owns the QR PAYLOAD rules in ONE place, because a QR that
 * encodes the wrong thing is worse than no QR:
 *
 *   qrPayloadForCalendar — the live subscription URL, fail-closed
 *   qrPayloadFromLink    — a wizard-built link (wa.me / ntfy web), fail-closed
 *   buildWebcalUrl       — the webcal:// twin an iPhone camera subscribes
 *   QR_CAPTIONS          — the honesty captions under each QR
 *   qrHostLabel          — the tiny host chip ("ntfy.sh", "wa.me", …)
 *
 * Boundaries (deliberate):
 *  - FAIL CLOSED ON SCHEME. Only absolute http(s) URLs may be encoded —
 *    javascript:, data:, mailto: or any other scheme returns null and the
 *    surface renders no QR at all. The belt-and-braces check runs even on
 *    links that come from the other rulebooks (which already guarantee
 *    https), because a QR is rendered as an image the student TRUSTS.
 *  - NO THIRD-PARTY QR SERVICE. The payload is drawn locally by the
 *    `qrcode` package in the browser — the private calendar token and the
 *    pairing deep links never leave this device to be drawn as an image.
 *  - CAPTIONS NEVER PROMISE AN AUTOMATIC SEND. The WhatsApp caption ends
 *    with "You press send" — the student sends the activation message
 *    (the r109 spec: all sending is student-triggered); the ntfy caption
 *    says "Subscribe there" (the human subscribes); the calendar caption
 *    says the token travels only inside the QR — drawn once, on demand.
 *  - Pure string logic only: no fetches, no db, no rendering. The image
 *    itself is drawn by the QrReveal component.
 */

const HTTP_URL_RE = /^https?:\/\//i;

/** Which QR variant a surface is showing — https (Android & web) or webcal (iPhone). */
export type QrVariant = "https" | "webcal";

/**
 * The QR payload for the live calendar subscription — the absolute
 * token-protected feed URL exactly as the server issued it (trimmed).
 * Null for anything that is not an http(s) URL (including empty/null) —
 * a QR of a broken link must never exist.
 */
export function qrPayloadForCalendar(url: string | null | undefined): string | null {
  const trimmed = (url ?? "").trim();
  if (!HTTP_URL_RE.test(trimmed)) return null;
  return trimmed;
}

/**
 * The QR payload for a wizard-built link (the wa.me pairing link, the
 * ntfy web link). Same fail-closed scheme rule — the source rulebooks
 * already guarantee https, this is the second gate.
 */
export function qrPayloadFromLink(link: string | null | undefined): string | null {
  return qrPayloadForCalendar(link);
}

/**
 * The webcal:// twin of an http(s) URL — scheme swapped, every other byte
 * identical. iOS cameras recognize webcal:// and offer the calendar
 * SUBSCRIBE sheet directly; Android keeps the https variant (Google
 * Calendar has no webcal camera handler). Null for non-http(s) URLs.
 */
export function buildWebcalUrl(url: string | null | undefined): string | null {
  const trimmed = (url ?? "").trim();
  if (!HTTP_URL_RE.test(trimmed)) return null;
  return `webcal://${trimmed.slice(trimmed.indexOf("://") + 3)}`;
}

/**
 * The honesty captions — human sentences rendered under each QR,
 * pinned byte-wise so voice drift is caught. Each caption says what the
 * scan DOES and stops before promising anything automatic.
 */
export const QR_CAPTIONS = {
  calendar:
    "Point your phone's camera here — the subscription link opens on the phone. The token travels only inside this QR.",
  calendarWebcal:
    "Scanning opens your iPhone's calendar with a subscribe prompt — confirm once and it stays in sync.",
  ntfy: "Point your phone's camera here — the topic page opens in the phone's browser. Subscribe there, or install the app from the page.",
  wa: "Point your phone's camera here — WhatsApp opens with the activation message already typed. You press send.",
} as const;

/**
 * The tiny host chip beside the QR — "ntfy.sh", "wa.me", the app's own
 * host — so the student can SEE which destination the square encodes
 * before scanning it. Null when the payload somehow fails to parse
 * (the chip hides, the QR itself is still safe to draw).
 */
export function qrHostLabel(payload: string): string | null {
  try {
    const parsed = new URL(payload);
    return parsed.host || null;
  } catch {
    return null;
  }
}

/** PNG render width (2× the displayed size → crisp on retina screens). */
export const QR_IMG_WIDTH = 336;

/** Displayed size in CSS pixels — big enough for any phone camera. */
export const QR_DISPLAY_PX = 168;
