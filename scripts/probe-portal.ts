/**
 * READ-ONLY portal probe (QA): logs in with the stored ERP credentials and
 * GETs the dashboard to harvest the real sidebar nav, then probes candidate
 * timetable / marks pages. GETs only — identical to what every sync does.
 * Run: cd /home/z/my-project && bun run scripts/probe-portal.ts
 */
import { PrismaClient } from "@prisma/client";
import { decryptSecret } from "../src/lib/crypto";

const BASE = "https://erp.gmiu.edu.in";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 ERPStudentSync/1.0";
const TIMEOUT = 15000;

function collectCookies(res: Response, prev: Map<string, string>): Map<string, string> {
  const cookies = new Map(prev);
  const scs: string[] =
    typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie()
      : res.headers.get("set-cookie")?.split(/,(?=[^;]+=[^;]+)/) ?? [];
  for (const sc of scs) {
    const [pair] = sc.split(";");
    const i = pair.indexOf("=");
    if (i > 0) cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  return cookies;
}
const ck = (c: Map<string, string>) => [...c.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

async function get(path: string, cookies: Map<string, string>) {
  let out = new Map(cookies);
  const res = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    headers: { "User-Agent": UA, Accept: "text/html", Cookie: ck(out) },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  out = collectCookies(res, out);
  let html = await res.text();
  let finalPath = path;
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location") ?? "";
    if (/login/i.test(loc)) return { html: null as string | null, cookies: out, status: res.status, toLogin: true, finalPath };
    const next = await fetch(new URL(loc, `${BASE}${path}`).toString(), {
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: "text/html", Cookie: ck(out) },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    out = collectCookies(next, out);
    html = await next.text();
    finalPath = new URL(next.url).pathname;
    if (html.includes('name="password"') && /login/i.test(finalPath)) return { html: null as string | null, cookies: out, status: 200, toLogin: true, finalPath };
  }
  return { html, cookies: out, status: res.status, toLogin: false, finalPath };
}

const db = new PrismaClient();
const conn = await db.erpConnection.findFirst({ orderBy: { createdAt: "desc" } });
if (!conn) { console.log("NO_CONNECTION"); process.exit(0); }
const password = decryptSecret(conn.secretEnc);

// --- login ---
const loginRes = await fetch(`${BASE}/student/login`, { redirect: "manual", headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(TIMEOUT) });
let cookies = collectCookies(loginRes, new Map());
const loginHtml = await loginRes.text();
const csrf = (loginHtml.match(/name="_token"\s+value="([^"]+)"/) ?? [])[1];
if (!csrf) { console.log("NO_CSRF (captcha?)"); process.exit(0); }
const post = await fetch(`${BASE}/student/login`, {
  method: "POST",
  redirect: "manual",
  headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", Cookie: ck(cookies), Referer: `${BASE}/student/login` },
  body: new URLSearchParams({ _token: csrf, email: conn.username, password, remember: "on", submit: "Login" }).toString(),
  signal: AbortSignal.timeout(TIMEOUT),
});
cookies = collectCookies(post, cookies);
console.log("login POST:", post.status, "loc:", post.headers.get("location"));

// --- harvest dashboard nav ---
const dash = await get("/student/dashboard", cookies);
cookies = dash.cookies;
if (!dash.html) { console.log("DASHBOARD → login redirect; aborting"); process.exit(0); }
const links = [...dash.html.matchAll(/href="([^"]*student[^"]*)"[^>]*>([\s\S]{0,80}?)<\/a>/gi)]
  .map((m) => ({ href: m[1], text: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() }));
const seen = new Set<string>();
console.log("--- NAV LINKS ---");
for (const l of links) {
  const key = l.href;
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(`${l.text.slice(0, 40).padEnd(40)} ${l.href}`);
}

// --- probe candidate pages ---
const candidates = [
  "/student/timetable", "/student/time-table", "/student/time_table",
  "/student/class-schedule", "/student/weekly-schedule", "/student/routine",
  "/student/class-routine", "/student/schedule", "/student/lecture-schedule",
  "/student/marks", "/student/result", "/student/results", "/student/exam",
];
console.log("--- CANDIDATE PROBES ---");
for (const p of candidates) {
  const r = await get(p, cookies);
  cookies = r.cookies;
  if (!r.html) { console.log(`${p.padEnd(32)} → login-redirect (exists?)`); continue; }
  const title = (r.html.match(/<title>([^<]*)<\/title>/i) ?? [])[1] ?? "";
  const tables = (r.html.match(/<table/gi) ?? []).length;
  const words = (r.html.match(/timetable|time.table|schedule|routine|marks|exam/gi) ?? []).length;
  console.log(`${p.padEnd(32)} ${r.status} title="${title.slice(0, 50)}" tables=${tables} kw=${words} final=${r.finalPath}`);
}
await db.$disconnect();
