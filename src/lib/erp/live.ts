import {
  ErpAssignmentSnapshot,
  ErpResultExam,
  ErpResultIndexEntry,
  ErpRoutineSlot,
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
/** ALA / coursework list (verified: table with per-subject rows + deadlines). */
const ASSIGNMENT_PATH = "/student/assignment";
/** Weekly class routine (verified: day-per-column table, `div.class-time` blocks). */
const ROUTINE_PATH = "/student/class-routine";
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

/* ------------------------------------------------------------------ */
/* Class routine (weekly timetable)                                    */
/* ------------------------------------------------------------------ */

const ROUTINE_DAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/** "11:00 AM" / "01:00 PM" → minutes from midnight (12 AM → 0, 12 PM → 720). */
function routineTime12ToMin(text: string): number | null {
  const m = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10) % 12;
  if (m[3].toUpperCase() === "PM") h += 12;
  return h * 60 + parseInt(m[2], 10);
}

/**
 * Derive the Subject.code exactly the way the attendance parser does —
 * explicit "ABC-123" style codes pass through, otherwise the name is
 * upper-cased, truncated to 24 chars and non-alphanumerics become dashes.
 * Shared with the class-routine parser so both produce the SAME namespace.
 */
export function deriveSubjectCode(name: string): string {
  const explicit = (name.match(/\b[A-Z]{2,4}[-\s]?\d{2,4}\b/) ?? [])[0]?.replace(/\s+/g, "-");
  if (explicit) return explicit;
  return name
    .slice(0, 24)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Parse the Class Routine page (/student/class-routine).
 * Verified structure: ONE table; header row = day names (Sat…Fri order at
 * GMIU); second row = one cell per day holding zero or more
 * `<div class="class-time">` blocks:
 *   SUBJECT NAME <br> 11:00 AM <br> 01:00 PM <br> Room: … <br> Faculty <br> Batch: …
 * Parallel batches repeat the same subject+time with different rooms — all
 * blocks are kept (they are real schedule facts; batch filtering can come
 * later). Course names are resolved to subject codes via `resolve` (defaults
 * to deriveSubjectCode — the same namespace the attendance parser produces);
 * names the resolver rejects are counted in `unknownNames`, never invented.
 * Returns null when the page doesn't match the expected shape at all.
 */
export function parseGmiuClassRoutine(
  html: string,
  resolve: (name: string) => string | null = deriveSubjectCode
): { slots: ErpRoutineSlot[]; unknownNames: string[] } | null {
  const table = (html.match(/<table[\s\S]*?<\/table>/i) ?? [])[0];
  if (!table) return null;
  const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const headerRow = rows[0];
  const bodyRow = rows[1];
  if (!headerRow || !bodyRow) return null;

  const headerCells = [...headerRow.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) =>
    stripTags(c[1]).toLowerCase().trim()
  );
  const dayCols = headerCells.map((t) => ROUTINE_DAY_INDEX[t] ?? null);
  if (!dayCols.some((d) => d !== null)) return null; // not a day-header table

  const bodyCells = [...bodyRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
  const slots: ErpRoutineSlot[] = [];
  const unknownNames = new Set<string>();

  bodyCells.forEach((cellHtml, col) => {
    const day = dayCols[col];
    if (day == null) return;
    const blocks = cellHtml.match(/<div[^>]*class="[^"]*class-time[^"]*"[^>]*>[\s\S]*?<\/div>/gi) ?? [];
    for (const block of blocks) {
      const lines = block
        .split(/<br\s*\/?>/i)
        .map((l) => stripTags(l).replace(/\s+/g, " ").trim())
        .filter(Boolean);
      if (lines.length < 3) continue;
      const times = lines.map(routineTime12ToMin).filter((t): t is number => t !== null);
      if (times.length < 2) continue;
      const [startMin, endMin] = times;
      if (endMin <= startMin) continue;
      const name = lines.find(
        (l) => routineTime12ToMin(l) === null && !/^room:/i.test(l) && !/^batch:/i.test(l)
      );
      if (!name) continue;
      const code = resolve(name);
      if (!code) {
        unknownNames.add(name);
        continue;
      }
      slots.push({ dayOfWeek: day, startMin, endMin, subjectCode: code });
    }
  });

  return { slots, unknownNames: [...unknownNames] };
}

/* ------------------------------------------------------------------ */
/* Final Results (/student/result)                                     */
/* ------------------------------------------------------------------ */

const RESULT_PATH = "/student/result";

const RESULT_MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};

/** All rows of table N as stripped cell-text arrays (th and td alike). */
function resultTableRows(tableHtml: string): string[][] {
  return (tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).map((r) =>
    [...r.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
      c[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
    )
  );
}

function resultNum(v: string | undefined): number | null {
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** "-" (and blanks) mean "not applicable" in the ERP's grade cells. */
function resultGrade(v: string | undefined): string | null {
  if (!v) return null;
  const t = v.trim().toUpperCase();
  return t === "" || t === "-" ? null : t;
}

/** "May-2026" / "December 2024" → "2026-05"; null when unparseable. */
function resultDateKey(raw: string): string | null {
  const m = raw.trim().match(/^([A-Za-z]+)[\s\-]+(\d{4})$/);
  if (!m) return null;
  const mm = RESULT_MONTHS[m[1].toLowerCase()];
  return mm ? `${m[2]}-${mm}` : null;
}

/**
 * Parse the exam picker on /student/result (the only `name="type"` select).
 * Returns null when the page doesn't match the expected shape (structure
 * change / not the results page); [] when found but no exam is published.
 */
export function parseGmiuResultIndex(html: string): ErpResultIndexEntry[] | null {
  const sel = (html.match(/<select[^>]*name="type"[\s\S]*?<\/select>/i) ?? [])[0];
  if (!sel) return null;
  const out: ErpResultIndexEntry[] = [];
  for (const m of sel.matchAll(/<option\s+value="(\d+)"[^>]*>([\s\S]*?)<\/option>/gi)) {
    const label = stripTags(m[2]).replace(/\s+/g, " ").trim();
    if (label) out.push({ typeId: m[1], label });
  }
  return out;
}

/**
 * Parse one exam result page (/student/result?type=N — verified structure:
 * 8 fixed tables). Columns of the subject table are colspan-defined and
 * always 11 cells: code | name | credit | ESE-Absent | SEE(T,P) | CCE(M,I,V)
 * | grade | credit-point; the backlog table's 8 data cells map to Sem 1–8
 * (the rowspan "Backlog" header owns an empty cell); the summary row is
 * offered/earned credit + points, SGPA, career totals, CGPA, verdict.
 * Returns null when the expected tables are missing (never invents data).
 */
export function parseGmiuResult(html: string, entry: ErpResultIndexEntry): ErpResultExam | null {
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map((t) => t[0]);
  if (tables.length < 6) return null;

  const meta = resultTableRows(tables[0]);
  const who = resultTableRows(tables[2]);
  const subjRows = resultTableRows(tables[3]);
  const backRows = resultTableRows(tables[4]);
  const summRows = resultTableRows(tables[5]);
  // identity + subject + summary tables must all be present and populated
  if (meta.length < 2 || who.length < 2 || subjRows.length < 3 || backRows.length < 2 || summRows.length < 2) {
    return null;
  }

  const label = entry.label;
  const semMatch = label.match(/SEMESTER\s*-?\s*(\d+)/i);
  const sessionMatch = label.match(/\b(WINTER|SUMMER|MONSOON|SPRING|FALL)[\s\-]*(\d{4})/i);
  const examKind = /REMEDIAL/i.test(label) ? "REMEDIAL" : /REGULAR/i.test(label) ? "REGULAR" : "UNKNOWN";

  const subjects: ErpResultExam["subjects"] = [];
  // rows 0/1 are the two header rows; every data row is a fixed 11 cells
  for (let i = 2; i < subjRows.length; i++) {
    const c = subjRows[i];
    if (c.length !== 11) continue;
    if (!/^[A-Z]{2,6}[A-Z0-9]*$/.test(c[0])) continue; // not a course-code row
    subjects.push({
      code: c[0],
      name: c[1],
      credit: resultNum(c[2]),
      eseAbsent: resultGrade(c[3]) !== null,
      seeTheory: resultGrade(c[4]),
      seePractical: resultGrade(c[5]),
      cceMid: resultGrade(c[6]),
      cceInternal: resultGrade(c[7]),
      cceViva: resultGrade(c[8]),
      grade: resultGrade(c[9]),
      creditPoint: resultNum(c[10]),
    });
  }

  // backlog row: the 8 data cells (row 1) map to Sem 1–8; "N/A" → null
  const backlogBySem = backRows[1].slice(0, 8).map((v) => {
    const t = v.trim().toUpperCase();
    if (t === "" || t === "N/A") return null;
    return resultNum(t);
  });

  const s = summRows[1];
  const examDateLabel = meta[1][2] ?? null;
  return {
    typeId: entry.typeId,
    label,
    examKind,
    semester: semMatch ? parseInt(semMatch[1], 10) : null,
    examSession: sessionMatch ? `${sessionMatch[1].toUpperCase()} ${sessionMatch[2]}` : null,
    examDateKey: examDateLabel ? resultDateKey(examDateLabel) : null,
    examDateLabel,
    academicYear: meta[1][0] ?? null,
    studentName: who[1][0] ?? null,
    enrollment: who[1][1] ?? null,
    seatNo: who[1][2] ?? null,
    subjects,
    backlogBySem,
    offeredCredit: resultNum(s[0]),
    earnedCredit: resultNum(s[1]),
    sgpa: resultNum(s[4]),
    totalOfferedCredit: resultNum(s[5]),
    totalEarnedCredit: resultNum(s[6]),
    cgpa: resultNum(s[9]),
    result: s[10] ?? null,
  };
}

export interface LiveResultsResult {
  exams: ErpResultExam[];
  sessionCookie?: string;
}

/**
 * Fetch every published exam result with an authenticated session (saved
 * cookie first, full login fallback — the same gentle pattern as the sync
 * and the ALA write-back). READ-ONLY: one GET for the exam picker, one GET
 * per published exam, politely paced. An unparsable picker throws
 * PARSE_FAILED; an empty picker honestly yields [] (nothing published).
 */
export async function fetchLiveResults(
  username: string,
  password: string,
  savedCookie?: string | null,
  opts?: { paceMs?: number }
): Promise<LiveResultsResult> {
  let cookies = new Map<string, string>();
  if (savedCookie) {
    for (const pair of savedCookie.split(";")) {
      const i = pair.indexOf("=");
      if (i > 0) cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  let page = await fetchWithSession(RESULT_PATH, cookies);
  if (!page.html) {
    const fresh = await login(username, password);
    cookies = fresh.cookies;
    page = await fetchWithSession(RESULT_PATH, cookies);
    if (!page.html) {
      throw new SyncError("AUTH_FAILED", "Could not open the results page with a fresh session.");
    }
  }
  cookies = page.cookies;

  const index = parseGmiuResultIndex(page.html);
  if (index === null) {
    throw new SyncError(
      "PARSE_FAILED",
      "Results page structure not recognized (no exam picker found).",
      stripTags(page.html).slice(0, 300)
    );
  }

  const exams: ErpResultExam[] = [];
  const pace = opts?.paceMs ?? 350;
  for (const entry of index) {
    const detail = await fetchWithSession(`${RESULT_PATH}?type=${encodeURIComponent(entry.typeId)}`, cookies);
    cookies = detail.cookies;
    if (detail.html) {
      const parsed = parseGmiuResult(detail.html, entry);
      if (parsed) exams.push(parsed);
    }
    await new Promise((r) => setTimeout(r, pace)); // polite pacing between exam pages
  }
  return { exams, sessionCookie: cookieHeader(cookies) };
}

/** A submission counts as complete only when the ERP clearly says so. */
export function isSubmissionComplete(
  submissionStatus: string | null | undefined,
  approvalStatus?: string | null
): boolean {
  const sub = (submissionStatus ?? "").trim();
  const appr = (approvalStatus ?? "").trim();
  const submitted = /submit|complet|done|accept/i.test(sub) && !/pending|reject|cancel|not/i.test(sub);
  // A rejected approval means the work is NOT accepted, whatever submission says.
  const rejected = /reject|cancel/i.test(appr);
  return submitted && !rejected;
}

/**
 * GMIU Assignments-page parser (verified against the live ERP).
 *
 * Table header:
 *   # | Title | Course | Session | Semester | Start Date | End Date |
 *   Submission Status | Approval Status
 * Row example:
 *   1 | <a href="…/student/assignment/485178">ALA-5</a> | BETCE15324 |
 *     GMIU-2026-27(ODD) | Sem 5 | 2026-07-30 | 2026-10-30 | Pending | Pending
 *
 * Rows are filtered to the student's current semester when one is supplied
 * (the page lists every semester the student ever had — 135+ rows).
 * Returns null when no such table is found (callers then report the page as
 * unavailable rather than inventing data).
 */
export function parseGmiuAssignments(
  html: string,
  currentSemester: number | null
): ErpAssignmentSnapshot[] | null {
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  for (const table of tables) {
    const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    if (rows.length < 2) continue;

    // locate the header row
    let headerCells: string[] = [];
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 4); i++) {
      const cells = (rows[i].match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map((c) =>
        stripTags(c).trim()
      );
      if (cells.some((c) => /^title$/i.test(c)) && cells.some((c) => /^course$/i.test(c))) {
        headerCells = cells;
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) continue;

    const col = (target: RegExp) =>
      headerCells.findIndex((c) => target.test(c));
    const iTitle = col(/^title$/i);
    const iCourse = col(/^course$/i);
    const iSession = col(/^session$/i);
    const iSemester = col(/^semester$/i);
    const iStart = col(/^start\s*date$/i);
    const iEnd = col(/^end\s*date$/i);
    const iSub = col(/^submission\s*status$/i);
    const iAppr = col(/^approval\s*status$/i);
    if (iTitle < 0 || iCourse < 0 || iEnd < 0 || iSub < 0) continue;

    const wantSemester =
      currentSemester != null ? new RegExp(`^sem\\s*${currentSemester}$`, "i") : null;
    const out: ErpAssignmentSnapshot[] = [];
    for (const row of rows.slice(headerIdx + 1)) {
      const cells = (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map((c) =>
        stripTags(c).trim()
      );
      if (iTitle >= cells.length || iCourse >= cells.length || iEnd >= cells.length) continue;
      const title = (cells[iTitle] ?? "").replace(/\s+/g, " ").trim();
      const courseCode = (cells[iCourse] ?? "").toUpperCase().replace(/\s+/g, "");
      if (!title || !courseCode) continue;
      if (wantSemester && !(wantSemester.test(cells[iSemester] ?? ""))) continue;

      // Assignment id lives in the row's link (/student/assignment/485178).
      const id = (row.match(/student\/assignment\/(\d+)/) ?? [])[1];
      const start = /^\d{4}-\d{2}-\d{2}$/.test(cells[iStart] ?? "") ? cells[iStart] : null;
      const end = /^\d{4}-\d{2}-\d{2}$/.test(cells[iEnd] ?? "") ? cells[iEnd] : null;
      if (!end) continue; // no parseable last date → cannot be a deadline

      out.push({
        externalId: id ?? `${courseCode}|${title}|${start ?? "-"}`,
        title,
        courseCode,
        session: cells[iSession] ?? null,
        semesterLabel: cells[iSemester] ?? null,
        startDate: start,
        endDate: end,
        submissionStatus: (cells[iSub] ?? "").replace(/\s+/g, " ") || "Unknown",
        approvalStatus: iAppr >= 0 ? cells[iAppr] ?? null : null,
      });
    }
    if (out.length > 0) return out;
  }
  return null;
}

/**
 * Resolve course-code → course-name pairs from an assignment detail page
 * ("Course: BETCE15324 - RESPONSIVE WEB & MOBILE UI DESIGN"). The list page
 * carries only the code, so names come from one sampled detail page per code.
 */
function parseCourseName(html: string, courseCode: string): string | null {
  const text = stripTags(html);
  const esc = courseCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = text.match(new RegExp(`Course:\\s*${esc}\\s*-\\s*(.+?)(?:\\s+Session:|$)`));
  return m ? m[1].replace(/\s+/g, " ").trim() || null : null;
}

async function resolveCourseNames(
  rows: ErpAssignmentSnapshot[],
  known: Record<string, string>,
  cookies: Map<string, string>,
  budget: number
): Promise<Record<string, string>> {
  const merged = { ...known };
  const sampleByCode = new Map<string, ErpAssignmentSnapshot>();
  for (const r of rows) {
    if (!merged[r.courseCode] && /^\d+$/.test(r.externalId) && !sampleByCode.has(r.courseCode)) {
      sampleByCode.set(r.courseCode, r);
    }
  }
  let used = 0;
  for (const [code, sample] of sampleByCode) {
    if (used >= budget) break; // stay gentle on the ERP; the rest resolve on later syncs
    const detail = await fetchWithSession(`/student/assignment/${sample.externalId}`, cookies);
    used++;
    if (!detail.html) continue;
    const name = parseCourseName(detail.html, code);
    if (name) merged[code] = name;
    await new Promise((r) => setTimeout(r, 350)); // polite pacing between detail fetches
  }
  return merged;
}

interface CollectedSnapshot {
  subjects: ErpSubjectSnapshot[];
  complete: boolean;
  currentSemester: number | null;
  cookies: Map<string, string>;
  assignments: ErpAssignmentSnapshot[];
  assignmentsComplete: boolean;
  courseNames: Record<string, string>;
  routine?: ErpRoutineSlot[];
  routineUnknown?: string[];
}

/**
 * Walk the ERP pages with an authenticated session: dashboard → attendance
 * routes → the Assignments (ALA) page → (for the semester label) the student
 * profile. Prefers the verified GMIU parsers; missing optional pages degrade
 * gracefully (assignments: [] / complete: false) instead of failing the sync.
 */
async function collectSnapshot(
  sessionCookies: Map<string, string>,
  opts?: {
    knownCourseNames?: Record<string, string>;
    courseNameBudget?: number;
  }
): Promise<CollectedSnapshot> {
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

  // --- ALA / assignments page (subject-wise rows with deadlines) ---
  let assignments: ErpAssignmentSnapshot[] = [];
  let assignmentsComplete = false;
  let courseNames: Record<string, string> = { ...(opts?.knownCourseNames ?? {}) };
  const att = await fetchWithSession(ASSIGNMENT_PATH, dash.cookies);
  if (att.html && !att.html.includes('name="password"')) {
    const parsed = parseGmiuAssignments(att.html, currentSemester);
    if (parsed) {
      assignments = parsed;
      assignmentsComplete = true;
      courseNames = await resolveCourseNames(
        assignments,
        courseNames,
        att.cookies,
        opts?.courseNameBudget ?? 2
      );
    }
  }

  // --- Class routine (weekly timetable) ---
  // Additive and best-effort: an unavailable/unrecognized page leaves the
  // routine undefined and the sync proceeds normally. Only a NON-EMPTY parse
  // is returned so the engine never wipes stored slots on a structure change.
  // Codes resolve through deriveSubjectCode — the same derivation the
  // attendance parser uses — so routine slots land in the SAME code
  // namespace as the Subject rows (validated against the DB by the engine).
  let routine: ErpRoutineSlot[] | undefined;
  let routineUnknown: string[] | undefined;
  const rt = await fetchWithSession(ROUTINE_PATH, dash.cookies);
  if (rt.html && !rt.html.includes('name="password"')) {
    const parsedRoutine = parseGmiuClassRoutine(rt.html, deriveSubjectCode);
    if (parsedRoutine && parsedRoutine.slots.length > 0) {
      routine = parsedRoutine.slots;
      routineUnknown = parsedRoutine.unknownNames;
    }
  }

  return {
    subjects,
    complete,
    currentSemester,
    cookies: dash.cookies,
    assignments,
    assignmentsComplete,
    courseNames,
    routine,
    routineUnknown,
  };
}

export async function fetchLiveSnapshot(
  username: string,
  password: string,
  savedCookie?: string | null,
  opts?: {
    knownCourseNames?: Record<string, string>;
    /** How many assignment-detail pages may be fetched to resolve course names. */
    courseNameBudget?: number;
  }
): Promise<LiveFetchResult> {
  // 1) try the saved session cookie first (gentle on the ERP)
  if (savedCookie) {
    const saved = new Map<string, string>();
    for (const pair of savedCookie.split(";")) {
      const i = pair.indexOf("=");
      if (i > 0) saved.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    try {
      const out = await collectSnapshot(saved, opts);
      return {
        snapshot: buildSnapshot(out),
        sessionCookie: cookieHeader(out.cookies),
      };
    } catch {
      // session likely expired — fall through to a full login below
    }
  }

  // 2) full login flow
  const { cookies } = await login(username, password);
  const out = await collectSnapshot(cookies, opts);
  return {
    snapshot: buildSnapshot(out),
    sessionCookie: cookieHeader(out.cookies),
  };
}

function buildSnapshot(out: CollectedSnapshot): ErpSnapshot {
  return {
    mode: "live",
    fetchedAt: new Date().toISOString(),
    // A verified GMIU attendance table is the FULL subject list of the
    // student's current semester → safe to remove disappeared local rows.
    // The generic fallback may be partial → never delete local data from it.
    complete: out.complete,
    subjects: out.subjects,
    reminders: [], // exam/deadline scraping is added once the real page structure is known
    assignments: out.assignments,
    assignmentsComplete: out.assignmentsComplete,
    courseNames: out.courseNames,
    currentSemester: out.currentSemester ?? null,
    ...(out.routine ? { routine: out.routine, routineUnknown: out.routineUnknown ?? [] } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* ALA write-back (explicit, per-row, user-initiated)                  */
/* ------------------------------------------------------------------ */

export interface AlaSubmitInput {
  /** Numeric ERP assignment id (the list row's /student/assignment/{id}). */
  externalId: string;
  /** File the student picked in the app (forwarded as multipart `attach`). */
  file?: { name: string; type: string; data: Buffer };
  /** Optional link submission (the form's `link` text input). */
  link?: string;
}

export interface AlaSubmitResult {
  ok: boolean;
  message: string;
  /** True only when the ERP page after the POST shows "Submission Status: Submitted". */
  confirmedSubmitted: boolean;
  /** Refreshed session cookie to persist (may rotate during the flow). */
  sessionCookie?: string;
}

/** ERP-accepted file extensions (mirrors the form's accept attribute). */
export const ALA_ACCEPT = [
  ".pdf", ".docx", ".zip", ".xlsx", ".ppt", ".csv", ".mp4", ".png", ".jpg", ".jpeg", ".pptx", ".odp",
] as const;

function extractSubmissionForm(html: string): { action: string; token: string } | null {
  const m = html.match(
    /<form[^>]*action="([^"]*\/student\/assignment\/\d+\/update[^"]*)"[^>]*method="post"[^>]*>([\s\S]*?)<\/form>/i
  );
  if (!m) return null;
  const t = m[2].match(/name="_token"\s+value="([^"]+)"/);
  if (!t) return null;
  return { action: new URL(m[1], BASE).toString(), token: t[1] };
}

function pageShowsSubmitted(html: string): boolean {
  return /Submission Status\s*:?\s*<\/[^>]+>?\s*Submitted/i.test(html) ||
    /Submission Status\s*:?\s*Submitted/i.test(html.replace(/<[^>]+>/g, " "));
}

function pageFlashError(html: string): string | null {
  const alert = html.match(/class="[^"]*alert-danger[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (alert) {
    const text = stripTags(alert[1]);
    if (text) return text.slice(0, 240);
  }
  const invalid = html.match(/The (?:attach|link|[\w ]+) field is required/i);
  if (invalid) return invalid[0];
  return null;
}

/**
 * Submit ONE ALA/assignment on the student's behalf. NEVER called
 * automatically — only from the explicit per-row user action:
 *   1. open the detail page (fresh session) → extract CSRF _token + action
 *   2. POST multipart/form-data { _token, attach?, link? }
 *   3. re-fetch the detail page and only report success when the ERP itself
 *      shows "Submission Status: Submitted" — we never fabricate confirmation.
 * Rate-limit friendly: 3 requests total per submission, politely paced.
 */
export async function submitAssignment(
  username: string,
  password: string,
  savedCookie: string | null | undefined,
  input: AlaSubmitInput
): Promise<AlaSubmitResult> {
  if (!/^\d+$/.test(input.externalId)) {
    throw new SyncError("PARSE_FAILED", "Refusing to submit: not a numeric ERP assignment id.");
  }
  if (!input.file && !input.link?.trim()) {
    throw new SyncError("PARSE_FAILED", "Nothing to submit — attach a file or provide a link.");
  }

  const detailPath = `/student/assignment/${input.externalId}`;

  // 1) session: try saved cookie → full login fallback
  let cookies = new Map<string, string>();
  if (savedCookie) {
    for (const pair of savedCookie.split(";")) {
      const i = pair.indexOf("=");
      if (i > 0) cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  let page = await fetchWithSession(detailPath, cookies);
  if (!page.html) {
    const fresh = await login(username, password);
    cookies = fresh.cookies;
    page = await fetchWithSession(detailPath, cookies);
    if (!page.html) {
      throw new SyncError("AUTH_FAILED", "Could not open the assignment page with a fresh session.");
    }
  }
  cookies = page.cookies;

  // Idempotency: ERP already marks it submitted → nothing to do.
  if (pageShowsSubmitted(page.html)) {
    return {
      ok: true,
      confirmedSubmitted: true,
      message: "The ERP already shows this ALA as Submitted — nothing sent.",
      sessionCookie: cookieHeader(cookies),
    };
  }

  const form = extractSubmissionForm(page.html);
  if (!form) {
    throw new SyncError(
      "PARSE_FAILED",
      "No submission form found on the ERP page (this ALA may be faculty-managed or closed).",
      stripTags(page.html).slice(0, 300)
    );
  }

  // 2) build the multipart body exactly like the ERP's own form
  const fd = new FormData();
  fd.set("_token", form.token);
  if (input.file) {
    fd.set(
      "attach",
      new File([new Uint8Array(input.file.data)], input.file.name, { type: input.file.type || "application/octet-stream" })
    );
  }
  if (input.link?.trim()) fd.set("link", input.link.trim());
  // the real form has no other fields; Laravel ignores absent optional ones

  const postRes = await fetch(form.action, {
    method: "POST",
    redirect: "manual",
    headers: { "User-Agent": UA, Cookie: cookieHeader(cookies), Referer: `${BASE}${detailPath}` },
    body: fd,
    signal: AbortSignal.timeout(30_000),
  });
  const postCookies = collectCookies(postRes, cookies);
  cookies = postCookies;
  await new Promise((r) => setTimeout(r, 400)); // polite pacing

  // 3) confirm from the ERP's own page (follow Laravel's post-redirect)
  let confirmHtml: string | null = null;
  if (postRes.status >= 300 && postRes.status < 400) {
    const loc = postRes.headers.get("location") ?? "";
    const back = await fetchWithSession(
      loc.startsWith("http") ? loc.replace(BASE, "") || DASHBOARD_PATH : loc || detailPath,
      cookies
    );
    cookies = back.cookies;
    confirmHtml = back.html;
  } else {
    confirmHtml = await postRes.text().catch(() => null);
  }
  if (!confirmHtml) {
    confirmHtml = (await fetchWithSession(detailPath, cookies)).html;
  }

  const errText = confirmHtml ? pageFlashError(confirmHtml) : "ERP response was empty";
  if (confirmHtml && pageShowsSubmitted(confirmHtml)) {
    return {
      ok: true,
      confirmedSubmitted: true,
      message: "Submitted — the ERP now shows Submission Status: Submitted.",
      sessionCookie: cookieHeader(cookies),
    };
  }
  if (postRes.status >= 200 && postRes.status < 300 && !errText) {
    // Laravel returned 200 without a danger flash, but we could not positively
    // confirm → report honestly instead of claiming success.
    return {
      ok: false,
      confirmedSubmitted: false,
      message: "The ERP accepted the request but did not confirm the submission — check on the next sync.",
      sessionCookie: cookieHeader(cookies),
    };
  }
  return {
    ok: false,
    confirmedSubmitted: false,
    message: `ERP did not accept the submission${errText ? `: ${errText}` : ` (HTTP ${postRes.status})`}.`,
    sessionCookie: cookieHeader(cookies),
  };
}
