/**
 * r111 — the ntfy push SETUP rulebook (src/lib/ntfy-pair.ts). Pinned here:
 *   • TOPIC GENERATION — "erp-sync-" prefix + exactly 12 base36 chars
 *     (~62 bits, an upgrade over the old 8-char dice); determinism with a
 *     pinned rand; distinct seeds → distinct topics; charset only [a-z0-9]
 *   • CRYPTO WRAPPER — randomNtfyTopic() honors the shape/charset/uniqueness
 *     contract on the real runtime (crypto.getRandomValues or dice fallback)
 *   • TOPIC VALIDATION — ntfy's charset [A-Za-z0-9_-]{1,64}; spaces, dots,
 *     slashes, unicode and 65-char topics rejected; the 64-char boundary
 *     accepted; ntfyTopicHint returns a human reason (empty → null = "not typed yet")
 *   • SERVER NORMALIZATION — "" → null (use ntfy.sh); full URLs, bare hosts,
 *     trailing slashes and paths handled; scheme honored (http vs https);
 *     foreign schemes, hostless and spaced junk → null
 *   • LINKS — the deep link ntfy://<host>/<topic> byte-exact per ntfy's
 *     docs (default host ntfy.sh; ?secure=false ONLY for http servers);
 *     the web link honors the server's own scheme; invalid topic or junk
 *     server → null (never an invented link)
 *   • FALLBACK TEXT — contains the topic, the host, the subscribe steps
 *     and the capability warning
 *   • CARE MATRIX (ntfyCareAction, the r110 rulebook ntfy side) —
 *     unconfigured → setup (ntfy-setup wizard); failing → repair (SAME
 *     wizard); unverified → verify (Settings Send test, NOT the wizard);
 *     saved-off/live/unknown → none; NO send kind ever; real strings
 * Consumer: the ntfy guided setup wizard, the checklist row, the palette's
 * Care center group.
 */
import {
  NTFY_DEFAULT_HOST,
  NTFY_TOPIC_PREFIX,
  NTFY_TOPIC_RANDOM_LENGTH,
  buildNtfyAppDeepLink,
  buildNtfyWebLink,
  generateNtfyTopic,
  isValidNtfyTopic,
  ntfyCareAction,
  ntfySetupFallbackText,
  ntfyTopicHint,
  normalizeNtfyServer,
  randomNtfyTopic,
} from "../src/lib/ntfy-pair";

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

/* ---------- topic generation ---------- */

// Determinism: a pinned counter-rand produces the exact expected topic.
{
  let i = 0;
  const topic = generateNtfyTopic(() => (i++ * 0.1) % 1);
  eq("gen: length = prefix + 12", topic.length, NTFY_TOPIC_PREFIX.length + NTFY_TOPIC_RANDOM_LENGTH);
  check("gen: starts with prefix", topic.startsWith(NTFY_TOPIC_PREFIX), topic);
  check("gen: suffix is base36", /^[a-z0-9]+$/.test(topic.slice(NTFY_TOPIC_PREFIX.length)), topic);
}
{
  // Distribution sanity: 200 draws all well-formed, and the space is big
  // enough that 200 draws never collide.
  const seen = new Set<string>();
  let ok = true;
  for (let k = 0; k < 200; k++) {
    const t = generateNtfyTopic(Math.random);
    if (!t.startsWith(NTFY_TOPIC_PREFIX) || !/^[a-z0-9]{12}$/.test(t.slice(NTFY_TOPIC_PREFIX.length))) ok = false;
    seen.add(t);
  }
  check("gen: 200 draws all well-formed", ok);
  eq("gen: 200 draws, zero collisions", seen.size, 200);
}
{
  // Distinct seeds produce distinct topics even early.
  const a = generateNtfyTopic(() => 0);
  const b = generateNtfyTopic(() => 0.5);
  check("gen: different seeds → different topics", a !== b, `${a} vs ${b}`);
  eq("gen: all-zeros rand → 'a' suffix", generateNtfyTopic(() => 0).slice(-12), "aaaaaaaaaaaa");
  // rand() = 0.9999... maps inside the alphabet (never out of bounds)
  const top = generateNtfyTopic(() => 0.999999);
  check("gen: near-1 rand stays in alphabet", /^[a-z0-9]+$/.test(top.slice(-12)), top);
}

/* ---------- crypto wrapper ---------- */

{
  const seen = new Set<string>();
  let ok = true;
  for (let k = 0; k < 50; k++) {
    const t = randomNtfyTopic();
    if (!t.startsWith(NTFY_TOPIC_PREFIX) || !/^[a-z0-9]{12}$/.test(t.slice(NTFY_TOPIC_PREFIX.length))) ok = false;
    seen.add(t);
  }
  check("crypto wrapper: 50 draws all well-formed", ok);
  eq("crypto wrapper: 50 draws, zero collisions", seen.size, 50);
  check("crypto wrapper: valid per ntfy rules", isValidNtfyTopic(randomNtfyTopic()));
}

/* ---------- topic validation ---------- */

check("valid: 12-char generated", isValidNtfyTopic(randomNtfyTopic()));
check("valid: plain word", isValidNtfyTopic("mytopic"));
check("valid: digits/dash/underscore", isValidNtfyTopic("Erp-Sync_2026_10"));
check("valid: 64-char boundary", isValidNtfyTopic("a".repeat(64)));
check("valid: trims whitespace", isValidNtfyTopic("  mytopic  "));
check("invalid: empty", !isValidNtfyTopic(""));
check("invalid: whitespace only", !isValidNtfyTopic("   "));
check("invalid: 65 chars", !isValidNtfyTopic("a".repeat(65)));
check("invalid: space inside", !isValidNtfyTopic("my topic"));
check("invalid: dot", !isValidNtfyTopic("my.topic"));
check("invalid: slash", !isValidNtfyTopic("my/topic"));
check("invalid: unicode", !isValidNtfyTopic("mytöpic"));

/* ---------- topic hints ---------- */

eq("hint: empty → null (not an error yet)", ntfyTopicHint(""), null);
eq("hint: valid → null", ntfyTopicHint("mytopic"), null);
check("hint: dot gets a human reason", (ntfyTopicHint("my.topic") ?? "").includes("underscores"));
check("hint: 65 chars gets the length reason", (ntfyTopicHint("a".repeat(65)) ?? "").includes("64"));
eq("hint: whitespace-only → null", ntfyTopicHint("   "), null);

/* ---------- server normalization ---------- */

{
  const def = normalizeNtfyServer("");
  eq("server: empty → null (use default)", def, null);
}
{
  const s = normalizeNtfyServer("https://ntfy.example.com");
  check("server: https URL host", s?.host === "ntfy.example.com", JSON.stringify(s));
  eq("server: https scheme", s?.scheme, "https");
}
{
  const s = normalizeNtfyServer("http://192.168.1.10");
  check("server: http IP host", s?.host === "192.168.1.10", JSON.stringify(s));
  eq("server: http scheme", s?.scheme, "http");
}
{
  const s = normalizeNtfyServer("ntfy.example.com/");
  check("server: bare host with slash", s?.host === "ntfy.example.com", JSON.stringify(s));
  eq("server: bare host defaults https", s?.scheme, "https");
}
{
  const s = normalizeNtfyServer("https://ntfy.example.com/sub/path");
  check("server: path stripped, host kept", s?.host === "ntfy.example.com", JSON.stringify(s));
}
{
  const s = normalizeNtfyServer("HTTPS://NTFY.EXAMPLE.COM");
  check("server: host lowercased", s?.host === "ntfy.example.com", JSON.stringify(s));
}
eq("server: foreign scheme ftp → null", normalizeNtfyServer("ftp://ntfy.example.com"), null);
eq("server: scheme-less junk 'http://' → null", normalizeNtfyServer("http://"), null);
eq("server: no dot in host → null", normalizeNtfyServer("https://localhost"), null);
eq("server: spaced host → null", normalizeNtfyServer("https://nt fy.example.com"), null);
eq("server: not a URL at all → null", normalizeNtfyServer("::::"), null);

/* ---------- app deep link (ntfy://) ---------- */

eq(
  "deep link: default server byte-exact",
  buildNtfyAppDeepLink("erp-sync-abc123xyz789"),
  "ntfy://ntfy.sh/erp-sync-abc123xyz789"
);
eq(
  "deep link: custom https server",
  buildNtfyAppDeepLink("mytopic", "https://ntfy.example.com"),
  "ntfy://ntfy.example.com/mytopic"
);
eq(
  "deep link: http self-host gets ?secure=false",
  buildNtfyAppDeepLink("mytopic", "http://192.168.1.10"),
  "ntfy://192.168.1.10/mytopic?secure=false"
);
eq("deep link: bare host treated https (no flag)", buildNtfyAppDeepLink("mytopic", "ntfy.example.com"), "ntfy://ntfy.example.com/mytopic");
eq("deep link: invalid topic → null", buildNtfyAppDeepLink("my topic"), null);
eq("deep link: empty topic → null", buildNtfyAppDeepLink(""), null);
eq("deep link: junk server → null (never ntfy.sh silently)", buildNtfyAppDeepLink("mytopic", "::::"), null);

/* ---------- web link ---------- */

eq(
  "web link: default byte-exact",
  buildNtfyWebLink("erp-sync-abc123xyz789"),
  `https://${NTFY_DEFAULT_HOST}/erp-sync-abc123xyz789`
);
eq("web link: custom https", buildNtfyWebLink("mytopic", "https://ntfy.example.com"), "https://ntfy.example.com/mytopic");
eq("web link: custom http keeps scheme", buildNtfyWebLink("mytopic", "http://192.168.1.10"), "http://192.168.1.10/mytopic");
eq("web link: invalid topic → null", buildNtfyWebLink("nope!"), null);

/* ---------- fallback text ---------- */

{
  const t = ntfySetupFallbackText("erp-sync-abc123xyz789");
  check("fallback: contains the topic", t.includes("erp-sync-abc123xyz789"));
  check("fallback: contains default host", t.includes(NTFY_DEFAULT_HOST));
  check("fallback: has subscribe steps", t.includes("1.") && t.includes("2."));
  check("fallback: capability warning", t.toLowerCase().includes("anyone who knows"));
}
{
  const t = ntfySetupFallbackText("mytopic", "http://192.168.1.10");
  check("fallback: custom host honored", t.includes("192.168.1.10"));
}

/* ---------- care matrix (ntfyCareAction) ---------- */

{
  const a = ntfyCareAction("unconfigured");
  eq("care: unconfigured kind", a.kind, "setup");
  eq("care: unconfigured focus", a.focus, "ntfy-setup");
  eq("care: unconfigured label", a.label, "Set up free push alerts — guided");
}
{
  const a = ntfyCareAction("failing");
  eq("care: failing kind", a.kind, "repair");
  eq("care: failing focus", a.focus, "ntfy-setup");
  eq("care: failing label", a.label, "Repair ntfy push — guided");
}
{
  const a = ntfyCareAction("unverified");
  eq("care: unverified kind", a.kind, "verify");
  eq("care: unverified focus", a.focus, "notify");
  eq("care: unverified label", a.label, "Verify ntfy push — send a test");
}
{
  const off = ntfyCareAction("saved-off");
  eq("care: saved-off → none", off.kind, "none");
  eq("care: saved-off label null", off.label, null);
  eq("care: saved-off focus null", off.focus, null);
  const live = ntfyCareAction("live");
  eq("care: live → none", live.kind, "none");
  // Foreign verdict fails closed.
  const foreign = ntfyCareAction("mystery" as never);
  eq("care: foreign verdict → none", foreign.kind, "none");
}
// No send kind may ever exist; no label promises an automatic send.
{
  const verdicts = ["unconfigured", "failing", "unverified", "saved-off", "live"] as const;
  for (const v of verdicts) {
    const a = ntfyCareAction(v);
    check(`care: ${v} never a "send" kind`, a.kind !== ("send" as never));
    if (a.label) check(`care: ${v} label honest`, !/^(send|push) /i.test(a.label), a.label);
  }
}

/* ---------- constants sanity ---------- */

eq("const: default host", NTFY_DEFAULT_HOST, "ntfy.sh");
eq("const: random length", NTFY_TOPIC_RANDOM_LENGTH, 12);
check("const: prefix shape", /^erp-sync-$/.test(NTFY_TOPIC_PREFIX));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
