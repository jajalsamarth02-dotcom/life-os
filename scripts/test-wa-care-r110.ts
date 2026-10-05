/**
 * r110 — the WhatsApp CARE ROUTING rulebook (waCareAction) + regression
 * re-pin of the pairing rulebook it rides on. Pinned here:
 *   • THE MATRIX — failing → repair (wa-repair focus); unconfigured → setup
 *     (SAME wizard); unverified → verify (Settings Send test, NOT the
 *     wizard — the pair may be fine, only a send can say so); saved-off →
 *     none (deliberately off is respected); live → none
 *   • NO SEND KIND — the palette launches surfaces, never fires messages;
 *     no action label promises a send except "verify", whose focus is the
 *     Settings CARD (the one send affordance), not an auto-send
 *   • FOCUS ROUTING — repair/setup → "wa-repair" (the wizard deep-link,
 *     r110's SettingsFocus extension); verify → "notify" (the channel grid)
 *   • REAL STRINGS — labels are human sentences usable verbatim in the
 *     palette row (pinned byte-wise so voice drift is caught)
 * Consumer: the command palette's Care center group (11th group-site).
 */
import { waCareAction } from "../src/lib/wa-pair";

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

/* THE LIVE INCIDENT verdict (failing) → repair, lands INSIDE the wizard */
{
  const a = waCareAction("failing");
  eq("failing: kind", a.kind, "repair");
  eq("failing: focus", a.kind === "none" ? null : a.focus, "wa-repair");
  eq("failing: label", a.kind === "none" ? null : a.label, "Repair the WhatsApp pairing");
}
/* unconfigured → the SAME wizard is the guided setup */
{
  const a = waCareAction("unconfigured");
  eq("unconfigured: kind", a.kind, "setup");
  eq("unconfigured: focus", a.kind === "none" ? null : a.focus, "wa-repair");
  eq("unconfigured: label", a.kind === "none" ? null : a.label, "Set up WhatsApp alerts — guided");
}
/* unverified → verify via the Settings CARD (no wizard; only a send can say) */
{
  const a = waCareAction("unverified");
  eq("unverified: kind", a.kind, "verify");
  eq("unverified: focus", a.kind === "none" ? null : a.focus, "notify");
  eq("unverified: label", a.kind === "none" ? null : a.label, "Verify the WhatsApp pairing — send a test");
}
/* saved-off → none (a deliberate off is respected, not nagged) */
{
  const a = waCareAction("saved-off");
  eq("saved-off: kind", a.kind, "none");
  eq("saved-off: label", a.label, null);
  eq("saved-off: focus", a.focus, null);
}
/* live → none (nothing to care for) */
{
  const a = waCareAction("live");
  eq("live: kind", a.kind, "none");
  eq("live: label", a.label, null);
}
/* foreign verdicts fail closed toward "none" (never a wrong affordance) */
{
  const a = waCareAction("mystery" as never);
  eq("foreign: kind", a.kind, "none");
}
/* determinism: the same verdict always yields the same action */
{
  eq("determinism", JSON.stringify(waCareAction("failing")), JSON.stringify(waCareAction("failing")));
}
/* no action ever promises an automatic send */
{
  for (const v of ["failing", "unconfigured", "unverified", "saved-off", "live"] as const) {
    const a = waCareAction(v);
    const text = `${a.kind} ${a.label ?? ""}`;
    check(`no-auto-send in ${v}`, !text.includes("sends"), text);
  }
}

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
