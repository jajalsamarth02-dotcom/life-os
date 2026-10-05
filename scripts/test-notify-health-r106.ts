/**
 * r106 — parseNotifyHealth / stripProviderHtml / apikeyShapeHint: the ONE
 * notify-channel health rulebook. Pinned here:
 *   • VERDICT MATRIX — unconfigured → saved-off → unverified → live|failing,
 *     in that precedence order, whatever the caller might prefer to believe
 *   • THE INCIDENT — the EXACT stored string from the live DB ("ERROR:
 *     apikey can not be <b>empty</b> or it has an <b>invalid format</b>",
 *     auto, 2026-10-05T08:40:23.243Z) parses to failing with the provider
 *     HTML stripped and an honest IST at-label — the string that sat behind
 *     a "Done · Live" checklist row for days
 *   • HTML STRIPPING — tags become spaces (words never glue), the handful
 *     of entities providers actually emit decode, whitespace collapses
 *   • AT-LABEL — "HH:mm IST · <age>" composed with the r105 age ladder
 *     (freshnessAgeLabel) and istFormat; clock skew reads "just now"
 *   • UNPARSEABLE — a foreign-shaped lastResult claims neither success nor
 *     failure; it asks for a fresh attempt (honest unknown)
 *   • SHAPE HINT — CallMeBot keys are short digit codes; the hint steers
 *     without blocking, and normal keys stay silent
 * Consumers: setup-checklist rows (dashboard), WhatsAppCard + NtfyCard
 * health lines (Settings), toast snippets. One rulebook, no drift.
 */
import { apikeyShapeHint, parseNotifyHealth, stripProviderHtml } from "../src/lib/notify-health";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

const NOW = Date.UTC(2026, 9, 5, 8, 53, 0); // 14:23 IST
const base = {
  enabled: true,
  configured: true,
  nowMs: NOW,
};

/* ---------- 1. verdict matrix ---------- */

{
  const h = parseNotifyHealth({ ...base, enabled: true, configured: false, lastResult: null });
  check("unconfigured wins over enabled", h.verdict === "unconfigured");
  check("unconfigured is muted", h.tone === "muted");
  check("unconfigured has no atLabel", h.atLabel === null && h.trigger === null);
}
{
  const h = parseNotifyHealth({ ...base, enabled: false, lastResult: null });
  check("saved-off beats unverified", h.verdict === "saved-off" && h.tone === "muted");
}
{
  const h = parseNotifyHealth({ ...base, lastResult: null });
  check("enabled+configured+no result = unverified", h.verdict === "unverified");
  check("unverified is amber", h.tone === "amber");
  check("unverified asks for a test", /send test/i.test(h.detail));
}

/* ---------- 2. THE INCIDENT — exact stored string ---------- */

const INCIDENT =
  "2026-10-05T08:40:23.243Z (auto) → FAILED: ERROR: apikey can not be <b>empty</b> or it has an <b>invalid format</b>";
{
  const h = parseNotifyHealth({ ...base, lastResult: INCIDENT });
  check("incident verdict is failing", h.verdict === "failing");
  check("incident tone is red", h.tone === "red");
  check("incident label", h.label === "Send failed");
  check("incident trigger is auto", h.trigger === "auto");
  check(
    "provider HTML stripped from detail",
    h.detail ===
      "Last auto attempt failed — ERROR: apikey can not be empty or it has an invalid format.",
    h.detail
  );
  check("incident atLabel is 14:10 IST", h.atLabel === "14:10 IST · 12m ago", h.atLabel ?? "null");
  check("failing detail never contains <b>", !h.detail.includes("<"));
}

/* ---------- 3. live / manual / sent ---------- */

{
  const h = parseNotifyHealth({
    ...base,
    lastResult: "2026-10-05T08:30:00.000Z (manual) → sent: Message queued",
  });
  check("manual sent is live", h.verdict === "live" && h.tone === "emerald");
  check("live label is Delivered", h.label === "Delivered");
  check("live detail names the trigger", h.detail.startsWith("Last manual message delivered"));
  check("live keeps the provider snippet", /Message queued/.test(h.detail));
  check("live atLabel is 14:00 IST · 23m ago", h.atLabel === "14:00 IST · 23m ago", h.atLabel ?? "null");
}

/* ---------- 4. FAILED with empty reason / multi-line body ---------- */

{
  const h = parseNotifyHealth({ ...base, lastResult: "2026-10-05T08:40:00.000Z (auto) → FAILED: " });
  check("empty reason leaves no dangling dash", h.detail === "Last auto attempt failed.", h.detail);
}
{
  const h = parseNotifyHealth({
    ...base,
    lastResult: "2026-10-05T08:40:00.000Z (auto) → FAILED: line one<br>line two  spaced",
  });
  check(
    "multi-line body collapses to spaces",
    h.detail === "Last auto attempt failed — line one line two spaced.",
    h.detail
  );
}

/* ---------- 5. unparseable / corrupt ---------- */

{
  const h = parseNotifyHealth({ ...base, lastResult: "garbage from an ancient format" });
  check("foreign shape = unverified (not failing, not live)", h.verdict === "unverified");
  check("foreign shape admits unreadability", /unreadable/.test(h.detail));
  check("foreign shape has no atLabel", h.atLabel === null);
}

/* ---------- 6. clock skew ---------- */

{
  const h = parseNotifyHealth({
    ...base,
    lastResult: "2026-10-05T09:30:00.000Z (manual) → sent: ok", // "future" vs NOW
  });
  check("skewed future stamp never prints a negative age", (h.atLabel ?? "").includes("just now"), h.atLabel ?? "null");
}

/* ---------- 7. stripProviderHtml unit edges ---------- */

check("tags become spaces, words never glue", stripProviderHtml("a<b>c</b>d") === "a c d");
check("entities decode", stripProviderHtml("x &amp; y &lt;z&gt; &quot;q&quot; &#39;s&#39;") === `x & y <z> "q" 's'`);
check("whitespace collapses", stripProviderHtml("a\n\r b   c") === "a b c");
check("plain text passes through untouched", stripProviderHtml("HTTP 503") === "HTTP 503");

/* ---------- 8. apikeyShapeHint ---------- */

check("empty key stays quiet", apikeyShapeHint("") === null);
check("blank key stays quiet", apikeyShapeHint("   ") === null);
check("normal CallMeBot key stays quiet", apikeyShapeHint("123456") === null);
check("padded normal key stays quiet", apikeyShapeHint("  741258963 ") === null);
check("letters trigger the hint", apikeyShapeHint("abc123") !== null);
check("overlong digits trigger the hint", apikeyShapeHint("12345678901234567890") !== null);
check("hint is guidance, not a block verdict", (apikeyShapeHint("zzz") ?? "").includes("pairing message"));

/* ---------- 9. non-mutation + tone coherence ---------- */

{
  const input = { ...base, lastResult: INCIDENT };
  const snapshot = JSON.stringify(input);
  parseNotifyHealth(input);
  check("input object is never mutated", JSON.stringify(input) === snapshot);
}
{
  const tones = [
    parseNotifyHealth({ ...base, enabled: false, lastResult: null }).tone,
    parseNotifyHealth({ ...base, configured: false, lastResult: null }).tone,
    parseNotifyHealth({ ...base, lastResult: null }).tone,
    parseNotifyHealth({ ...base, lastResult: INCIDENT }).tone,
    parseNotifyHealth({ ...base, lastResult: "2026-10-05T08:30:00.000Z (manual) → sent: ok" }).tone,
  ];
  check(
    "tone ladder is coherent across every verdict",
    JSON.stringify(tones) === JSON.stringify(["muted", "muted", "amber", "red", "emerald"]),
    JSON.stringify(tones)
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
