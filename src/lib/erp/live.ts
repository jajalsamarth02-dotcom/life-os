import {
  ErpSnapshot,
  ErpSubjectSnapshot,
  SyncError,
  ReminderType,
} from "./types";

/**
 * LIVE ERP connector for https://erp.gmiu.edu.in (Gyanmanjari Innovative University).
 *
 * The ERP exposes no official public API, so this connector performs an
 * *authorized session-based* integration using the student's own credentials:
 *   1. GET  /student/login            → collect session cookie + CSRF `_token`
 *   2. POST /student/login            → authenticate (email, password, _token)
 *   3. GET  /student/dashboard (+ attendance pages) → scrape attendance tables
 *
 * Ethics & limits enforced here:
 *   - Credentials live only on the server (AES-256-GCM encrypted at rest).
 *   - No CAPTCHA / MFA / rate-limit bypass: if a CAPTCHA is detected we stop
 *     and report `CAPTCHA_DETECTED`.
 *   - If the page structure cannot be parsed reliably we report `PARSE_FAILED`
 *     and change nothing locally — we never invent data.
 */

const BASE = "https://erp.gmiu.edu.in";
const LOGIN_PATH = "/student/login";
const DASHBOARD_PATH = "/student/dashboard";
const ATTENDANCE_PATHS = [
  "/student/attendance",
  "/student/attendance-report",
  "/student/attandance",
  "/student/subject-attendance",
  "/student/attendance/view",
];
/** The student profile carries the "Semester: Sem N" academic info. */
const PROFILE_PATHS = ["/student/profile"];
const REQUEST_TIMEOUT_MS = 15000;
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 ERPStudentSync/1.0";

export interface LiveFetchResult {
  snapshot: ErpSnapshot | null;
  sessionCookie?: string;
}

function collectCookies(res: Response, prev: Map<string, string>): Map<string, string> {
  const cookies = new Map(prev);
  const setCookies: string[] =
    typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : res.headers.get("set-cookie")?.split(/,(?=[^;]+=[^;]+)/) ?? [];
  for (const sc of setCookies) {
    const [pair] = sc.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0) cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
  return cookies;
}

function cookieHeader(cookies: Map<string, string>): string {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function getLoginContext(): Promise<{ csrf: string; cookies: Map<string, string> }> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${LOGIN_PATH}`, {
      redirect: "manual",
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new SyncError("UNREACHABLE", `Could not reach ${BASE}`);
  }
  let cookies = collectCookies(res, new Map());
  let html = await res.text();

  // follow at most 2 redirects to land on the actual login form
  let hops = 0;
  while (res.status >= 300 && res.status < 400 && res.headers.get("location") && hops < 2) {
    const next = new URL(res.headers.get("location")!, res.url).toString();
    res = await fetch(next, {
      redirect: "manual",
      headers: { "User-Agent": UA, Accept: "text/html", Cookie: cookieHeader(cookies) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    cookies = collectCookies(res, cookies);
    html = await res.text();
    hops++;
  }

  if (/captcha/i.test(html)) {
    throw new SyncError(
      "CAPTCHA_DETECTED",
      "CAPTCHA detected on the ERP login — cannot proceed (by design).",
      stripTags(html).slice(0, 300)
    );
  }

  const tokenMatch = html.match(/name="_token"\s+value="([^"]+)"/);
  if (!tokenMatch) {
    throw new SyncError(
      "PARSE_FAILED",
      "Could not find CSRF token on the login page.",
      stripTags(html).slice(0, 300)
    );
  }
  return { csrf: tokenMatch[1], cookies };
}

async function login(
  username: string,
  password: string
): Promise<{ cookies: Map<string, string> }> {
  const { csrf, cookies } = await getLoginContext();
  const body = new URLSearchParams({
    _token: csrf,
    email: username,
    password,
    remember: "on",
    submit: "Login",
  });

  const res = await fetch(`${BASE}${LOGIN_PATH}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(cookies),
      Referer: `${BASE}${LOGIN_PATH}`,
    },
    body: body.toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  let outCookies = collectCookies(res, cookies);
  const location = res.headers.get("location") ?? "";
  const finalHtml = res.status < 300 || res.status >= 400 ? await res.text() : "";

  if (res.status >= 300 && res.status < 400) {
    if (/dashboard|home|student/i.test(location) && !/login/i.test(location)) {
      return { cookies: outCookies };
    }
    // redirected back to login → bad credentials
    if (/login/i.test(location)) throw new SyncError("INVALID_CREDENTIALS", "ERP redirected back to the login page.");
  }

  const looksLoggedIn =
    !finalHtml || (finalHtml.includes("dashboard") && !finalHtml.includes('name="password"'));
  if (!looksLoggedIn || /credentials do not match|invalid credentials|wrong password/i.test(finalHtml)) {
    throw new SyncError(
      "INVALID_CREDENTIALS",
      "ERP did not accept the provided credentials.",
      stripTags(finalHtml).slice(0, 300)
    );
  }
  return { cookies: outCookies };
}

/** Fetch a URL with the session; returns null when redirected to login. */
async function fetchWithSession(
  path: string,
  cookies: Map<string, string>
): Promise<{ html: string | null; cookies: Map<string, string> }> {
  let out = new Map(cookies);
  try {
    const res = await fetch(`${BASE}${path}`, {
      redirect: "manual",
      headers: { "User-Agent": UA, Accept: "text/html", Cookie: cookieHeader(out) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    out = collectCookies(res, out);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location") ?? "";
      if (/login/i.test(loc)) return { html: null, cookies: out };
      const next = await fetch(new URL(loc, `${BASE}${path}`).toString(), {
        redirect: "follow",
        headers: { "User-Agent": UA, Accept: "text/html", Cookie: cookieHeader(out) },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      out = collectCookies(next, out);
      return { html: await next.text(), cookies: out };
    }
    const html = await res.text();
    if (html.includes('name="password"') && html.includes(LOGIN_PATH)) {
      return { html: null, cookies: out };
    }
    return { html, cookies: out };
  } catch {
    return { html: null, cookies: out };
  }
}

const ROMAN: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8,
};

function semesterFromToken(raw: string): number | null {
  const t = raw.toLowerCase();
  if (/^\d$/.test(t)) return parseInt(t, 10);
  return ROMAN[t] ?? null;
}

/**
 * Detect the student's current semester from ERP page text.
 * Accepts "Semester : 3", "Sem-4", "SEM 5", "3rd Semester", "Semester VI" and
 * other common forms (arabic + roman numerals, optional ordinal suffixes).
 * Returns null when nothing convincing is found.
 */
export function detectCurrentSemester(html: string): number | null {
  const text = stripTags(html);

  // "Semester 3", "Semester: III", "Semester - VI", "Semester 4th"
  const fwd = text.match(
    /semester\s*[:\-–]?\s*(\d{1}(?:st|nd|rd|th)?|i|ii|iii|iv|v|vi|vii|viii)\b/i
  );
  if (fwd) return semesterFromToken(fwd[1].replace(/(?:st|nd|rd|th)$/i, ""));

  // "3rd Semester", "Sem 5"
  const rev = text.match(/\b(\d{1})(?:st|nd|rd|th)?\s+semester\b/i);
  if (rev) return parseInt(rev[1], 10);

  // compact forms like "Sem 3", "Sem-IV"
  const compact = text.match(/\bsem\.?\s*[-–]?\s*(\d{1}|i|ii|iii|iv|v|vi|vii|viii)\b/i);
  if (compact) return semesterFromToken(compact[1]);

  return null;
}

/** Find a semester mentioned inside one table row ("Sem 4", "Semester IV" …). */
function rowSemester(cells: string[]): number | null {
  for (const c of cells) {
    const m = c.match(/\b(?:sem|semester)\.?\s*[-–]?\s*(\d{1}|i|ii|iii|iv|v|vi|vii|viii)\b/i);
    if (m) {
      const n = semesterFromToken(m[1]);
      if (n) return n;
    }
  }
  return null;
}

/**
 * GMIU attendance-page parser (verified against the live ERP).
 *
 * The real /student/attendance table looks like:
 *   | Course | 01 … 31 (day cells) | P | A | L | H | E | % |
 * where P/A/L/H/E are per-subject summary counts (Present, Absent, Leave,
 * Holiday, Exam) and % is P/(P+A). Day cells hold session marks like "P (T)".
 *
 * Returns null when no such table is found (callers fall back to the generic
 * parser). A non-null result is a COMPLETE view of the student's subjects —
 * safe for the sync engine to remove locally-removed rows against.
 */
export function parseGmiuAttendance(html: string): ErpSubjectSnapshot[] | null {
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  for (const table of tables) {
    const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    if (rows.length < 2) continue;

    // locate the header row within the first few rows
    let headerCells: string[] = [];
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 4); i++) {
      const cells = (rows[i].match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map((c) =>
        stripTags(c).trim()
      );
      if (cells.some((c) => /^course$/i.test(c))) {
        headerCells = cells;
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) continue;

    const lastIndexOf = (target: string) => {
      let idx = -1;
      headerCells.forEach((c, i) => {
        if (c.toUpperCase() === target) idx = i;
      });
      return idx;
    };
    const iP = lastIndexOf("P");
    const iA = lastIndexOf("A");
    if (iP < 0 || iA < 0 || iA < iP) continue;

    const out: ErpSubjectSnapshot[] = [];
    for (const row of rows.slice(headerIdx + 1)) {
      const cells = (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map((c) =>
        stripTags(c).trim()
      );
      if (iP >= cells.length || iA >= cells.length) continue;
      const name = (cells[0] ?? "").replace(/\s+/g, " ").trim();
      if (name.length < 3 || !/[a-zA-Z]{3,}/.test(name) || /^\d{1,2}$/.test(name)) continue;
      const p = parseInt(cells[iP], 10);
      const a = parseInt(cells[iA], 10);
      if (!Number.isFinite(p) || !Number.isFinite(a) || p < 0 || a < 0) continue;
      const total = p + a;
      // Subjects with no classes yet (P=A=0) are still listed by the ERP —
      // keep them so the mirror is a complete, honest view.
      const code =
        (name.match(/\b[A-Z]{2,4}[-\s]?\d{2,4}\b/) ?? [])[0]?.replace(/\s+/g, "-") ??
        name
          .slice(0, 24)
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
      if (!out.some((s) => s.code === code)) {
        out.push({ code, name, present: p, total });
      }
    }
    if (out.length > 0) return out;
  }
  return null;
}

/** Parse a page with the GMIU-specific parser first, generic one as fallback. */
function parsePage(html: string): { subjects: ErpSubjectSnapshot[]; complete: boolean } {
  const gmiu = parseGmiuAttendance(html);
  if (gmiu && gmiu.length > 0) return { subjects: gmiu, complete: true };
  return { subjects: parseSubjects(html), complete: false };
}

/** Generic, conservative attendance-table parser (fallback for other layouts). */
function parseSubjects(html: string): ErpSubjectSnapshot[] {
  const found = new Map<string, ErpSubjectSnapshot>();
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  for (const table of tables) {
    const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    for (const row of rows) {
      const cells = (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map((c) => stripTags(c));
      if (cells.length < 2) continue;

      // pattern 1: explicit "24 / 34" or "24/34" inside the row
      const ratio = row.match(/(\d{1,3})\s*\/\s*(\d{1,3})/);
      // pattern 2: a pair of plain integer cells (present, total)
      const nums = cells.map((c) => c.trim()).filter((c) => /^\d{1,3}$/.test(c));
      let present = -1;
      let total = -1;
      let name = "";
      const lower = cells.map((c) => c.toLowerCase());

      if (ratio) {
        present = parseInt(ratio[1], 10);
        total = parseInt(ratio[2], 10);
      } else if (nums.length >= 2) {
        const iPresent = lower.findIndex((c) => /present|attend/.test(c) && !/absent/.test(c));
        const iTotal = lower.findIndex((c) => /total|class(es)?\s*held/.test(c));
        if (iPresent >= 0 && iTotal >= 0 && iTotal > iPresent) {
          const p = nums.find((n) => cells.indexOf(n) > iPresent && cells.indexOf(n) < iTotal);
          const t = nums.filter((n) => cells.indexOf(n) >= iTotal)[0];
          if (p && t) {
            present = parseInt(p, 10);
            total = parseInt(t, 10);
          }
        } else {
          present = parseInt(nums[0], 10);
          total = parseInt(nums[1], 10);
        }
      }
      if (present < 0 || total <= 0 || present > total) continue;

      name =
        cells.find(
          (c) =>
            c.length >= 3 &&
            /[a-zA-Z]{3,}/.test(c) &&
            !/^(present|absent|total|attendance|status|subject|no\.?|#)$/i.test(c.trim()) &&
            !/^\d+(\.\d+)?%?$/.test(c.trim())
        ) ?? "";
      if (!name) continue;

      const code =
        (name.match(/\b[A-Z]{2,4}[-\s]?\d{2,4}\b/) ?? [])[0]?.replace(/\s+/g, "-") ??
        name.slice(0, 24).toUpperCase().replace(/\s+/g, "-");
      if (!found.has(code)) {
        found.set(code, {
          code,
          name: name.trim(),
          present,
          total,
          semester: rowSemester(cells),
        });
      }
    }
  }
  return [...found.values()];
}

function guessType(title: string): ReminderType {
  const t = title.toLowerCase();
  if (/practical|lab exam/.test(t)) return "PRACTICAL_EXAM";
  if (/viva/.test(t)) return "VIVA";
  if (/assign/.test(t)) return "ASSIGNMENT";
  if (/submit|deadline|due/.test(t)) return "SUBMISSION";
  if (/exam|test|mid|sem/.test(t)) return "EXAM";
  return "OTHER";
}

interface CollectedSnapshot {
  subjects: ErpSubjectSnapshot[];
  complete: boolean;
  currentSemester: number | null;
  cookies: Map<string, string>;
}

/**
 * Walk the ERP pages with an authenticated session: dashboard → attendance
 * routes → (for the semester label) the student profile. Prefers the verified
 * GMIU attendance table; falls back to the generic parser when it is absent.
 */
async function collectSnapshot(sessionCookies: Map<string, string>): Promise<CollectedSnapshot> {
  const dash = await fetchWithSession(DASHBOARD_PATH, sessionCookies);
  if (!dash.html) {
    throw new SyncError("AUTH_FAILED", "Session did not survive login redirect.");
  }

  let page = parsePage(dash.html);
  let subjects = page.subjects;
  let complete = page.complete;
  let currentSemester = detectCurrentSemester(dash.html);

  if (subjects.length === 0) {
    for (const p of ATTENDANCE_PATHS) {
      const att = await fetchWithSession(p, dash.cookies);
      if (!att.html) continue;
      page = parsePage(att.html);
      if (page.subjects.length > 0) {
        subjects = page.subjects;
        complete = page.complete;
        if (!currentSemester) currentSemester = detectCurrentSemester(att.html);
        break;
      }
    }
  }

  if (subjects.length === 0) {
    throw new SyncError(
      "PARSE_FAILED",
      "Authenticated, but no attendance rows could be parsed from the ERP pages.",
      stripTags(dash.html).slice(0, 500)
    );
  }

  // The semester lives on the student profile ("Semester: Sem N").
  if (!currentSemester) {
    for (const p of PROFILE_PATHS) {
      const prof = await fetchWithSession(p, dash.cookies);
      if (prof.html) {
        currentSemester = detectCurrentSemester(prof.html);
        if (currentSemester) break;
      }
    }
  }

  if (currentSemester) {
    for (const s of subjects) if (!s.semester) s.semester = currentSemester;
  }

  return { subjects, complete, currentSemester, cookies: dash.cookies };
}

export async function fetchLiveSnapshot(
  username: string,
  password: string,
  savedCookie?: string | null
): Promise<LiveFetchResult> {
  // 1) try the saved session cookie first (gentle on the ERP)
  if (savedCookie) {
    const saved = new Map<string, string>();
    for (const pair of savedCookie.split(";")) {
      const i = pair.indexOf("=");
      if (i > 0) saved.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    try {
      const out = await collectSnapshot(saved);
      return {
        snapshot: buildSnapshot(out.subjects, out.complete, out.currentSemester),
        sessionCookie: cookieHeader(out.cookies),
      };
    } catch {
      // session likely expired — fall through to a full login below
    }
  }

  // 2) full login flow
  const { cookies } = await login(username, password);
  const out = await collectSnapshot(cookies);
  return {
    snapshot: buildSnapshot(out.subjects, out.complete, out.currentSemester),
    sessionCookie: cookieHeader(out.cookies),
  };
}

function buildSnapshot(
  subjects: ErpSubjectSnapshot[],
  complete: boolean,
  currentSemester?: number | null
): ErpSnapshot {
  return {
    mode: "live",
    fetchedAt: new Date().toISOString(),
    // A verified GMIU attendance table is the FULL subject list of the
    // student's current semester → safe to remove disappeared local rows.
    // The generic fallback may be partial → never delete local data from it.
    complete,
    subjects,
    currentSemester: currentSemester ?? null,
    reminders: [], // exam/deadline scraping is added once the real page structure is known
  };
}
