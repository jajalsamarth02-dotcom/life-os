/**
 * r112 — the SCAN-TO-ADOPT rulebook (qr-pair) + the QR render contract
 * the QrReveal component relies on. Pinned here:
 *   • FAIL-CLOSED ON SCHEME — only absolute http(s) URLs may be encoded;
 *     javascript:, data:, webcal:, bare hosts, empty and null all yield
 *     null → the surface renders NO QR at all (a QR is trusted imagery,
 *     a QR of the wrong thing is worse than none)
 *   • buildWebcalUrl — scheme-swap ONLY, every other byte identical
 *     (query string, token, path); non-http(s) → null
 *   • QR_CAPTIONS — pinned byte-wise; honesty pins: the calendar caption
 *     says the token travels only inside the QR (no third-party drawer),
 *     the WhatsApp caption ends "You press send" (all sending is
 *     student-triggered — the r109 spec), the ntfy caption says the
 *     HUMAN subscribes ("Subscribe there"), never an auto-subscribe
 *   • qrHostLabel — "ntfy.sh" / "wa.me" / any host chip; junk → null
 *     (chip hides, QR stays safe to draw)
 *   • RENDER CONTRACT — QRCode.toDataURL produces a data:image/png URL
 *     for a rulebook-passed payload (the component draws LOCALLY; no
 *     third-party QR service ever sees the private calendar token)
 * Consumers: QrReveal (settings: calendar block, WA wizard step 0,
 * ntfy wizard step 0).
 */
import QRCode from "qrcode";
import {
  QR_CAPTIONS,
  QR_DISPLAY_PX,
  QR_IMG_WIDTH,
  buildWebcalUrl,
  qrHostLabel,
  qrPayloadForCalendar,
  qrPayloadFromLink,
} from "../src/lib/qr-pair";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`FAIL: ${name}${extra ? ` — ${extra}` : ""}`);
  }
}
function eq(name: string, got: unknown, want: unknown) {
  check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

/* ---------- qrPayloadForCalendar — the fail-closed gate ---------- */

const CAL = "https://erp-sync.example.com/api/calendar?token=abc123";

eq("calendar https passes byte-exact", qrPayloadForCalendar(CAL), CAL);
eq("calendar http passes (LAN dev is still a real URL)", qrPayloadForCalendar("http://192.168.1.10:3000/api/calendar?token=t"), "http://192.168.1.10:3000/api/calendar?token=t");
eq("calendar trims whitespace", qrPayloadForCalendar(`  ${CAL}  `), CAL);
eq("calendar null → null", qrPayloadForCalendar(null), null);
eq("calendar undefined → null", qrPayloadForCalendar(undefined), null);
eq("calendar empty → null", qrPayloadForCalendar(""), null);
eq("calendar whitespace-only → null", qrPayloadForCalendar("   "), null);
eq("calendar javascript: → null", qrPayloadForCalendar("javascript:alert(1)"), null);
eq("calendar data: → null", qrPayloadForCalendar("data:text/html;base64,AAAA"), null);
eq("calendar webcal: input → null (webcal is OUTPUT only)", qrPayloadForCalendar("webcal://x.y/api/calendar"), null);
eq("calendar bare host → null", qrPayloadForCalendar("erp-sync.example.com/api/calendar?token=abc123"), null);
eq("calendar ftp: → null", qrPayloadForCalendar("ftp://x.y/f"), null);
check(
  "calendar token survives untouched",
  (qrPayloadForCalendar(CAL) ?? "").endsWith("token=abc123"),
);

/* ---------- qrPayloadFromLink — the wizard-link second gate ---------- */

const WA_LINK = "https://wa.me/34621331709?text=I%20allow%20callmebot%20to%20send%20me%20messages";
const NTFY_LINK = "https://ntfy.sh/erp-sync-abcd1234efgh";

eq("link wa.me passes byte-exact", qrPayloadFromLink(WA_LINK), WA_LINK);
eq("link ntfy web passes byte-exact", qrPayloadFromLink(NTFY_LINK), NTFY_LINK);
eq("link null → null", qrPayloadFromLink(null), null);
eq("link junk string → null", qrPayloadFromLink("not a url"), null);
eq("link javascript: → null (belt-and-braces)", qrPayloadFromLink("javascript:alert(1)"), null);
eq("link data: → null", qrPayloadFromLink("data:text/plain,hi"), null);

/* ---------- buildWebcalUrl — scheme swap, every other byte identical ---------- */

eq("webcal swaps https", buildWebcalUrl(CAL), "webcal://erp-sync.example.com/api/calendar?token=abc123");
eq("webcal swaps http too", buildWebcalUrl("http://192.168.1.10:3000/api/calendar?token=t"), "webcal://192.168.1.10:3000/api/calendar?token=t");
eq("webcal keeps the query byte-exact", (buildWebcalUrl(CAL) ?? "").split("?")[1], "token=abc123");
eq("webcal null input → null", buildWebcalUrl(null as unknown as string), null);
eq("webcal empty → null", buildWebcalUrl(""), null);
eq("webcal already-webcal → null (not double-swapped)", buildWebcalUrl("webcal://x.y/z"), null);
eq("webcal junk → null", buildWebcalUrl("hello world"), null);

/* ---------- QR_CAPTIONS — pinned voice + honesty ---------- */

eq("calendar caption pinned", QR_CAPTIONS.calendar,
  "Point your phone's camera here — the subscription link opens on the phone. The token travels only inside this QR.");
eq("calendar webcal caption pinned", QR_CAPTIONS.calendarWebcal,
  "Scanning opens your iPhone's calendar with a subscribe prompt — confirm once and it stays in sync.");
eq("ntfy caption pinned", QR_CAPTIONS.ntfy,
  "Point your phone's camera here — the topic page opens in the phone's browser. Subscribe there, or install the app from the page.");
eq("wa caption pinned", QR_CAPTIONS.wa,
  "Point your phone's camera here — WhatsApp opens with the activation message already typed. You press send.");

check(
  "HONESTY: calendar caption names the token boundary",
  QR_CAPTIONS.calendar.includes("token travels only inside this QR"),
);
check(
  "HONESTY: wa caption ends with the student pressing send — never an automatic send",
  QR_CAPTIONS.wa.trim().endsWith("You press send."),
);
check(
  "HONESTY: ntfy caption makes the HUMAN subscribe",
  QR_CAPTIONS.ntfy.includes("Subscribe there"),
);
check(
  "HONESTY: no caption promises an automatic send on the student's behalf",
  ![QR_CAPTIONS.calendar, QR_CAPTIONS.calendarWebcal, QR_CAPTIONS.ntfy].some((c) =>
    /sends? (the|it|your) (message|automatically)/i.test(c),
  ),
);

/* ---------- qrHostLabel — the see-before-you-scan chip ---------- */

eq("host ntfy.sh", qrHostLabel(NTFY_LINK), "ntfy.sh");
eq("host wa.me", qrHostLabel(WA_LINK), "wa.me");
eq("host with port", qrHostLabel("http://192.168.1.10:3000/x"), "192.168.1.10:3000");
eq("host of the calendar feed", qrHostLabel(CAL), "erp-sync.example.com");
eq("host junk → null (chip hides, QR stays safe)", qrHostLabel("not a url"), null);

/* ---------- constants the component renders against ---------- */

eq("QR_IMG_WIDTH is 2× the display size (retina-crisp)", QR_IMG_WIDTH, QR_DISPLAY_PX * 2);
eq("display size is camera-friendly", QR_DISPLAY_PX >= 144, true);

/* ---------- THE RENDER CONTRACT — drawn locally, or nothing ---------- */

const drawn = await QRCode.toDataURL(qrPayloadForCalendar(CAL)!, {
  width: QR_IMG_WIDTH,
  margin: 4,
  errorCorrectionLevel: "M",
  color: { dark: "#0f172a", light: "#ffffff" },
});
check("render: data URL prefix", drawn.startsWith("data:image/png;base64,"), drawn.slice(0, 40));
check("render: payload of substance draws a real image", drawn.length > 1000);

const waDrawn = await QRCode.toDataURL(qrPayloadFromLink(WA_LINK)!, {
  width: QR_IMG_WIDTH, margin: 4, errorCorrectionLevel: "M", color: { dark: "#0f172a", light: "#ffffff" },
});
check("render: wa.me link draws a real image", waDrawn.startsWith("data:image/png;base64,"));
check(
  "render: different payloads draw different images",
  drawn !== waDrawn,
);

console.log(`\nqr-pair r112: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
