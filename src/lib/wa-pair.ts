/**
 * WhatsApp (CallMeBot) pairing rulebook — the repair wizard's brain.
 *
 * CallMeBot pairing is a conversation, not a form: the student sends ONE
 * fixed activation message from their own WhatsApp to CallMeBot's bot
 * number, and the bot replies with a numeric apikey. Every failure r106+
 * surfaced ("apikey can not be empty or it has an invalid format") traces
 * back to a broken pairing, so this module turns that conversation into
 * copy-pasteable artifacts:
 *
 *   buildWaPairLink        — the one-tap wa.me deep link (chat + prefilled text)
 *   waPairFallbackText     — the clipboard fallback when WhatsApp is not on the device
 *   extractApikeyFromReply — paste the bot's WHOLE reply, get the key out of it
 *
 * Boundaries (deliberate):
 *  - The activation number is EDITABLE at every call site. CallMeBot has
 *    rotated its bot number over the years (+34 621 331 709 is the most
 *    widely documented today), so the constant is a sensible default,
 *    never gospel — their instructions page is the source of truth.
 *  - extractApikeyFromReply NEVER invents a key. It reads one out of a
 *    pasted reply or returns null; a null means "type it by hand".
 *  - Pure display/string logic only: no fetches, no db, no sends. The
 *    wizard still asks before saving and before test-sending (spec: no
 *    automatic sends, ever).
 */

/** Most widely documented CallMeBot WhatsApp activation number (Oct 2026). */
export const CALLMEBOT_DEFAULT_ACTIVATE_DIGITS = "34621331709";

/** The exact activation phrase CallMeBot expects. */
export const CALLMEBOT_ACTIVATE_MESSAGE = "I allow callmebot to send me messages";

/** CallMeBot's instructions page — the source of truth for the current bot number. */
export const CALLMEBOT_INSTRUCTIONS_URL =
  "https://www.callmebot.com/blog/free-api-for-send-whatsapp-messages/";

/** Strip everything but digits: "+34 621-331-709 " → "34621331709". */
export function normalizeWaDigits(input: string): string {
  return (input ?? "").replace(/\D/g, "");
}

/**
 * Human display for an international number: "+34 621 331 709".
 * Country code = first 2 digits, remaining digits in groups of 3.
 * Falls back to "+<digits>" when the shape is unusual.
 */
export function formatWaNumber(digits: string): string {
  const d = normalizeWaDigits(digits);
  if (d.length < 6) return d ? `+${d}` : "";
  const cc = d.slice(0, 2);
  const rest = d.slice(2);
  const groups: string[] = [];
  for (let i = 0; i < rest.length; i += 3) groups.push(rest.slice(i, i + 3));
  return `+${cc} ${groups.join(" ")}`;
}

/**
 * The one-tap pairing link: opens the WhatsApp chat with `activationInput`
 * and pre-fills the activation message. null when the number can't be a
 * real WhatsApp number (wa.me wants 8–15 digits).
 */
export function buildWaPairLink(activationInput: string): string | null {
  const digits = normalizeWaDigits(activationInput);
  if (digits.length < 8 || digits.length > 15) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(CALLMEBOT_ACTIVATE_MESSAGE)}`;
}

/** Clipboard fallback with the number formatted for humans. */
export function waPairFallbackText(activationInput: string): string {
  return (
    `Open WhatsApp and send this exact message to ${formatWaNumber(activationInput) || "the CallMeBot number"}:\n\n` +
    `${CALLMEBOT_ACTIVATE_MESSAGE}\n\n` +
    `CallMeBot replies with your apikey — paste that reply into the repair wizard.`
  );
}

/**
 * Pull the apikey out of a pasted CallMeBot reply.
 *
 * Success replies look like "API Activated for your phone number. Your
 * APIKEY is 123456" (case varies, colon optional). Failure replies look
 * like "APIKey is invalid" — the word after "is" is alphabetic, and a
 * real key always contains at least one digit, so those are rejected.
 *
 * Order of attempts:
 *  1. explicit "api key / apikey [is] [: =] TOKEN" (alnum 4–16, must contain a digit)
 *  2. fallback: the FIRST standalone digit run of 4–8 digits — longer runs
 *     are phone numbers (11–15 digits) and must never be mistaken for keys.
 *
 * Returns the trimmed token, or null when nothing convincing is present.
 */
export function extractApikeyFromReply(pasted: string): string | null {
  const text = (pasted ?? "").trim();
  if (!text) return null;

  const explicit = /api[\s-]?key\s*(?:is)?\s*[:=]?\s*([A-Za-z0-9]{4,16})/i.exec(text);
  if (explicit && /\d/.test(explicit[1])) return explicit[1];

  const runs = text.match(/(?<![A-Za-z0-9])(\d{4,8})(?![A-Za-z0-9])/g);
  if (runs && runs.length > 0) return runs[0];

  return null;
}

/**
 * Resolve the payload for the "save fresh key" action: the phone is the
 * student's OWN paired number — a repair should keep the saved one unless
 * they type a different number. Pure so the rulebook is test-pinned.
 *
 * Throws when neither a new phone nor a saved phone exists (first-time
 * setup must supply the phone — that is correct, not a workaround).
 */
export function resolveWaSaveInput(input: {
  phone?: string | null;
  apikey: string;
  existingPhone?: string | null;
}): { phone: string; apikey: string } {
  const newDigits = normalizeWaDigits(input.phone ?? "");
  const apikey = (input.apikey ?? "").trim();
  if (!apikey) throw new Error("The fresh apikey is required.");
  if (newDigits) {
    const phone = newDigits.length === 10 ? `91${newDigits}` : newDigits;
    if (phone.length < 8 || phone.length > 15) {
      throw new Error("Phone must be an international number, e.g. 91 98XXXXXXXX.");
    }
    return { phone, apikey };
  }
  const saved = normalizeWaDigits(input.existingPhone ?? "");
  if (!saved) throw new Error("Phone is required the first time — add your WhatsApp number.");
  return { phone: saved, apikey };
}
