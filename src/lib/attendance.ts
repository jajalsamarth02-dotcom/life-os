/**
 * Pure attendance calculations. Nothing here touches the DB — every derived
 * number on the dashboard is recalculated from (present, total, target).
 */

export type AttendanceStatus = "safe" | "warning" | "danger" | "none";

export function attendancePercentage(present: number, total: number): number {
  if (total <= 0) return 0;
  return (present / total) * 100;
}

/**
 * Classes the student must attend consecutively so that
 * (present + x) / (total + x) >= target/100  →  x >= (target·total − 100·present) / (100 − target)
 */
export function classesToReachTarget(present: number, total: number, targetPct: number): number {
  const t = targetPct / 100;
  if (t >= 1) return Infinity;
  if (total > 0 && present / total >= t) return 0;
  const need = (t * total - present) / (1 - t);
  if (need <= 0) return 0;
  return Math.ceil(need);
}

/**
 * Classes that can be missed while staying at/above target:
 * present / (total + y) >= target/100  →  y <= 100·present/target − total
 */
export function classesCanSkip(present: number, total: number, targetPct: number): number {
  const t = targetPct / 100;
  if (t <= 0) return Infinity;
  if (total === 0) return 0;
  if (present / total < t) return 0;
  const y = present / t - total;
  return Math.max(0, Math.floor(y));
}

export function attendanceStatus(pct: number, targetPct: number, total = 1): AttendanceStatus {
  if (total <= 0) return "none";
  if (pct >= targetPct) return "safe";
  if (pct >= targetPct - 5) return "warning";
  return "danger";
}

export interface AttendanceView {
  present: number;
  total: number;
  absent: number;
  percentage: number;
  status: AttendanceStatus;
  classesToTarget: number;
  canSkip: number;
}

export function buildAttendanceView(
  present: number,
  total: number,
  targetPct: number
): AttendanceView {
  const pct = attendancePercentage(present, total);
  return {
    present,
    total,
    absent: Math.max(0, total - present),
    percentage: pct,
    status: attendanceStatus(pct, targetPct, total),
    classesToTarget: classesToReachTarget(present, total, targetPct),
    canSkip: classesCanSkip(present, total, targetPct),
  };
}

export function fmtPct(n: number): string {
  return `${n.toFixed(2)}%`;
}
