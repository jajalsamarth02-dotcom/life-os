/**
 * READ-ONLY: dump the /student/result page structure for parser design.
 * GET only — no writes, no notifications. Run: cd /home/z/my-project && bun run scripts/dump-result.ts
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

const res = await fetch(`${BASE}/student/result`, {
  redirect: "follow",
  headers: { "User-Agent": UA, Accept: "text/html", Cookie: ck(cookies) },
  signal: AbortSignal.timeout(TIMEOUT),
});
cookies = collectCookies(res, cookies);
const html = await res.text();
console.log("result status:", res.status, "bytes:", html.length, "finalUrl:", res.url);
writeFileSync("/tmp/student-result.html", html);

// structural summary: headings, tables, selects, forms
const headings = [...html.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)].map((h) => h[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
console.log("headings:", JSON.stringify(headings));
const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)];
console.log("tables:", tables.length);
tables.forEach((t, i) => {
  const rows = [...t[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)];
  console.log(`--- table ${i}: ${rows.length} rows ---`);
  rows.slice(0, 14).forEach((r, j) => {
    const cells = [...r[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) =>
      c[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()
    );
    console.log(`  r${j}: ${JSON.stringify(cells).slice(0, 260)}`);
  });
});
const selects = [...html.matchAll(/<select[^>]*name="([^"]+)"[\s\S]*?<\/select>/gi)].map((s) => s[1]);
console.log("selects:", selects);
const forms = [...html.matchAll(/<form[^>]*action="([^"]*)"[^>]*method="([^"]*)"/gi)].map((f) => f.slice(1));
console.log("forms:", forms);
// nav links containing 'result' or 'exam' for sibling pages
const links = [...html.matchAll(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)]
  .map((m) => ({ href: m[1], text: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() }))
  .filter((l) => /result|exam|mark/i.test(l.href + " " + l.text));
console.log("result/exam links:", JSON.stringify(links.slice(0, 10)));

// ---- fetch each published exam type (GET only) and dump the result rows ----
const options = [...html.matchAll(/<option value="(\d+)"\s*>([^<]+)<\/option>/gi)].map((m) => ({ id: m[1], label: m[2].trim() }));
console.log("exam types:", JSON.stringify(options));
for (const opt of options) {
  const r2 = await fetch(`${BASE}/student/result?type=${opt.id}`, {
    redirect: "follow",
    headers: { "User-Agent": UA, Accept: "text/html", Cookie: ck(cookies) },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const h2 = await r2.text();
  const t2 = [...h2.matchAll(/<table[\s\S]*?<\/table>/gi)];
  console.log(`\n===== type=${opt.id} (${opt.label}) status=${r2.status} bytes=${h2.length} tables=${t2.length}`);
  // any SGPI/CGPA/grade markers anywhere
  const marks = [...new Set([...h2.matchAll(/(SGPI|CGPA|SGPA|Grade|Credit|PASS|FAIL|FT|AB)\b/gi)].map((m) => m[1].toUpperCase()))];
  console.log("  markers:", marks.join(","));
  t2.forEach((t, i) => {
    const rows = [...t[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)];
    console.log(`  --- table ${i}: ${rows.length} rows ---`);
    rows.slice(0, 16).forEach((r, j) => {
      const cells = [...r[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) =>
        c[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()
      );
      console.log(`    r${j}: ${JSON.stringify(cells).slice(0, 300)}`);
    });
  });
  const safeLabel = opt.label.replace(/[^A-Z0-9]+/gi, "-").slice(0, 40);
  writeFileSync(`/tmp/result-type-${opt.id}-${safeLabel}.html`, h2);
}
console.log("\nsaved per-type dumps to /tmp/result-type-*.html");
await db.$disconnect();
