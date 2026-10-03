/**
 * Round 62 — Today-card schedule line + live class chip (pure functions).
 *
 * buildTodaySms gains the "CLASSES TODAY ..." line (honest absence when no
 * timetable has synced, "none scheduled" for a free day, next/ongoing/all-done
 * otherwise). todayLiveClass is the ONE pure state machine shared by the SMS
 * line and the card's live chip, so the two can never disagree.
 *
 * All times are pinned via UTC instants rendered through the card's own IST
 * formatter (Asia/Kolkata), so the suite is timezone-independent.
 *
 * Run: bun scripts/test-today-r62.ts
 */
import {
  buildTodaySms,
  smsSegments,
  todayChipClass,
  todayLiveClass,
  type TodayClassBrief,
  type TodaySmsInput,
} from "../src/components/erp/today-card";
import { applyBatchPicks } from "../src/lib/batch-picks";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass += 1;
    console.log(`  ok ${name}`);
  } else {
    fail += 1;
    console.error(`FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

/* Fixed instants: 2026-10-03 (Sat) — 12:30Z = 18:00 IST, 02:30Z = 08:00 IST. */
const NOW_18 = Date.UTC(2026, 9, 3, 12, 30); // IST 18:00, nowMin = 1080
const NOW_08 = Date.UTC(2026, 9, 3, 2, 30); // IST 08:00, nowMin = 480

const base = {
  now: NOW_18,
  overall: {
    present: 2,
    total: 3,
    absent: 1,
    percentage: 66.67,
    status: "warning" as const,
    classesToTarget: 1,
    canSkip: 0,
  },
  target: 75,
  subjects: [],
  warningSubjects: 0,
  alaPending: 0,
  alaTotal: 0,
  alaOverdue: 0,
  alaDueWeek: 0,
  nextDue: null,
  notedCount: 0,
  lastSyncAt: null,
} as Omit<TodaySmsInput, "todayClasses">;

const sms = (todayClasses: TodayClassBrief[] | null | undefined, now = NOW_18) =>
  buildTodaySms({ ...base, now, todayClasses });

/* ------------------------------------------------------------------ */
/* todayLiveClass — the shared chip/SMS state machine                  */
/* ------------------------------------------------------------------ */

console.log("todayLiveClass:");
check("undefined slots → null (honest absence)", todayLiveClass(undefined, NOW_18) === null);
check("null slots → null", todayLiveClass(null, NOW_18) === null);
check("empty slots → null", todayLiveClass([], NOW_18) === null);

const upcoming = todayLiveClass([{ startMin: 1085, endMin: 1140, subjectCode: "BETCE12302" }], NOW_18);
check("upcoming within 90 min → upcoming", upcoming?.kind === "upcoming");
check("upcoming mins counts to START (5)", upcoming?.kind === "upcoming" && upcoming.mins === 5);
check("upcoming leftCount = 1", upcoming?.leftCount === 1);

const atStart = todayLiveClass([{ startMin: 1080, endMin: 1140, subjectCode: "BETCE12302" }], NOW_18);
check("slot starting exactly now is ONGOING (not upcoming)", atStart?.kind === "ongoing" && atStart.mins === 60);

const upcomingSoon = todayLiveClass([{ startMin: 1110, endMin: 1140, subjectCode: "BETCE12302" }], NOW_18);
check("upcoming 30 min out → mins=30", upcomingSoon?.kind === "upcoming" && upcomingSoon.mins === 30);

const boundary90 = todayLiveClass([{ startMin: 1170, endMin: 1200, subjectCode: "X" }], NOW_18);
check("90 min out → upcoming (core is honest at any distance)", boundary90?.kind === "upcoming" && boundary90.mins === 90);

const beyond90 = todayLiveClass([{ startMin: 1171, endMin: 1200, subjectCode: "X" }], NOW_18);
check("91 min out STILL upcoming (no calm window in the core)", beyond90?.kind === "upcoming" && beyond90.mins === 91);

const farOut = todayLiveClass([{ startMin: 1080, endMin: 1140, subjectCode: "EVE" }], NOW_08);
check("18:00 class seen from 08:00 → upcoming 600 (the live-smoke bug, fixed)", farOut?.kind === "upcoming" && farOut.mins === 600);

const ongoing = todayLiveClass([{ startMin: 1050, endMin: 1140, subjectCode: "BETCE12302" }], NOW_18);
check("ongoing class → kind ongoing", ongoing?.kind === "ongoing");
check("ongoing mins counts to the END (60)", ongoing?.kind === "ongoing" && ongoing.mins === 60);
check("ongoing counts itself in leftCount", ongoing?.leftCount === 1);

const ongoingWins = todayLiveClass(
  [
    { startMin: 1050, endMin: 1140, subjectCode: "NOW" },
    { startMin: 1081, endMin: 1141, subjectCode: "LATER" },
  ],
  NOW_18
);
check("ongoing wins over upcoming (first remaining slot)", ongoingWins?.kind === "ongoing" && ongoingWins.cls.subjectCode === "NOW");

const allDone = todayLiveClass([{ startMin: 900, endMin: 960, subjectCode: "X" }], NOW_18);
check("all classes ended → null", allDone === null);

const mixedLeft = todayLiveClass(
  [
    { startMin: 900, endMin: 960, subjectCode: "PAST" },
    { startMin: 1050, endMin: 1140, subjectCode: "NOW" },
    { startMin: 1200, endMin: 1260, subjectCode: "FAR" },
  ],
  NOW_18
);
check("leftCount excludes ended classes (2 left)", mixedLeft?.leftCount === 2);
check("earliest remaining slot wins", mixedLeft?.cls.subjectCode === "NOW");

/* Chip variant: the 90-min calm window lives ONLY here. */
console.log("todayChipClass:");
check("chip: 91 min out → null (calm)", todayChipClass([{ startMin: 1171, endMin: 1200, subjectCode: "X" }], NOW_18) === null);
const chip90 = todayChipClass([{ startMin: 1170, endMin: 1200, subjectCode: "X" }], NOW_18);
check("chip: exactly 90 min out shows", chip90?.kind === "upcoming" && chip90.mins === 90);
const chipOngoing = todayChipClass([{ startMin: 1050, endMin: 1140, subjectCode: "X" }], NOW_18);
check("chip: ongoing always shows (no calm window)", chipOngoing?.kind === "ongoing");
check("chip: no data → null", todayChipClass(undefined, NOW_18) === null);

/* ------------------------------------------------------------------ */
/* buildTodaySms — the CLASSES line                                    */
/* ------------------------------------------------------------------ */

console.log("buildTodaySms CLASSES line:");
check("no timetable data → line honestly omitted", !sms(undefined).includes("CLASSES"));
check("null → line honestly omitted", !sms(null).includes("CLASSES"));
check("free day → 'none scheduled'", sms([]).includes("CLASSES TODAY none scheduled"));

const upText = sms([
  { startMin: 1110, endMin: 1140, subjectCode: "BETCE12302" },
  { startMin: 1170, endMin: 1200, subjectCode: "BETCE12304" },
]);
check(
  "upcoming line format",
  upText.includes("CLASSES TODAY 2 left - next 18:30 BETCE12302"),
  JSON.stringify(upText.split("\n"))
);
check("singular left", sms([{ startMin: 1110, endMin: 1140, subjectCode: "BETCE12302" }]).includes("CLASSES TODAY 1 left - next 18:30 BETCE12302"));

const onText = sms([
  { startMin: 1050, endMin: 1140, subjectCode: "BETCE12302" },
  { startMin: 1140, endMin: 1200, subjectCode: "BETCE12304" },
]);
check(
  "ongoing line format",
  onText.includes("CLASSES TODAY 2 left - in class BETCE12302 until 19:00"),
  JSON.stringify(onText.split("\n"))
);

check(
  "all done, one class → 'done (1 class)'",
  sms([{ startMin: 900, endMin: 960, subjectCode: "X" }]).includes("CLASSES TODAY done (1 class)")
);
check(
  "all done, two classes → 'all 2 done'",
  sms([
    { startMin: 900, endMin: 960, subjectCode: "X" },
    { startMin: 960, endMin: 1020, subjectCode: "Y" },
  ]).includes("CLASSES TODAY all 2 done")
);

const padText = sms([{ startMin: 545, endMin: 600, subjectCode: "BETCE12306" }], NOW_08);
check("hhmm zero-padding (09:05)", padText.includes("CLASSES TODAY 1 left - next 09:05 BETCE12306"));

/* Line position: schedule is time-sensitive → after the attendance block
   (BUDGET), before the worst-subjects roll-up (WORST). */
const orderText = sms(
  [{ startMin: 1110, endMin: 1140, subjectCode: "BETCE12302" }],
  NOW_18
);
const idxBudget = orderText.indexOf("BUDGET");
const idxClasses = orderText.indexOf("CLASSES TODAY");
const idxWorst = orderText.indexOf("WORST");
check("CLASSES line sits after BUDGET", idxBudget >= 0 && idxClasses > idxBudget);
check("CLASSES line sits before WORST", idxWorst === -1 || idxClasses < idxWorst);
check("exactly one CLASSES line", orderText.split("\n").filter((l) => l.startsWith("CLASSES")).length === 1);

/* GSM-7 honesty: the schedule line must keep the message SMS-ready. */
const seg = smsSegments(
  sms(
    [
      { startMin: 1110, endMin: 1140, subjectCode: "BETCE12302" },
      { startMin: 1170, endMin: 1200, subjectCode: "BETCE12304" },
    ]
  )
);
check("message stays GSM-7 with the classes line", seg.encoding === "GSM-7", `got ${seg.encoding}`);

/* Free-day SMS with the line present still encodes cleanly. */
check("free-day message stays GSM-7", smsSegments(sms([])).encoding === "GSM-7");

/* ------------------------------------------------------------------ */
/* Live-payload smoke — the REAL Saturday timetable (read-only GET)     */
/* ------------------------------------------------------------------ */

console.log("live smoke (real /api/timetable):");
try {
  const res = await fetch("http://localhost:3000/api/timetable");
  const tt = (await res.json()) as {
    slots: { dayOfWeek: number; startMin: number; endMin: number; subjectCode: string }[];
    picks: Record<string, string>;
  };
  /* Resolve "today" on the card's own IST clock (weekday number, Sun=0). */
  const wd = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short" })
    .format(new Date())
    .toUpperCase();
  const day = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].indexOf(wd);
  const attending = applyBatchPicks(tt.slots ?? [], tt.picks ?? {}).attending
    .filter((s) => s.dayOfWeek === day)
    .sort((a, b) => a.startMin - b.startMin)
    .map((s) => ({ startMin: s.startMin, endMin: s.endMin, subjectCode: s.subjectCode }));
  const liveText = sms(attending);
  const liveLine = liveText.split("\n").find((l) => l.startsWith("CLASSES"));
  console.log(`  today (${wd}) slots: ${attending.length} → line: ${liveLine ?? "(omitted)"}`);
  if (liveLine) {
    check(
      "live line matches a known shape",
      /^CLASSES TODAY (none scheduled|(\d+) left - (next \d{2}:\d{2} \S+|in class \S+ until \d{2}:\d{2})|all \d+ done|done \(1 class\))$/.test(liveLine),
      liveLine
    );
  } else {
    console.log("  (timetable empty — line honestly omitted, still valid)");
  }
} catch (e) {
  console.log(`  (server unreachable for live smoke — pure coverage above stands) ${String(e)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
