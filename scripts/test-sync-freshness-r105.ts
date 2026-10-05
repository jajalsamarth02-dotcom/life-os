/**
 * r105 — "the brief carries its own freshness": lib/sync-freshness, the ONE
 * freshness rulebook extracted from the header's inline table, now feeding
 * the header chip AND the today-card bubble.
 *
 * Origin (the incident, act II): 39h of failed syncs (keyless boots after
 * the r104 cron commit stripped .env) and the hero surface kept an emerald
 * bubble saying "SYNCED 23:02 IST" — no weekday, no age, no tone. Pinned
 * here:
 *   • syncFreshness — the byte-equal decision table (syncing → fresh;
 *     failures → degraded; no instant → none; ≤22 min → fresh; else stale),
 *     including the exact boundaries
 *   • freshnessAgeLabel — the compact ASCII ladder (just now / m / h / d),
 *     floor-based, clock-skew-safe
 *   • syncedBriefLine — weekday + hh:mm + age composition, and the legacy
 *     "not yet" fallback kept byte-identical
 *   • buildTodaySms integration — the SYNCED line renders the new voice;
 *     smsLineParts still splits it (keyword "SYNCED", rest intact)
 *   • BUBBLE_FRESH_CLASS — every freshness verdict has paint; the four
 *     surfaces (frame/tail/keyword/caption) are one decision
 *
 * Fixtures: 2026-10-03 is a Saturday, 2026-10-05 a Monday; IST = UTC+5:30.
 * usage: bun scripts/test-sync-freshness-r105.ts
 */
import {
  syncFreshness,
  freshnessAgeLabel,
  syncedBriefLine,
  SYNC_FRESH_LIMIT_MIN,
} from "../src/lib/sync-freshness";
import {
  buildTodaySms,
  smsLineParts,
  BUBBLE_FRESH_CLASS,
  type TodaySmsInput,
} from "../src/components/erp/today-card";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    passed++;
    console.log(`PASS: ${name}`);
  } else {
    failed++;
    console.error(`FAIL: ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

const NOW = Date.UTC(2026, 9, 5, 8, 45, 0); // Mon 05 Oct 2026, 14:15 IST
const MIN = 60_000;

/* 1. syncFreshness — the byte-equal decision table */
check("threshold constant is 22 (one 15-min cadence + 7-min grace)", SYNC_FRESH_LIMIT_MIN === 22);
check("syncing beats everything → fresh", syncFreshness(NOW, null, 3, true) === "fresh");
check("failures > 0 → degraded (even with a fresh success)", syncFreshness(NOW, NOW - 5 * MIN, 1, false) === "degraded");
check("failures with old success → degraded (the 39h incident state)", syncFreshness(NOW, NOW - 39 * 60 * MIN, 2, false) === "degraded");
check("no instant, no failures → none", syncFreshness(NOW, null, 0, false) === "none");
check("age exactly 22 min → fresh (<= boundary)", syncFreshness(NOW, NOW - 22 * MIN, 0, false) === "fresh");
check("age 22.1 min → stale", syncFreshness(NOW, NOW - 22.1 * MIN, 0, false) === "stale");
check("age 0 → fresh", syncFreshness(NOW, NOW, 0, false) === "fresh");
check("age 39h, no failures → stale", syncFreshness(NOW, NOW - 39 * 60 * MIN, 0, false) === "stale");
check("string instant accepted (ISO)", syncFreshness(NOW, new Date(NOW - 30 * MIN).toISOString(), 0, false) === "stale");

/* 2. freshnessAgeLabel — the compact ladder */
check("sub-minute → just now", freshnessAgeLabel(NOW, NOW - 59_000) === "just now");
check("clock skew (future instant) → just now", freshnessAgeLabel(NOW, NOW + 5 * MIN) === "just now");
check("exactly 60s → 1m ago", freshnessAgeLabel(NOW, NOW - 60_000) === "1m ago");
check("59m → 59m ago (floor, no rounding up)", freshnessAgeLabel(NOW, NOW - 59.9 * MIN) === "59m ago");
check("exactly 1h → 1h ago", freshnessAgeLabel(NOW, NOW - 3600_000) === "1h ago");
check("39h → 39h ago (the incident age)", freshnessAgeLabel(NOW, NOW - 39 * 3600_000) === "39h ago");
check("just under 48h → 47h ago", freshnessAgeLabel(NOW, NOW - 47.9 * 3600_000) === "47h ago");
check("48h+ → days", freshnessAgeLabel(NOW, NOW - 48 * 3600_000) === "2d ago");
check("3.9d floors → 3d ago", freshnessAgeLabel(NOW, NOW - 3.9 * 86400_000) === "3d ago");

/* 3. syncedBriefLine — the composition */
check(
  "fresh sync reads weekday + hh:mm + just now",
  syncedBriefLine(NOW, new Date(NOW - 30_000).toISOString()) === "SYNCED MON 14:14 IST (just now) - erp.gmiu.edu.in"
);
check(
  "the incident voice: SAT stamp with the 39h age",
  syncedBriefLine(NOW, new Date(Date.UTC(2026, 9, 3, 17, 32, 34)).toISOString()) ===
    "SYNCED SAT 23:02 IST (39h ago) - erp.gmiu.edu.in"
);
check(
  "null instant → legacy 'not yet' fallback byte-identical",
  syncedBriefLine(NOW, null) === "SYNCED not yet IST - erp.gmiu.edu.in"
);
{
  const line = syncedBriefLine(NOW, new Date(NOW - 2 * 86400_000).toISOString());
  check("multi-day age reads days", /\(2d ago\)/.test(line), line);
  check("line is ASCII-only", /^[\x20-\x7E]+$/.test(line), line);
}

/* 4. buildTodaySms integration — the brief carries its own freshness */
const base = {
  now: NOW,
  overall: { present: 3, total: 6, percentage: 50, status: "danger" } as TodaySmsInput["overall"],
  target: 75,
  subjects: [],
  warningSubjects: 0,
  alaPending: 41,
  alaTotal: 47,
  alaOverdue: 17,
  alaDueWeek: 2,
  nextDue: null,
  notedCount: 0,
  todayClasses: null,
  weekSlots: null,
} as TodaySmsInput;
{
  const sms = buildTodaySms({ ...base, lastSyncAt: new Date(Date.UTC(2026, 9, 3, 17, 32, 34)).toISOString() });
  const line = sms.split("\n").find((l) => l.startsWith("SYNCED")) ?? "";
  check(
    "SMS brief prints the incident voice (weekday + age)",
    line === "SYNCED SAT 23:02 IST (39h ago) - erp.gmiu.edu.in",
    line
  );
  const parts = smsLineParts(line);
  check("splitter still splits the new line (keyword SYNCED)", parts?.keyword === "SYNCED" && parts.rest.startsWith(" SAT 23:02"), JSON.stringify(parts));
  check("whole brief stays ASCII-only", /^[\x20-\x7E\n]+$/.test(sms));
  const legacy = buildTodaySms({ ...base, lastSyncAt: null });
  check(
    "unsynced brief keeps the legacy line byte-identical",
    (legacy.split("\n").find((l) => l.startsWith("SYNCED")) ?? "") === "SYNCED not yet IST - erp.gmiu.edu.in"
  );
}

/* 5. BUBBLE_FRESH_CLASS — every verdict has paint, four surfaces one decision */
{
  const verdicts = ["fresh", "stale", "degraded", "none"] as const;
  let allPainted = true;
  for (const v of verdicts) {
    const c = BUBBLE_FRESH_CLASS[v];
    if (!c.frame || !c.tail || !c.keyword || !c.caption) allPainted = false;
  }
  check("all four verdicts carry full paint", allPainted);
  check(
    "stale is amber, degraded red, fresh emerald (the header ladder)",
    BUBBLE_FRESH_CLASS.stale.frame.includes("amber") &&
      BUBBLE_FRESH_CLASS.degraded.frame.includes("red") &&
      BUBBLE_FRESH_CLASS.fresh.frame.includes("emerald")
  );
  check(
    "tail shares the frame's hue (one cohesive paint)",
    BUBBLE_FRESH_CLASS.stale.tail.includes("amber") && BUBBLE_FRESH_CLASS.degraded.tail.includes("red")
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
