/**
 * Round 72 — today-card clock dedup + bubble tones + copy fallback ladder.
 *
 * Three contracts pinned here:
 *
 * 1. todayLiveClass now runs on shared.tsx's istNow — the ONE IST clock every
 *    schedule surface uses — instead of a private hh:mm parse. Behavior must
 *    be identical at every "normal" instant (pinned against hand-computed IST
 *    wall clocks) AND correct at the ICU "24:00" midnight quirk, where the old
 *    parse read nowMin=1440 and silently flipped an upcoming class to
 *    "all done". (Whether THIS ICU build renders "24" or "00" at midnight, the
 *    fixed code folds it either way.)
 *
 * 2. smsKeywordTone — the styled bubble color-codes line-openers by ROLE:
 *    WORST → amber (warning language), NEXT → violet (focus language),
 *    everything else → emerald (card identity). Unknown keywords fall back to
 *    emerald — a future line must never render unpainted. The clipboard text
 *    is untouched; tones are paint on the exact same characters.
 *
 * 3. legacyCopy — the insecure-context clipboard ladder's last rung returns
 *    false (not a throw) in non-DOM environments, so the button can show an
 *    honest "Copy failed" state instead of a silent no-op.
 *
 * Run: bun scripts/test-today-r72.ts
 */
import {
  SMS_KEYWORDS,
  SMS_TONE_CLASS,
  legacyCopy,
  smsKeywordTone,
  smsLineParts,
  todayChipClass,
  todayLiveClass,
  type TodayClassBrief,
} from "../src/components/erp/today-card";

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.error(`FAIL  ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

/* ------------------------------------------------------------------ */
/* Fixtures — IST = UTC+5:30; minutes-since-IST-midnight by hand        */
/* ------------------------------------------------------------------ */

const CLASS_0900_1000: TodayClassBrief = { startMin: 540, endMin: 600, subjectCode: "CS101" };
const CLASS_1100_1200: TodayClassBrief = { startMin: 660, endMin: 720, subjectCode: "CS102" };
const CLASS_1800_1900: TodayClassBrief = { startMin: 1080, endMin: 1140, subjectCode: "CS103" };

/** UTC 04:00 on 2026-10-03 = IST 09:30 the same day. */
const IST_0930 = Date.UTC(2026, 9, 3, 4, 0);
/** UTC 18:30 on 2026-10-03 = IST MIDNIGHT (00:00) on 2026-10-04 — the "24:00" edge. */
const IST_MIDNIGHT = Date.UTC(2026, 9, 3, 18, 30);

/* ------------------------------------------------------------------ */
/* 1. todayLiveClass — the deduped clock agrees with hand-computed IST  */
/* ------------------------------------------------------------------ */

console.log("todayLiveClass × istNow (one clock):");

{
  const st = todayLiveClass([CLASS_0900_1000], IST_0930);
  check("ongoing at IST 09:30 for 09:00-10:00", st?.kind === "ongoing" && st.mins === 30,
    JSON.stringify(st));
  check("leftCount counts the unfinished (ongoing included)", st?.leftCount === 1);
}

{
  const st = todayLiveClass([CLASS_0900_1000, CLASS_1100_1200], IST_0930);
  check("ongoing wins over a later upcoming", st?.kind === "ongoing" && st.cls.subjectCode === "CS101");
  check("leftCount = 2 (ongoing + upcoming)", st?.leftCount === 2);
}

{
  const st = todayLiveClass([CLASS_1100_1200], IST_0930);
  check("upcoming 90min out is still reported (SMS honest at any distance)",
    st?.kind === "upcoming" && st.mins === 90);
  const chip = todayChipClass([CLASS_1100_1200], IST_0930);
  check("chip keeps it (exactly at the 90-min window edge)", chip !== null);
}

{
  const st = todayLiveClass([CLASS_1800_1900], IST_0930);
  check("upcoming 8.5h out: SMS line stays honest (mins=510)", st?.kind === "upcoming" && st.mins === 510);
  const chip = todayChipClass([CLASS_1800_1900], IST_0930);
  check("chip stays CALM >90min out (null)", chip === null);
}

{
  check("all done → null", todayLiveClass([{ startMin: 480, endMin: 540, subjectCode: "X" }], IST_0930) === null);
  check("no data (undefined) → null", todayLiveClass(undefined, IST_0930) === null);
  check("no data ([]) → null", todayLiveClass([], IST_0930) === null);
}

{
  /* THE midnight pin: at IST 00:00 the new day's 09:00 class must read as
   * upcoming in 540 minutes. Pre-fix, an ICU build rendering "24:00" fed
   * nowMin=1440 into the filter → null ("all done") — a lie at midnight. */
  const st = todayLiveClass([CLASS_0900_1000], IST_MIDNIGHT);
  check("IST midnight folds to 00:00 — upcoming 540min, NOT 'all done'",
    st?.kind === "upcoming" && st.mins === 540, JSON.stringify(st));
  const chip = todayChipClass([CLASS_0900_1000], IST_MIDNIGHT);
  check("chip calm at midnight (540 > 90)", chip === null);
}

/* ------------------------------------------------------------------ */
/* 2. smsKeywordTone — role-colored keywords, emerald fallback          */
/* ------------------------------------------------------------------ */

console.log("smsKeywordTone (bubble paint, clipboard untouched):");

check("WORST → amber (warning language)", smsKeywordTone("WORST") === "amber");
check("NEXT → violet (focus language)", smsKeywordTone("NEXT") === "violet");
check("lowercase 'worst' is NOT a keyword → emerald", smsKeywordTone("worst") === "emerald");

for (const k of SMS_KEYWORDS) {
  const t = smsKeywordTone(k);
  check(`keyword "${k}" → ${t} (tone known, class non-empty)`,
    t === "emerald" || t === "amber" || t === "violet",
    `got "${t}"`);
  check(`"${k}" has a paint class`, (SMS_TONE_CLASS[t] ?? "").length > 0);
}
check("unknown keyword falls back to emerald (never unpainted/crash)",
  smsKeywordTone("SOMEDAY") === "emerald" && smsKeywordTone("") === "emerald");

{
  /* tone integrates with smsLineParts — the picker sees EXACT keywords */
  const worst = smsLineParts("WORST CS101 62.0% (12/20)");
  check("WORST line parses → amber", worst?.keyword === "WORST" && smsKeywordTone(worst.keyword) === "amber");
  check("WORST rest content preserved byte-exact", worst?.rest === " CS101 62.0% (12/20)");
  const next = smsLineParts("NEXT Essay (CS101) due Mon 12 Oct");
  check("NEXT line parses → violet", next?.keyword === "NEXT" && smsKeywordTone(next.keyword) === "violet");
  const header = smsLineParts("ERP SYNC - SAT 03 OCT 2026");
  check("header line stays unpainted (null parts)", header === null);
}

/* ------------------------------------------------------------------ */
/* 3. legacyCopy — honest false in non-DOM environments                 */
/* ------------------------------------------------------------------ */

console.log("legacyCopy ladder:");
check("no document → false (never throws)", legacyCopy("anything") === false);
check("empty text in non-DOM → false", legacyCopy("") === false);

/* ------------------------------------------------------------------ */

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
