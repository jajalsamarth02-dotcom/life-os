/**
 * READ-ONLY: dump the /student/assessment page structure for parser design.
 * GET only — no writes, no notifications. Run: cd /home/z/my-project && bun run scripts/dump-assessment.ts
 */
import { PrismaClient } from "@prisma/client";
import { decryptSecret } from "../src/lib/crypto";
import { writeFileSync } from "fs";

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

const db = new PrismaClient();
const conn = await db.erpConnection.findFirst({ orderBy: { createdAt: "desc" } });
if (!conn) {
  console.log("NO CONNECTION ROW — aborting");
  process.exit(0);
}
const password = decryptSecret(conn.secretEnc);

const loginRes = await fetch(`${BASE}/student/login`, { redirect: "manual", headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(TIMEOUT) });
let cookies = collectCookies(loginRes, new Map());
const loginHtml = await loginRes.text();
const csrf = (loginHtml.match(/name="_token"\s+value="([^"]+)"/) ?? [])[1];
const post = await fetch(`${BASE}/student/login`, {
  method: "POST", redirect: "manual",
  headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", Cookie: ck(cookies), Referer: `${BASE}/student/login` },
  body: new URLSearchParams({ _token: csrf!, email: conn.username, password, remember: "on", submit: "Login" }).toString(),
  signal: AbortSignal.timeout(TIMEOUT),
});
cookies = collectCookies(post, cookies);
console.log("login POST status:", post.status, "location:", post.headers.get("location"));

const res = await fetch(`${BASE}/student/assessment`, {
  redirect: "follow",
  headers: { "User-Agent": UA, Accept: "text/html", Cookie: ck(cookies) },
  signal: AbortSignal.timeout(TIMEOUT),
});
cookies = collectCookies(res, cookies);
const html = await res.text();
console.log("assessment status:", res.status, "bytes:", html.length, "finalUrl:", res.url);
writeFileSync("/tmp/student-assessment.html", html);

const headings = [...html.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)].map((h) => h[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
console.log("headings:", JSON.stringify(headings));
const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)];
console.log("tables:", tables.length);
tables.forEach((t, i) => {
  const rows = [...t[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)];
  console.log(`--- table ${i}: ${rows.length} rows ---`);
  rows.slice(0, 20).forEach((r, j) => {
    const cells = [...r[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) =>
      c[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()
    );
    console.log(`  r${j}: ${JSON.stringify(cells).slice(0, 300)}`);
  });
});
const selects = [...html.matchAll(/<select[^>]*name="([^"]+)"[\s\S]*?<\/select>/gi)].map((s) => s[1]);
console.log("selects:", selects);
const forms = [...html.matchAll(/<form[^>]*action="([^"]*)"[^>]*method="([^"]*)"/gi)].map((f) => f.slice(1));
console.log("forms:", forms);
const options = [...html.matchAll(/<option value="([^"]*)"\s*>([^<]+)<\/option>/gi)].map((m) => ({ v: m[1], label: m[2].trim() }));
console.log("select options:", JSON.stringify(options.slice(0, 15)));
// markers of interest
const markers = [...new Set([...html.matchAll(/(Marks|Obtained|Total|Out of|Quiz|Assignment|Mid|Internal|Viva|Attendance|PR|OR|TW|Percentage)/gi)].map((m) => m[1]))];
console.log("markers:", markers.join(","));
await db.$disconnect();
