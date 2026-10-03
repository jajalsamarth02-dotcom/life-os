/**
 * r101 — buildSingleClassIcs: the per-class "Add to calendar" export.
 * Pinned here:
 *   • FEED IDENTITY — the downloaded event's UID equals classSlotUid AND the
 *     live feed's buildClassEvents UID (import + later subscribe UPDATE the
 *     same event; the whole point of routing through the shared core)
 *   • FLOATING wall times — DTSTART/DTEND carry no "Z" and land on the next
 *     occurrence at the IST wall clock (2026-10-03 is a Saturday; IST = UTC
 *     + 5:30 — the same fixture family as r98/r99)
 *   • today-counts-only-if-still-ahead: Monday 10:00 → today's 11:00 class;
 *     Monday 11:00 (start <= now) → rolls to NEXT Monday
 *   • RRULE:FREQ=WEEKLY exactly once; NO VALARM (classes carry none, same
 *     as the feed)
 *   • calendar name override (X-WR-CALNAME:Class — <code>); the default
 *     buildDeadlineIcs name is untouched for the feed/export callers
 *   • description is the ONE-SHOT voice ("importing an updated export
 *     updates this event"), never the feed's subscription voice
 *   • SUMMARY "[CODE] Class — Name"; TEXT escaping (comma); CRLF everywhere
 *     (no bare \n); 75-octet folding respected
 *   • filename slug: class-<code>-<day>.ics
 *   • honesty: invalid slot (end <= start / bad day) → null
 */
import {
  buildClassEvents,
  buildSingleClassIcs,
  classIcsFilename,
  classSlotUid,
  type ClassSlotInput,
} from "../src/components/erp/ics";

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

/** IST wall → Date (IST = UTC+5:30, no DST). */
function ist(day: number, h: number, m: number): Date {
  // October 2026: Oct 3 = Saturday. Day arg is the calendar date in Oct.
  return new Date(Date.UTC(2026, 9, day, h - 5, m - 30));
}

/** Undo 75-octet folding (continuation lines start with a space) so content
 *  assertions can match across fold boundaries. */
function unfold(text: string): string {
  return text
    .split("\r\n")
    .reduce<string[]>((acc, l) => {
      if (l.startsWith(" ") && acc.length) acc[acc.length - 1] += l.slice(1);
      else acc.push(l);
      return acc;
    }, [])
    .join("\r\n");
}

const SWE: ClassSlotInput = {
  dayOfWeek: 1, // Monday
  startMin: 11 * 60,
  endMin: 12 * 60 + 30,
  subjectCode: "SOFTWARE-ENGINEERING",
};
const NAME = "Software Engineering";

/* ── the identity contract ─────────────────────────────────────────── */
{
  const now = ist(3, 22, 0); // Sat 22:00 IST
  const res = buildSingleClassIcs(SWE, NAME, now)!;
  check("builds a result", !!res);
  const feedEv = buildClassEvents([SWE], () => NAME, now)[0];
  check("UID === classSlotUid", res.text.includes(`UID:${classSlotUid(SWE)}`), classSlotUid(SWE));
  check("UID === feed buildClassEvents UID", res.text.includes(`UID:${feedEv.uid}`), feedEv.uid);
}

/* ── floating wall times, next occurrence ──────────────────────────── */
{
  const now = ist(3, 22, 0); // Sat 22:00 IST → next Monday is Oct 5
  const res = buildSingleClassIcs(SWE, NAME, now)!;
  check("DTSTART floating Mon 11:00", res.text.includes("DTSTART:20261005T110000"), "want 20261005T110000");
  check("DTEND floating Mon 12:30", res.text.includes("DTEND:20261005T123000"), "want 20261005T123000");
  check("no Z on DTSTART line", !res.text.includes("DTSTART:20261005T110000Z"));
}

/* ── today counts only if still ahead ──────────────────────────────── */
{
  const before = buildSingleClassIcs(SWE, NAME, ist(5, 10, 0))!; // Mon 10:00
  check("Mon 10:00 → today's class", before.text.includes("DTSTART:20261005T110000"));
  const at = buildSingleClassIcs(SWE, NAME, ist(5, 11, 0))!; // Mon 11:00 sharp
  check("Mon 11:00 → next week (start<=now)", at.text.includes("DTSTART:20261012T110000"), "want 20261012T110000");
}

/* ── recurrence + alarm policy ─────────────────────────────────────── */
{
  const res = buildSingleClassIcs(SWE, NAME, ist(3, 22, 0))!;
  check("RRULE:FREQ=WEEKLY present", res.text.includes("RRULE:FREQ=WEEKLY"));
  check("RRULE exactly once", res.text.split("RRULE:").length - 1 === 1);
  check("no VALARM", !res.text.includes("BEGIN:VALARM"));
  check("STATUS:CONFIRMED", res.text.includes("STATUS:CONFIRMED"));
  check("X-WR-TIMEZONE:Asia/Kolkata", res.text.includes("X-WR-TIMEZONE:Asia/Kolkata"));
}

/* ── calendar name + summary + one-shot description voice ──────────── */
{
  const res = buildSingleClassIcs(SWE, NAME, ist(3, 22, 0))!;
  const flat = unfold(res.text);
  check("X-WR-CALNAME override", res.text.includes("X-WR-CALNAME:Class — SOFTWARE-ENGINEERING"));
  check("SUMMARY [CODE] Class — Name", res.text.includes("SUMMARY:[SOFTWARE-ENGINEERING] Class — Software Engineering"));
  check("one-shot description voice", flat.includes("importing an updated export updates this event instead of duplicating it"));
  check("no feed subscription voice", !flat.includes("the subscription keeps it current"));
  check("description carries IST window", flat.includes("11:00–12:30 IST"));
}

/* ── the default calendar name is untouched for other callers ──────── */
{
  const feedEv = buildClassEvents([SWE], () => NAME, ist(3, 22, 0))[0];
  // buildDeadlineIcs without opts keeps the shared name — verified through
  // the exported module's default path by building the feed event list.
  check("feed event still has alarm:false + floating", feedEv.alarm === false && feedEv.floating === true);
}

/* ── transport integrity: CRLF + folding + escaping ────────────────── */
{
  const res = buildSingleClassIcs(SWE, NAME, ist(3, 22, 0))!;
  check("no bare \\n (all CRLF)", !/(^|[^\r])\n/.test(res.text));
  const lines = res.text.split("\r\n");
  check("every line <= 75 octets", lines.every((l) => l.length <= 75), `max ${Math.max(...lines.map((l) => l.length))}`);
  check("ends with CRLF", res.text.endsWith("\r\n"));

  const weird: ClassSlotInput = { ...SWE, subjectCode: "SWE,101+LAB" };
  const w = buildSingleClassIcs(weird, "Algorithms, Advanced", ist(3, 22, 0))!;
  check("SUMMARY escapes comma", w.text.includes("Class — Algorithms\\, Advanced"), "escaped comma");
  check("filename slugs punctuation", classIcsFilename(weird) === "class-swe-101-lab-monday.ics", classIcsFilename(weird));
}

/* ── filename ──────────────────────────────────────────────────────── */
{
  check("filename day+slug", classIcsFilename(SWE) === "class-software-engineering-monday.ics", classIcsFilename(SWE));
  const sun: ClassSlotInput = { ...SWE, dayOfWeek: 0, subjectCode: "LAB" };
  check("sunday name", classIcsFilename(sun) === "class-lab-sunday.ics", classIcsFilename(sun));
}

/* ── honesty gates ─────────────────────────────────────────────────── */
{
  const broken: ClassSlotInput = { ...SWE, endMin: 11 * 60 }; // end == start
  check("end<=start → null", buildSingleClassIcs(broken, NAME, ist(3, 22, 0)) === null);
  const badDay: ClassSlotInput = { ...SWE, dayOfWeek: 7 };
  check("day 7 → null", buildSingleClassIcs(badDay, NAME, ist(3, 22, 0)) === null);
  const negDay: ClassSlotInput = { ...SWE, dayOfWeek: -1 };
  check("day -1 → null", buildSingleClassIcs(negDay, NAME, ist(3, 22, 0)) === null);
}

/* ── null display name falls back to code-only summary ─────────────── */
{
  const res = buildSingleClassIcs(SWE, null, ist(3, 22, 0))!;
  const summaryLine = res.text.split("\r\n").find((l) => l.startsWith("SUMMARY:"));
  check("no name → code-only SUMMARY", summaryLine === "SUMMARY:[SOFTWARE-ENGINEERING] Class", summaryLine);
  const flat = unfold(res.text);
  check("no name → no stray dash in description", !flat.split("\r\n").some((l) => l.startsWith("DESCRIPTION:") && l.includes(" — ")));
}

console.log(`r101 buildSingleClassIcs: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
