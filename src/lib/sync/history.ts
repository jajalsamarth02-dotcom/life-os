import { db } from "@/lib/db";

/**
 * Attendance trend history. Snapshots are recorded after every successful
 * sync when values changed (plus a 6-hour freshness point so charts stay
 * continuous). subjectCode "__overall__" holds the weighted overall figure.
 */

export const OVERALL_KEY = "__overall__";
const STALE_MS = 6 * 3600 * 1000;
const PRUNE_DAYS = 90;
const BACKFILL_DAYS = 14;

/** Record a trend point for every active subject (+ overall) when needed. */
export async function recordSnapshots(source: "demo" | "live"): Promise<void> {
  const subjects = await db.subject.findMany({ where: { active: true } });
  if (subjects.length === 0) return;

  await maybeBackfill(source);

  const now = new Date();
  let anyRecorded = false;

  for (const s of subjects) {
    const last = await db.attendanceSnapshot.findFirst({
      where: { subjectCode: s.code },
      orderBy: { capturedAt: "desc" },
    });
    const changed = !!last && (last.present !== s.present || last.total !== s.total);
    const stale = !last || now.getTime() - last.capturedAt.getTime() > STALE_MS;
    if (!last || changed || stale) {
      await db.attendanceSnapshot.create({
        data: { subjectCode: s.code, present: s.present, total: s.total, source, capturedAt: now },
      });
      anyRecorded = true;
    }
  }

  if (anyRecorded) {
    const present = subjects.reduce((a, s) => a + s.present, 0);
    const total = subjects.reduce((a, s) => a + s.total, 0);
    if (total > 0) {
      await db.attendanceSnapshot.create({
        data: { subjectCode: OVERALL_KEY, present, total, source, capturedAt: now },
      });
    }
  }
}

/** Occasionally prune snapshots older than the retention window. */
export async function pruneSnapshots(): Promise<void> {
  if (Math.random() >= 0.1) return;
  const cutoff = new Date(Date.now() - PRUNE_DAYS * 24 * 3600 * 1000);
  await db.attendanceSnapshot.deleteMany({ where: { capturedAt: { lt: cutoff } } });
}

/**
 * Seed a plausible 14-day history the first time demo mode records a trend,
 * ending exactly at the current values, so the trend chart is meaningful
 * immediately. Live mode never backfills — real history accrues honestly.
 */
async function maybeBackfill(source: "demo" | "live"): Promise<void> {
  if (source !== "demo") return;
  const count = await db.attendanceSnapshot.count();
  if (count > 0) return;

  const subjects = await db.subject.findMany({ where: { active: true } });
  if (subjects.length === 0) return;

  const now = Date.now();
  const days = BACKFILL_DAYS;

  // start values: slightly behind current (plausible semester progress)
  const starts = subjects.map((s) => {
    const driftT = 0.1 + Math.random() * 0.12;
    const startTotal = Math.max(1, Math.round(s.total * (1 - driftT)));
    const startPresent = Math.min(startTotal, Math.round(s.present * (startTotal / s.total)));
    return { subject: s, p: startPresent, t: startTotal };
  });

  // daily increments that land exactly on current values
  const increments = starts.map(({ subject, p, t }) => {
    const dT = subject.total - t;
    const dP = Math.max(0, subject.present - p);
    const inc: { dp: number; dt: number }[] = [];
    let leftT = dT;
    let leftP = dP;
    for (let i = 0; i < days; i++) {
      const isLast = i === days - 1;
      const perDay = Math.ceil(dT / days) + 1;
      const dt = isLast ? leftT : Math.min(leftT, Math.floor(Math.random() * perDay));
      const dp = isLast ? leftP : Math.min(leftP, dt, Math.floor(Math.random() * (dt + 1)));
      inc.push({ dp, dt });
      leftT -= dt;
      leftP -= dp;
    }
    return { code: subject.code, from: { p, t }, inc };
  });

  const rows: {
    subjectCode: string;
    present: number;
    total: number;
    source: string;
    capturedAt: Date;
  }[] = [];

  for (let i = 1; i <= days; i++) {
    const capturedAt = new Date(now - (days - i) * 24 * 3600 * 1000);
    if (i === days) {
      // Final (today) point: stamp it just before "now" so it can never land in
      // the future or AFTER the real sync points that follow it the same day —
      // otherwise the chart's "latest" value would be the stale backfill figure.
      capturedAt.setTime(now - 60 * 1000);
    } else {
      capturedAt.setHours(9 + Math.floor(Math.random() * 7), Math.floor(Math.random() * 60), 0, 0);
    }
    let sumP = 0;
    let sumT = 0;
    for (const inc of increments) {
      // cumulative increments up to day i
      const cum = inc.inc.slice(0, i).reduce((a, d) => ({ dp: a.dp + d.dp, dt: a.dt + d.dt }), { dp: 0, dt: 0 });
      const p = inc.from.p + cum.dp;
      const t = Math.max(1, inc.from.t + cum.dt);
      rows.push({ subjectCode: inc.code, present: p, total: t, source: "demo", capturedAt: new Date(capturedAt) });
      sumP += p;
      sumT += t;
    }
    rows.push({ subjectCode: OVERALL_KEY, present: sumP, total: sumT, source: "demo", capturedAt: new Date(capturedAt) });
  }

  await db.attendanceSnapshot.createMany({ data: rows });
}
