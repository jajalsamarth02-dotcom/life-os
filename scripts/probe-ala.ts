/**
 * One-off authorized probe: discover whether the GMIU ERP publishes an
 * "ALA" (Active Learning Assignment) section for this student, and what
 * its page structure looks like. Uses the app's own stored connection
 * (same as the sync engine — student's own credentials, server-side).
 */
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

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
  try {
    const res = await fetch(`${BASE}${path}`, {
      redirect: "manual",
      headers: { "User-Agent": UA, Accept: "text/html", Cookie: cookieHeader(cookies) },
      signal: AbortSignal.timeout(15000),
    });
    const out = collectCookies(res, cookies);
    const loc = res.headers.get("location") ?? "";
    if (res.status >= 300 && res.status < 400) {
      return { status: res.status, loc, html: "", cookies: out };
    }
    return { status: res.status, loc, html: await res.text(), cookies: out };
  } catch (e) {
    return { status: -1, loc: "", html: "", cookies, err: String(e) };
  }
}

async function main() {
  const conn = await prisma.erpConnection.findFirst({ orderBy: { updatedAt: "desc" } });
  if (!conn) {
    console.log("NO_CONNECTION_ROW");
    return;
  }
  const username = conn.username;
  const password = decryptSecret(conn.secretEnc);
  const savedCookie = conn.sessionCookieEnc ? decryptSecret(conn.sessionCookieEnc) : null;
  console.log("connection:", conn.username, conn.status, "savedCookie:", savedCookie ? "yes" : "no");

  let cookies = new Map<string, string>();
  if (savedCookie) {
    for (const pair of savedCookie.split(";")) {
      const i = pair.indexOf("=");
      if (i > 0) cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }

  // verify session on dashboard
  let dash = await fetchUrl("/student/dashboard", cookies);
  if (dash.html.includes('name="password"') || (dash.status >= 300 && dash.status < 400 && /login/i.test(dash.loc))) {
    console.log("saved session dead — logging in fresh");
    const loginPage = await fetchUrl("/student/login", new Map());
    const html = loginPage.html;
    const csrf = (html.match(/name="_token"\s+value="([^"]+)"/) ?? [])[1];
    if (!csrf) {
      console.log("NO_CSRF_FOUND");
      return;
    }
    const res = await fetch(`${BASE}/student/login`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieHeader(loginPage.cookies),
        Referer: `${BASE}/student/login`,
      },
      body: new URLSearchParams({ _token: csrf, email: username, password, remember: "on", submit: "Login" }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    cookies = collectCookies(res, loginPage.cookies);
    console.log("login POST status:", res.status, "loc:", res.headers.get("location"));
    dash = await fetchUrl("/student/dashboard", cookies);
  }
  console.log("dashboard status:", dash.status, "len:", dash.html.length);

  // 1) Extract every menu/sidebar link from the dashboard
  const links = [...dash.html.matchAll(/href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({ href: m[1], text: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() }))
    .filter((l) => l.href.startsWith("/") || l.href.includes("gmiu"));
  const interesting = links.filter((l) =>
    /ala|assign|active|learn|task|homework|submission|report|exam|notice|circular|material|syllabus/i.test(l.href + " " + l.text)
  );
  console.log("\n--- LINKS (interesting) ---");
  for (const l of interesting.slice(0, 40)) console.log(`  ${l.href}  ⇒  ${l.text.slice(0, 60)}`);

  // 2) Probe candidate ALA paths
  const candidates = [
    "/student/ala",
    "/student/ala-list",
    "/student/ala/list",
    "/student/alalist",
    "/student/active-learning-assignment",
    "/student/assignment",
    "/student/assignments",
    "/student/assignment-list",
  ];
  console.log("\n--- PROBES ---");
  for (const p of candidates) {
    const r = await fetchUrl(p, cookies);
    const finalHtml = r.html;
    const isLogin = finalHtml.includes('name="password"');
    console.log(`  ${p} → status ${r.status}${r.loc ? ` → ${r.loc}` : ""} len ${finalHtml.length}${isLogin ? " [LOGIN]" : ""}${/404|not found/i.test(finalHtml.slice(0, 3000)) && finalHtml.length < 8000 ? " [404-ish]" : ""}`);
    if (finalHtml.length > 0 && !isLogin) {
      // dump title
      const t = (finalHtml.match(/<title>([\s\S]*?)<\/title>/i) ?? [])[1];
      if (t) console.log(`      title: ${t.replace(/\s+/g, " ").trim().slice(0, 100)}`);
    }
    await new Promise((r2) => setTimeout(r2, 400));
  }

  // save dashboard html for offline inspection
  const fs = await import("fs");
  fs.writeFileSync("/home/z/my-project/scripts/out-dashboard.html", dash.html);
  console.log("\nsaved dashboard html → scripts/out-dashboard.html");
}

main()
  .catch((e) => console.error("FATAL", e))
  .finally(() => prisma.$disconnect());
