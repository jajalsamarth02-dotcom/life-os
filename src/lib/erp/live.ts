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

/** Generic, conservative attendance-table parser. */
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
      if (!found.has(code)) found.set(code, { code, name: name.trim(), present, total });
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
    const dash = await fetchWithSession(DASHBOARD_PATH, saved);
    if (dash.html) {
      const subjects = parseSubjects(dash.html);
      if (subjects.length > 0) {
        return { snapshot: buildSnapshot(subjects), sessionCookie: cookieHeader(dash.cookies) };
      }
    }
  }

  // 2) full login flow
  const { cookies } = await login(username, password);
  const cookie = cookieHeader(cookies);

  const dash = await fetchWithSession(DASHBOARD_PATH, cookies);
  if (!dash.html) {
    throw new SyncError("AUTH_FAILED", "Session did not survive login redirect.");
  }

  let subjects = parseSubjects(dash.html);
  if (subjects.length === 0) {
    // try well-known attendance routes
    for (const p of ATTENDANCE_PATHS) {
      const page = await fetchWithSession(p, dash.cookies);
      if (page.html) {
        subjects = parseSubjects(page.html);
        if (subjects.length > 0) break;
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

  return { snapshot: buildSnapshot(subjects, dash.cookies), sessionCookie: cookieHeader(dash.cookies) };
}

function buildSnapshot(
  subjects: ErpSubjectSnapshot[],
  cookies?: Map<string, string>
): ErpSnapshot {
  void cookies;
  return {
    mode: "live",
    fetchedAt: new Date().toISOString(),
    complete: false, // live scrape may be partial → never delete local data based on it
    subjects,
    reminders: [], // exam/deadline scraping is added once the real page structure is known
  };
}
