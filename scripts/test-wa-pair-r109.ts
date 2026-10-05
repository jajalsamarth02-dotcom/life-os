/**
 * r109 — the WhatsApp (CallMeBot) pairing rulebook: src/lib/wa-pair.ts.
 * Pinned here:
 *   • DIGITS — normalizeWaDigits strips everything but 0-9 (numbers arrive
 *     "+34 621 331 709", "91 98xxx-xxx", pasted from any contact card)
 *   • DISPLAY — formatWaNumber renders "+34 621 331 709" (2-digit country
 *     code + 3-groups); unusual shapes fall back to "+<digits>"; empty → ""
 *   • THE LINK — buildWaPairLink bakes the EXACT activation phrase into a
 *     wa.me deep link; bounds 8–15 digits; junk in → null (never a broken
 *     wa.me anchor)
 *   • EXTRACTION — THE REAL REPLY "API Activated for your phone number.
 *     Your APIKEY is 123456" yields "123456"; case variants, colons, "api
 *     key" spacing; FAILURE replies ("APIKey is invalid…") yield null
 *     because a real key always contains a digit; standalone digit runs
 *     4–8 are the fallback, runs ≥9 are phone numbers and never keys;
 *     "I allow callmebot…" (no digits ≥4) yields null
 *   • SAVE RESOLUTION — resolveWaSaveInput: a repair with no phone keeps
 *     the SAVED phone; a typed 10-digit Indian number gains the 91 prefix;
 *     first-time setup without any phone THROWS (correct, not a workaround);
 *     empty key throws; junk phones throw
 * Consumers: WaRepairDialog (Settings), saveWaConfig (notify/whatsapp.ts).
 * One rulebook, no drift.
 */
import {
  CALLMEBOT_ACTIVATE_MESSAGE,
  CALLMEBOT_DEFAULT_ACTIVATE_DIGITS,
  buildWaPairLink,
  extractApikeyFromReply,
  formatWaNumber,
  normalizeWaDigits,
  resolveWaSaveInput,
  waPairFallbackText,
} from "../src/lib/wa-pair";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`FAIL: ${name}${extra ? ` — ${extra}` : ""}`);
  }
}
function eq(name: string, got: unknown, want: unknown) {
  check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

/* ---------- digits ---------- */
eq("digits: plain passthrough", normalizeWaDigits("34621331709"), "34621331709");
eq("digits: +, spaces, dashes", normalizeWaDigits("+34 621-331-709 "), "34621331709");
eq("digits: empty", normalizeWaDigits(""), "");
eq("digits: nullish-ish garbage", normalizeWaDigits("call me"), "");
eq("digits: 91-prefixed indian", normalizeWaDigits("91 98765 43210"), "919876543210");

/* ---------- display ---------- */
eq("format: default bot number", formatWaNumber("34621331709"), "+34 621 331 709");
eq("format: 12-digit shape", formatWaNumber("919876543210"), "+91 987 654 321 0");
eq("format: too short falls back", formatWaNumber("34621"), "+34621");
eq("format: empty", formatWaNumber(""), "");
eq("format: ignores junk input", formatWaNumber("+34 (621) 331-709"), "+34 621 331 709");

/* ---------- link ---------- */
{
  const link = buildWaPairLink(CALLMEBOT_DEFAULT_ACTIVATE_DIGITS);
  eq(
    "link: default digits → wa.me + encoded phrase",
    link,
    `https://wa.me/34621331709?text=${encodeURIComponent(CALLMEBOT_ACTIVATE_MESSAGE)}`
  );
  check(
    "link: phrase is the exact activation sentence",
    (link ?? "").includes("I%20allow%20callmebot%20to%20send%20me%20messages"),
    link ?? "null"
  );
  eq(
    "link: formatted input with + and spaces normalizes",
    buildWaPairLink("+34 621 331 709"),
    link
  );
  eq("link: 7 digits → null", buildWaPairLink("3462133"), null);
  eq("link: 16 digits → null", buildWaPairLink("3462133170901234"), null);
  eq("link: empty → null", buildWaPairLink(""), null);
  eq("link: junk → null", buildWaPairLink("call me bot"), null);
  eq("link: 8-digit lower bound ok", buildWaPairLink("12345678")?.startsWith("https://wa.me/12345678"), true);
  eq("link: 15-digit upper bound ok", buildWaPairLink("123456789012345")?.startsWith("https://wa.me/123456789012345"), true);
}

/* ---------- extraction ---------- */
{
  // THE REAL REPLY — the format every guide documents.
  eq(
    "extract: the real CallMeBot success reply",
    extractApikeyFromReply("API Activated for your phone number. Your APIKEY is 123456"),
    "123456"
  );
  eq(
    "extract: lowercase api key is",
    extractApikeyFromReply("api key is 654321"),
    "654321"
  );
  eq(
    "extract: colon after is",
    extractApikeyFromReply("Your apikey is: 778899"),
    "778899"
  );
  eq(
    "extract: alnum key via explicit pattern",
    extractApikeyFromReply("APIKEY is A1B2C3"),
    "A1B2C3"
  );
  eq(
    "extract: newline-separated reply",
    extractApikeyFromReply("API Activated for your phone number.\nYour APIKEY is 246810"),
    "246810"
  );
  // FAILURE replies must yield null — never a fake key.
  eq(
    "extract: THE failure reply (alphabetic capture rejected)",
    extractApikeyFromReply(
      "APIKey is invalid. Please create a new one or contact support if you lost it."
    ),
    null
  );
  eq("extract: empty paste", extractApikeyFromReply(""), null);
  eq("extract: whitespace only", extractApikeyFromReply("   \n  "), null);
  eq("extract: activation phrase has no key", extractApikeyFromReply("I allow callmebot to send me messages"), null);
  // Fallback: standalone digit runs; phone-sized runs are NOT keys.
  eq("extract: standalone 6-digit run", extractApikeyFromReply("your code 999888 thanks"), "999888");
  eq(
    "extract: first short run wins",
    extractApikeyFromReply("code 123456 or maybe 654321"),
    "123456"
  );
  eq(
    "extract: 11-digit run is a phone, not a key",
    extractApikeyFromReply("contact the bot at +34 621 331 709 for help"),
    null
  );
  eq(
    "extract: attached-to-letters run ignored",
    extractApikeyFromReply("refabc123456xyz end"),
    null
  );
  eq(
    "extract: 9-digit run too long for fallback",
    extractApikeyFromReply("order 123456789 confirmed"),
    null
  );
}

/* ---------- save resolution ---------- */
{
  // Repair keeps the saved phone.
  const keep = resolveWaSaveInput({ phone: null, apikey: " 123456 ", existingPhone: "919876543210" });
  eq("save: repair keeps saved phone", keep.phone, "919876543210");
  eq("save: key trimmed", keep.apikey, "123456");

  // Explicit new phone wins; 10-digit Indian gains 91.
  const fresh = resolveWaSaveInput({ phone: "9876543210", apikey: "111222", existingPhone: "919876543210" });
  eq("save: typed 10-digit indian gains 91", fresh.phone, "919876543210");

  // Junk phones throw — never store an unsendable number.
  let threw = "";
  try {
    resolveWaSaveInput({ phone: "123", apikey: "111222", existingPhone: null });
  } catch (e) {
    threw = e instanceof Error ? e.message : "?";
  }
  check("save: too-short phone throws", threw.includes("international"), threw);

  // First-time setup without any phone throws (correct, not a workaround).
  threw = "";
  try {
    resolveWaSaveInput({ phone: null, apikey: "111222", existingPhone: null });
  } catch (e) {
    threw = e instanceof Error ? e.message : "?";
  }
  check("save: first-time without phone throws", threw.includes("first time"), threw);

  // Empty key throws.
  threw = "";
  try {
    resolveWaSaveInput({ phone: "919876543210", apikey: "   ", existingPhone: null });
  } catch (e) {
    threw = e instanceof Error ? e.message : "?";
  }
  check("save: empty key throws", threw.includes("apikey is required"), threw);

  // 15-digit upper bound accepted, 16 rejected.
  eq("save: 15-digit ok", resolveWaSaveInput({ phone: "123456789012345", apikey: "1" }).phone, "123456789012345");
  threw = "";
  try {
    resolveWaSaveInput({ phone: "1234567890123456", apikey: "1", existingPhone: null });
  } catch (e) {
    threw = e instanceof Error ? e.message : "?";
  }
  check("save: 16-digit phone throws", threw.includes("international"), threw);
}

/* ---------- fallback text ---------- */
{
  const text = waPairFallbackText(CALLMEBOT_DEFAULT_ACTIVATE_DIGITS);
  check("fallback: mentions formatted number", text.includes("+34 621 331 709"), text);
  check("fallback: contains exact phrase", text.includes(CALLMEBOT_ACTIVATE_MESSAGE), text);
  check("fallback: tells them where to paste", text.includes("repair wizard"), text);
}

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
