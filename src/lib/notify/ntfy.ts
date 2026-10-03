import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { ASSIGNMENT_EXT_PREFIX } from "@/lib/sync/engine";

/**
 * Push notifications via ntfy (https://ntfy.sh) — the free, credential-less
 * second channel alongside the WhatsApp/CallMeBot one.
 *
 * How it works for the student: install the ntfy app (or open the web app),
 * subscribe to a long random topic name, and paste that topic here. The
 * server then POSTs digests to https://ntfy.sh/<topic> and the phone buzzes.
 *
 * Honest by design (spec #6/#13): nothing is ever sent while unconfigured or
 * disabled — exactly like the WhatsApp channel. A self-hosted ntfy server is
 * supported via an optional server URL.
 *
 * Secrets: the topic + server are stored AES-256-GCM encrypted in ONE Setting
 * row ("notify.ntfy.enc") — same at-rest protection as ERP credentials (#10).
 * The topic IS a capability (anyone who knows it can push to the phone), so
 * the UI nudges toward long random topics.
 */

const SETTING_ENC = "notify.ntfy.enc";
const SETTING_ENABLED = "notify.ntfy.enabled";
const SETTING_LAST_AUTO = "notify.ntfy.lastAutoAt";
const SETTING_LAST_COUNT = "notify.ntfy.lastPendingCount";
const SETTING_LAST_RESULT = "notify.ntfy.lastResult";
const SETTING_DIGEST_TIME = "notify.ntfy.digestTime";
const SETTING_LAST_DIGEST_DAY = "notify.ntfy.lastDigestDay";

const DEFAULT_SERVER = "https://ntfy.sh";

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

export interface NtfyConfig {
  /** ntfy topic — the capability. Long + random recommended. */
  topic: string;
  /** Base URL of the ntfy server (default https://ntfy.sh). */
  server: string;
}

export interface NtfyStatus {
  enabled: boolean;
  configured: boolean;
  topicMasked: string | null;
  serverHost: string | null;
  isDefaultServer: boolean;
  lastAutoAt: string | null;
  lastPendingCount: number | null;
  lastResult: string | null;
  /** "HH:MM" in IST when a fixed daily digest is scheduled; null = sync-triggered only. */
  digestTime: string | null;
}

const TOPIC_RE = /^[A-Za-z0-9_-]{1,64}$/;

function normalizeServer(raw: string | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return DEFAULT_SERVER;
  let url: URL;
  try {
    url = new URL(s.startsWith("http") ? s : `https://${s}`);
  } catch {
    throw new Error("Server must be a valid URL, e.g. https://ntfy.sh.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Server must start with http:// or https://.");
  }
  return url.origin;
}

async function getRawSetting(key: string): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

async function setRawSetting(key: string, value: string): Promise<void> {
  await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function getNtfyConfig(): Promise<NtfyConfig | null> {
  const enc = await getRawSetting(SETTING_ENC);
  if (!enc) return null;
  try {
    const parsed = JSON.parse(decryptSecret(enc)) as Partial<NtfyConfig>;
    if (!parsed.topic || !TOPIC_RE.test(parsed.topic)) return null;
    return { topic: parsed.topic, server: parsed.server || DEFAULT_SERVER };
  } catch {
    return null;
  }
}

export async function saveNtfyConfig(input: { topic: string; server?: string; enabled?: boolean }): Promise<void> {
  const topic = input.topic.trim();
  if (!TOPIC_RE.test(topic)) {
    throw new Error("Topic must be 1-64 letters, digits, - or _ (no spaces) — e.g. erp-sync-x7k2a9.");
  }
  const server = normalizeServer(input.server);
  await setRawSetting(SETTING_ENC, encryptSecret(JSON.stringify({ topic, server })));
  if (typeof input.enabled === "boolean") {
    await setRawSetting(SETTING_ENABLED, input.enabled ? "1" : "0");
  }
}

export async function setNtfyEnabled(enabled: boolean): Promise<void> {
  await setRawSetting(SETTING_ENABLED, enabled ? "1" : "0");
}

/** Set (or clear) the fixed daily digest time, "HH:MM" in IST. Same rules as WhatsApp. */
export async function setNtfyDigestTime(time: string | null): Promise<void> {
  if (time === null || time === "") {
    await db.setting.deleteMany({ where: { key: { in: [SETTING_DIGEST_TIME, SETTING_LAST_DIGEST_DAY] } } });
    return;
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error("Digest time must be HH:MM (24h), e.g. 20:30.");
  }
  await setRawSetting(SETTING_DIGEST_TIME, time);
}

function maskTopic(topic: string): string {
  if (topic.length <= 6) return `${topic.slice(0, 1)}***`;
  return `${topic.slice(0, 3)}***${topic.slice(-3)}`;
}

export async function getNtfyStatus(): Promise<NtfyStatus> {
  const [enabled, config, lastAutoAt, lastCount, lastResult, digestTime] = await Promise.all([
    getRawSetting(SETTING_ENABLED),
    getNtfyConfig(),
    getRawSetting(SETTING_LAST_AUTO),
    getRawSetting(SETTING_LAST_COUNT),
    getRawSetting(SETTING_LAST_RESULT),
    getRawSetting(SETTING_DIGEST_TIME),
  ]);
  return {
    enabled: enabled === "1",
    configured: !!config,
    topicMasked: config ? maskTopic(config.topic) : null,
    serverHost: config ? new URL(config.server).host : null,
    isDefaultServer: config?.server === DEFAULT_SERVER,
    lastAutoAt,
    lastPendingCount: lastCount ? parseInt(lastCount, 10) : null,
    lastResult,
    digestTime: digestTime && /^([01]\d|2[0-3]):[0-5]\d$/.test(digestTime) ? digestTime : null,
  };
}

/** Fire-and-forget push via ntfy's JSON endpoint. Returns the server's response snippet. */
export async function sendNtfyText(text: string, title?: string): Promise<{ ok: boolean; snippet: string }> {
  const config = await getNtfyConfig();
  if (!config) return { ok: false, snippet: "Not configured — save an ntfy topic first." };
  try {
    const res = await fetch(config.server, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: config.topic,
        title: title ?? "ERP Sync",
        body: text,
        tags: ["graduation_cap"],
        // Markdown is intentionally NOT enabled — plain text renders everywhere.
      }),
      signal: AbortSignal.timeout(12_000),
    });
    const body = (await res.text().catch(() => "")).replace(/\s+/g, " ").trim();
    // ntfy replies 200 with a JSON event object on success.
    const ok = res.ok;
    return { ok, snippet: (body || `HTTP ${res.status}`).slice(0, 160) };
  } catch (e) {
    return { ok: false, snippet: e instanceof Error ? e.message : "ntfy request failed" };
  }
}

async function countPendingAla(): Promise<number> {
  return db.reminder.count({
    where: { type: "ASSIGNMENT", status: "ACTIVE", externalId: { startsWith: ASSIGNMENT_EXT_PREFIX } },
  });
}

/** Compact pending-work digest — reuses the EXACT WhatsApp digest text so both channels agree. */
export async function sendNtfyPendingDigest(
  trigger: "manual" | "auto"
): Promise<{ ok: boolean; snippet: string; text: string }> {
  const { buildPendingDigest } = await import("@/lib/notify/whatsapp");
  const text = await buildPendingDigest();
  const result = await sendNtfyText(text, "ERP Sync — pending work");
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

/**
 * Fixed-time daily digest for ntfy, anchored to IST wall-clock. Same day-latch
 * pattern as the WhatsApp digest (fires late, never never, after downtime).
 * Channels are independent: a disabled/unconfigured WhatsApp never blocks ntfy.
 * Never throws.
 */
export async function maybeNtfyDailyDigest(): Promise<void> {
  try {
    const [enabled, config, timeStr] = await Promise.all([
      getRawSetting(SETTING_ENABLED),
      getNtfyConfig(),
      getRawSetting(SETTING_DIGEST_TIME),
    ]);
    if (enabled !== "1" || !config || !timeStr || !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeStr)) return;

    const { day, minutes } = istNow();
    const lastDay = await getRawSetting(SETTING_LAST_DIGEST_DAY);
    if (lastDay === day) return;

    const [h, m] = timeStr.split(":").map(Number);
    if (minutes < h * 60 + m) return; // not yet due today

    await sendNtfyPendingDigest("auto");
    await setRawSetting(SETTING_LAST_DIGEST_DAY, day);
  } catch (e) {
    console.error("[erp-sync] ntfy daily digest failed:", e);
  }
}

/**
 * Auto-notify after a scheduled sync on the ntfy channel. Mirrors the
 * WhatsApp policy: at most once per 24h, only when the pending count changed
 * or something is overdue — with ntfy's OWN latches. Never throws.
 */
export async function maybeNtfyAutoNotify(): Promise<void> {
  try {
    const [enabled, config] = await Promise.all([getRawSetting(SETTING_ENABLED), getNtfyConfig()]);
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

    await sendNtfyPendingDigest("auto");
  } catch (e) {
    console.error("[erp-sync] ntfy auto-notify failed:", e);
  }
}
