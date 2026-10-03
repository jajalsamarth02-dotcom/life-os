/** Dump the /student/assignment page structure (list page + one detail page). */
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import fs from "fs";

const prisma = new PrismaClient();
const BASE = "https://erp.gmiu.edu.in";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 ERPStudentSync/1.0";

function getKey(): Buffer {
  const hex = process.env.APP_ENCRYPTION_KEY;
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, "hex");
  return crypto.createHash("sha256").update("erp-sync-student-app::fallback-key").digest();
}
function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(":");
  const d = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64"));
  d.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([d.update(Buffer.from(dataB64, "base64")), d.final()]).toString("utf8");
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
async function fetchUrl(path: string, cookies: Map<string, string>) {
  const res = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    headers: { "User-Agent": UA, Accept: "text/html", Cookie: cookieHeader(cookies) },
    signal: AbortSignal.timeout(15000),
  });
  const out = collectCookies(res, cookies);
  const html = res.status >= 300 && res.status < 400 ? "" : await res.text();
  return { status: res.status, html, cookies: out };
}

async function main() {
  const conn = await prisma.erpConnection.findFirst({ orderBy: { updatedAt: "desc" } });
  const password = decryptSecret(conn!.secretEnc);
  const savedCookie = conn!.sessionCookieEnc ? decryptSecret(conn!.sessionCookieEnc) : null;
  let cookies = new Map<string, string>();
  for (const pair of (savedCookie ?? "").split(";")) {
    const i = pair.indexOf("=");
    if (i > 0) cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }

  const list = await fetchUrl("/student/assignment", cookies);
  console.log("assignment page status:", list.status, "len:", list.html.length);
  if (list.html.includes('name="password"') || list.html.length === 0) {
    console.log("SESSION DEAD — rerun probe to relogin first");
    return;
  }
  fs.writeFileSync("/home/z/my-project/scripts/out-assignment.html", list.html);

  // extract tables overview: headers + first rows (text only)
  const tables = list.html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  console.log("tables found:", tables.length);
  tables.forEach((tb, ti) => {
    const rows = tb.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    console.log(`\n== TABLE ${ti} : ${rows.length} rows ==`);
    rows.slice(0, 6).forEach((row, ri) => {
      const cells = (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map((c) =>
        c.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()
      );
      console.log(`  r${ri}: ${JSON.stringify(cells).slice(0, 300)}`);
    });
  });

  // also look for card/list structures outside tables mentioning ALA
  const textOnly = list.html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  const alaIdx = [...textOnly.matchAll(/ALA/gi)].slice(0, 5).map((m) => textOnly.slice(Math.max(0, m.index! - 150), m.index! + 200));
  console.log("\n--- ALA context samples ---");
  alaIdx.forEach((s, i) => console.log(`[${i}] …${s}…\n`));

  // one detail page to understand completion/deadline fields
  const detail = await fetchUrl("/student/assignment/485178", cookies);
  if (detail.html) {
    fs.writeFileSync("/home/z/my-project/scripts/out-assignment-detail.html", detail.html);
    console.log("detail page len:", detail.html.length, "saved → out-assignment-detail.html");
    const dt = detail.html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
    console.log("--- detail text (first 2500 chars) ---");
    console.log(dt.slice(0, 2500));
  }
}

main()
  .catch((e) => console.error("FATAL", e))
  .finally(() => prisma.$disconnect());
