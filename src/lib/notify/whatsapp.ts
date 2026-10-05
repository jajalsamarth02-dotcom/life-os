import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { ASSIGNMENT_EXT_PREFIX } from "@/lib/sync/engine";
import { resolveWaSaveInput } from "@/lib/wa-pair";

/**
 * WhatsApp alerts for pending work — personal-project grade via CallMeBot
 * (https://www.callmebot.com/blog/free-api-for-send-whatsapp-messages/).
 *
 * The student pairs their own WhatsApp with the CallMeBot once and pastes the
 * resulting phone + apikey here. Nothing is sent until both are configured
 * AND the feature is enabled — honest by design (spec #6/#13: no fake sends).
 *
 * Secrets (phone, apikey) are stored AES-256-GCM encrypted in ONE Setting row
 * ("notify.wa.enc") — same at-rest protection as the ERP credentials (#10).
 */

const SETTING_ENC = "notify.wa.enc";
const SETTING_ENABLED = "notify.wa.enabled";
const SETTING_LAST_AUTO = "notify.wa.lastAutoAt";
const SETTING_LAST_COUNT = "notify.wa.lastPendingCount";
const SETTING_LAST_RESULT = "notify.wa.lastResult";
const SETTING_DIGEST_TIME = "notify.wa.digestTime";
const SETTING_LAST_DIGEST_DAY = "notify.wa.lastDigestDay";

/** IST date helpers — the daily digest anchors to India/Kolkata wall-clock time. */
const IST_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function istNow(): { day: string; minutes: number } {
  const parts = Object.fromEntries(IST_PARTS.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const hour = parseInt(parts.hour === "24" ? "0" : parts.hour, 10);
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return { day, minutes: hour * 60 + parseInt(parts.minute, 10) };
}

export interface WaConfig {
  /** International format without + (CallMeBot), e.g. 9198XXXXXXXX. */
  phone: string;
  apikey: string;
}

export interface WaStatus {
  enabled: boolean;
  configured: boolean;
  phoneMasked: string | null;
  lastAutoAt: string | null;
  lastPendingCount: number | null;
  lastResult: string | null;
  /** "HH:MM" in IST when a fixed daily digest is scheduled; null = sync-triggered only. */
  digestTime: string | null;
}

async function getRawSetting(key: string): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

async function setRawSetting(key: string, value: string): Promise<void> {
  await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function getWaConfig(): Promise<WaConfig | null> {
  const enc = await getRawSetting(SETTING_ENC);
  if (!enc) return null;
  try {
    const parsed = JSON.parse(decryptSecret(enc)) as Partial<WaConfig>;
    if (!parsed.phone || !parsed.apikey) return null;
    return { phone: parsed.phone, apikey: parsed.apikey };
  } catch {
    return null;
  }
}

export async function saveWaConfig(input: { phone?: string; apikey: string; enabled?: boolean }): Promise<void> {
  // Normalize: digits only; Indian 10-digit numbers get the 91 prefix.
  // A repair (r109) may omit the phone — the saved one is the student's OWN
  // paired number and stays unless they type a different one (resolveWaSaveInput
  // is the test-pinned rulebook; first-time setup still requires a phone).
  const existing = await getWaConfig();
  const resolved = resolveWaSaveInput({
    phone: input.phone ?? null,
    apikey: input.apikey,
    existingPhone: existing?.phone ?? null,
  });
  const { phone, apikey } = resolved;
  await setRawSetting(SETTING_ENC, encryptSecret(JSON.stringify({ phone, apikey })));
  if (typeof input.enabled === "boolean") {
    await setRawSetting(SETTING_ENABLED, input.enabled ? "1" : "0");
  }
}

export async function setWaEnabled(enabled: boolean): Promise<void> {
  await setRawSetting(SETTING_ENABLED, enabled ? "1" : "0");
}

/**
 * Set (or clear) the fixed daily digest time, "HH:MM" in IST.
 * Clearing also resets the once-per-day latch so a freshly chosen later
 * time can still fire on the same day.
 */
export async function setWaDigestTime(time: string | null): Promise<void> {
  if (time === null || time === "") {
    await db.setting.deleteMany({ where: { key: { in: [SETTING_DIGEST_TIME, SETTING_LAST_DIGEST_DAY] } } });
    return;
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error("Digest time must be HH:MM (24h), e.g. 20:30.");
  }
  await setRawSetting(SETTING_DIGEST_TIME, time);
}

export async function getWaStatus(): Promise<WaStatus> {
  const [enabled, config, lastAutoAt, lastCount, lastResult, digestTime] = await Promise.all([
    getRawSetting(SETTING_ENABLED),
    getWaConfig(),
    getRawSetting(SETTING_LAST_AUTO),
    getRawSetting(SETTING_LAST_COUNT),
    getRawSetting(SETTING_LAST_RESULT),
    getRawSetting(SETTING_DIGEST_TIME),
  ]);
  const phone = config?.phone ?? null;
  return {
    enabled: enabled === "1",
    configured: !!config,
    phoneMasked: phone ? `${phone.slice(0, 2)}${"*".repeat(Math.max(0, phone.length - 4))}${phone.slice(-2)}` : null,
    lastAutoAt,
    lastPendingCount: lastCount ? parseInt(lastCount, 10) : null,
    lastResult,
    digestTime: digestTime && /^([01]\d|2[0-3]):[0-5]\d$/.test(digestTime) ? digestTime : null,
  };
}

/** Fire-and-forget text via CallMeBot. Returns the provider's response snippet. */
export async function sendWhatsAppText(text: string): Promise<{ ok: boolean; snippet: string }> {
  const config = await getWaConfig();
  if (!config) return { ok: false, snippet: "Not configured — add your CallMeBot phone + apikey first." };
  const url =
    `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(config.phone)}` +
    `&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(config.apikey)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const body = (await res.text().catch(() => "")).replace(/\s+/g, " ").trim();
    // CallMeBot answers 200 with "Message queued" on success.
    const ok = res.ok && /queued|sent|success/i.test(body);
    return { ok, snippet: body.slice(0, 160) || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, snippet: e instanceof Error ? e.message : "WhatsApp request failed" };
  }
}

/** Compact pending-work digest (server-side twin of the dashboard digest). */
export async function buildPendingDigest(): Promise<string> {
  const now = Date.now();
  const rows = await db.reminder.findMany({
    where: { type: "ASSIGNMENT", status: "ACTIVE", externalId: { startsWith: ASSIGNMENT_EXT_PREFIX } },
    orderBy: { dueAt: "asc" },
  });
  const overdue = rows.filter((r) => r.dueAt.getTime() < now);
  const upcoming = rows.filter((r) => r.dueAt.getTime() >= now);

  const fmt = (d: Date) =>
    d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

  const lines: string[] = [];
  if (rows.length === 0) {
    lines.push("✅ ERP Sync: no pending ALA/assignments — all clear!");
  } else {
    lines.push(
      `📚 ERP Sync: ${rows.length} pending ALA/assignment${rows.length === 1 ? "" : "s"}` +
        (overdue.length ? ` (${overdue.length} overdue ⚠️)` : "")
    );
    const worst = new Map<string, number>();
    for (const r of overdue) {
      const code = r.subjectCode ?? "?";
      worst.set(code, (worst.get(code) ?? 0) + 1);
    }
    for (const [code, n] of [...worst.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
      lines.push(`⚠️ ${code}: ${n} overdue`);
    }
    for (const r of upcoming.slice(0, 3)) {
      const days = Math.ceil((r.dueAt.getTime() - now) / 86_400_000);
      lines.push(`• ${r.title} [${r.subjectCode ?? "?"}] — due ${fmt(r.dueAt)} (in ${days}d)`);
    }
  }
  const actives = await db.reminder.count({ where: { status: "ACTIVE", type: { not: "ASSIGNMENT" } } });
  if (actives > 0) lines.push(`🔔 ${actives} other active reminder${actives === 1 ? "" : "s"}`);
  return lines.join("\n");
}

export async function sendPendingDigest(
  trigger: "manual" | "auto"
): Promise<{ ok: boolean; snippet: string; text: string }> {
  const text = await buildPendingDigest();
  const result = await sendWhatsAppText(text);
  await setRawSetting(
    SETTING_LAST_RESULT,
    `${new Date().toISOString()} ${trigger === "auto" ? "(auto)" : "(manual)"} → ${result.ok ? "sent" : "FAILED"}: ${result.snippet}`
  );
  if (trigger === "auto") {
    await setRawSetting(SETTING_LAST_AUTO, new Date().toISOString());
    await setRawSetting(SETTING_LAST_COUNT, String(await countPendingAla()));
  }
  return { ...result, text };
}

async function countPendingAla(): Promise<number> {
  return db.reminder.count({
    where: { type: "ASSIGNMENT", status: "ACTIVE", externalId: { startsWith: ASSIGNMENT_EXT_PREFIX } },
  });
}

/**
 * Fixed-time daily digest, anchored to IST wall-clock time. Called once a
 * minute by the background scheduler. Fires at most once per IST day (a
 * day-latch makes up missed minutes fire late instead of never, e.g. after
 * a server restart), regardless of whether anything changed — that is the
 * point of a daily digest. Never throws.
 */
export async function maybeDailyDigest(): Promise<void> {
  try {
    const [enabled, config, timeStr] = await Promise.all([
      getRawSetting(SETTING_ENABLED),
      getWaConfig(),
      getRawSetting(SETTING_DIGEST_TIME),
    ]);
    if (enabled !== "1" || !config || !timeStr || !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeStr)) return;

    const { day, minutes } = istNow();
    const lastDay = await getRawSetting(SETTING_LAST_DIGEST_DAY);
    if (lastDay === day) return;

    const [h, m] = timeStr.split(":").map(Number);
    if (minutes < h * 60 + m) return; // not yet due today

    await sendPendingDigest("auto");
    await setRawSetting(SETTING_LAST_DIGEST_DAY, day);
  } catch (e) {
    console.error("[erp-sync] whatsapp daily digest failed:", e);
  }
}

/**
 * Auto-notify after a scheduled sync. Sends at most once every 24h, and only
 * when the pending count changed since the previous auto send (or something
 * is overdue). Never throws — a notification hiccup must not fail a sync.
 */
export async function maybeAutoNotify(): Promise<void> {
  try {
    const [enabled, config] = await Promise.all([getRawSetting(SETTING_ENABLED), getWaConfig()]);
    if (enabled !== "1" || !config) return;

    const now = Date.now();
    const rows = await db.reminder.findMany({
      where: { type: "ASSIGNMENT", status: "ACTIVE", externalId: { startsWith: ASSIGNMENT_EXT_PREFIX } },
      select: { dueAt: true },
    });
    const pending = rows.length;
    const hasOverdue = rows.some((r) => r.dueAt.getTime() < now);

    const lastAuto = await getRawSetting(SETTING_LAST_AUTO);
    const lastCount = (await getRawSetting(SETTING_LAST_COUNT)) ?? "-1";
    const hoursSince = lastAuto ? (now - new Date(lastAuto).getTime()) / 3_600_000 : Infinity;
    if (hoursSince < 24) return;

    const changed = String(pending) !== lastCount;
    if (!changed && !hasOverdue) return;

    await sendPendingDigest("auto");
  } catch (e) {
    console.error("[erp-sync] whatsapp auto-notify failed:", e);
  }
}
