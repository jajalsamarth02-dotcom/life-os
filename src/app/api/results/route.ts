import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRawSetting, setRawSetting } from "@/lib/settings";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { compactErrorText } from "@/lib/compact-error";
import { fetchLiveResults } from "@/lib/erp/live";
import type { ErpResultsPayload } from "@/lib/erp/types";

/**
 * GET /api/results — published exam results (Final Results page).
 *
 * Results change rarely, so the live fetch is TTL-gated: the first request
 * after a cache miss performs the authorized read-only ERP walk (picker +
 * one GET per exam, paced) and caches the parsed payload in the Setting KV
 * (zero schema change); everything within the TTL is served instantly from
 * cache. `?refresh=1` forces a live refresh (the card's refresh button).
 *
 * Safety: display-only — this route never touches reminders, notifications,
 * digests or any WhatsApp path, and never writes to the ERP.
 */

const RESULTS_KEY = "results.snapshot";
const TTL_MS = 6 * 60 * 60 * 1000; // refresh at most every 6h (or ?refresh=1)

interface ResultsApiResponse {
  /** false = no ERP connection configured (results cannot be fetched). */
  available: boolean;
  fetchedAt: string | null;
  /** true = the payload served is a cached snapshot (fetch failed or stale). */
  stale: boolean;
  exams: ErpResultsPayload["exams"];
  note?: string;
}

function parsePayload(raw: string | null): ErpResultsPayload | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as ErpResultsPayload;
    return v && Array.isArray(v.exams) && typeof v.fetchedAt === "string" ? v : null;
  } catch {
    return null;
  }
}

function byExamDateDesc(
  a: { examDateKey: string | null; semester: number | null },
  b: { examDateKey: string | null; semester: number | null }
): number {
  if (a.examDateKey && b.examDateKey && a.examDateKey !== b.examDateKey) return b.examDateKey.localeCompare(a.examDateKey);
  if (a.examDateKey && !b.examDateKey) return -1;
  if (!a.examDateKey && b.examDateKey) return 1;
  return (b.semester ?? 0) - (a.semester ?? 0);
}

// In-flight dedup: concurrent tab loads share one live walk.
let inflight: Promise<ResultsApiResponse> | null = null;

async function loadResults(force: boolean): Promise<ResultsApiResponse> {
  const cached = parsePayload(await getRawSetting(RESULTS_KEY));
  if (cached && !force && Date.now() - new Date(cached.fetchedAt).getTime() < TTL_MS) {
    return { available: true, fetchedAt: cached.fetchedAt, stale: false, exams: [...cached.exams].sort(byExamDateDesc) };
  }

  const conn = await db.erpConnection.findFirst({ orderBy: { createdAt: "desc" } });
  if (!conn) {
    return {
      available: false,
      fetchedAt: cached?.fetchedAt ?? null,
      stale: true,
      exams: cached ? [...cached.exams].sort(byExamDateDesc) : [],
      note: "Connect your ERP account in Settings to load exam results.",
    };
  }

  let password: string;
  let savedCookie: string | null = null;
  try {
    password = decryptSecret(conn.secretEnc);
    if (conn.sessionCookieEnc) savedCookie = decryptSecret(conn.sessionCookieEnc);
  } catch {
    return {
      available: true,
      fetchedAt: cached?.fetchedAt ?? null,
      stale: true,
      exams: cached ? [...cached.exams].sort(byExamDateDesc) : [],
      note: "Stored credentials could not be decrypted.",
    };
  }

  try {
    const live = await fetchLiveResults(conn.username, password, savedCookie);
    if (live.sessionCookie) {
      await db.erpConnection.update({
        where: { id: conn.id },
        data: { sessionCookieEnc: encryptSecret(live.sessionCookie) },
      });
    }
    const payload: ErpResultsPayload = { exams: live.exams, fetchedAt: new Date().toISOString() };
    await setRawSetting(RESULTS_KEY, JSON.stringify(payload));
    return {
      available: true,
      fetchedAt: payload.fetchedAt,
      stale: false,
      exams: [...payload.exams].sort(byExamDateDesc),
      note: payload.exams.length === 0 ? "The ERP lists no published results yet." : undefined,
    };
  } catch (e) {
    const hint = compactErrorText(e instanceof Error ? e.message : String(e));
    if (cached) {
      return {
        available: true,
        fetchedAt: cached.fetchedAt,
        stale: true,
        exams: [...cached.exams].sort(byExamDateDesc),
        note: `Live refresh failed — showing the last fetched snapshot. ${hint}`,
      };
    }
    return {
      available: true,
      fetchedAt: null,
      stale: true,
      exams: [],
      note: `Could not load results from the ERP. ${hint}`,
    };
  }
}

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("refresh") === "1";
  if (inflight && !force) return NextResponse.json(await inflight);
  const task = loadResults(force).finally(() => {
    if (inflight === task) inflight = null;
  });
  inflight = task;
  return NextResponse.json(await task);
}
