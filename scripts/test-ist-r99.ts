/**
 * r99 — the IST stamp sweep: "the clock is the student's, everywhere".
 * Live-confirmed bug (UTC headless browser, Sat 3 Oct 2026): the header
 * sr-only line read "Last sync 3 Oct, 10:21 AM" while the DB instant
 * 2026-10-03T10:21:53.800Z is 15:51 IST — the browser/server's local clock
 * leaked into every instant stamp. Fixed by lib/ist, pinned here:
 *   • istFormat shapes byte-identical to the pre-r99 browser-local faces
 *     ("d MMM, h:mm a" → "3 Oct, 3:51 PM") — only the ZONE changed
 *   • the IST midnight edge: 2026-10-03T18:30:00Z is 00:00 IST Oct 4 — a
 *     UTC clock says "3 Oct", the student's clock says "4 Oct" (the whole
 *     point of the sweep)
 *   • fmtDT/fmtDay (shared) delegate to istFormat — 37 call sites fixed at
 *     the root, null/invalid → "—" preserved
 *   • fmtDateIST/fmtDateTimeIST (engine message stamps) render IST on any
 *     server — the WhatsApp "moved from X to Y" bodies were UTC-shifted
 *   • the header sr-only string itself, built exactly as header.tsx does
 * Fixtures: IST = UTC + 5:30; en-GB/en-US short month names via date-fns.
 */
import { istFormat, fmtDateIST, fmtDateTimeIST, IST_TZ } from "../src/lib/ist";
import { fmtDT, fmtDay } from "../src/components/erp/shared";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

/* the live sync instant from the QA session that exposed the bug */
const SYNC = "2026-10-03T10:21:53.800Z"; // 15:51:53 IST, Saturday

/* 1. istFormat — shapes byte-identical to pre-r99 faces, zone pinned */
check("IST_TZ is Asia/Kolkata", IST_TZ === "Asia/Kolkata");
check("d MMM, h:mm a", istFormat(SYNC, "d MMM, h:mm a") === "3 Oct, 3:51 PM", istFormat(SYNC, "d MMM, h:mm a"));
check("d MMM yyyy", istFormat(SYNC, "d MMM yyyy") === "3 Oct 2026");
check("h:mm a", istFormat(SYNC, "h:mm a") === "3:51 PM");
check("EEE d MMM, h:mm a", istFormat(SYNC, "EEE d MMM, h:mm a") === "Sat 3 Oct, 3:51 PM");
check("EEE d MMM", istFormat(SYNC, "EEE d MMM") === "Sat 3 Oct");
check("d MMM h:mm a", istFormat(SYNC, "d MMM h:mm a") === "3 Oct 3:51 PM");
check("yyyy-MM-dd", istFormat(SYNC, "yyyy-MM-dd") === "2026-10-03");

/* 2. the IST midnight edge — UTC says Oct 3, the student's clock says Oct 4 */
const MIDNIGHT = "2026-10-03T18:30:00.000Z"; // 00:00:00 IST Sun 4 Oct
check("midnight edge → IST next day", istFormat(MIDNIGHT, "d MMM yyyy") === "4 Oct 2026", istFormat(MIDNIGHT, "d MMM yyyy"));
check("midnight edge time is 12:00 AM", istFormat(MIDNIGHT, "h:mm a") === "12:00 AM", istFormat(MIDNIGHT, "h:mm a"));
check("midnight edge weekday is Sun", istFormat(MIDNIGHT, "EEE") === "Sun", istFormat(MIDNIGHT, "EEE"));

/* 5:30 before IST midnight = 18:30 IST same day — must NOT flip */
const EVENING = "2026-10-03T13:00:00.000Z"; // 18:30 IST Sat 3 Oct
check("18:30 IST stays same day", istFormat(EVENING, "d MMM yyyy") === "3 Oct 2026");
check("18:30 IST pm", istFormat(EVENING, "h:mm a") === "6:30 PM");

/* 3. fmtDT / fmtDay — the shared root (37 call sites), null/invalid → "—" */
check("fmtDT shape", fmtDT(SYNC) === "3 Oct, 3:51 PM", fmtDT(SYNC));
check("fmtDay shape", fmtDay(SYNC) === "3 Oct 2026");
check("fmtDT null", fmtDT(null) === "—");
check("fmtDT undefined", fmtDT(undefined) === "—");
check("fmtDT garbage", fmtDT("not-a-date") === "—");
check("fmtDay null", fmtDay(null) === "—");

/* 4. engine message stamps — server-side, zone must not follow the host */
const d = new Date(SYNC);
check("fmtDateIST", fmtDateIST(d) === "03 Oct 2026", fmtDateIST(d));
const dt = fmtDateTimeIST(d);
check("fmtDateTimeIST has IST clock 03:51 pm", /03:51 pm/, dt);
check("fmtDateTimeIST date part", dt.startsWith("03 Oct 2026"), dt);

/* 5. the header sr-only sentence, built exactly as header.tsx builds it */
const lastSyncAt: string | null = SYNC;
const srOnly = `Data synchronized from the college ERP, read-only. ${
  lastSyncAt ? `Last sync ${fmtDT(lastSyncAt)}.` : "Not synced yet."
}`;
check(
  "header sr-only reads the IST clock",
  srOnly === "Data synchronized from the college ERP, read-only. Last sync 3 Oct, 3:51 PM.",
  srOnly
);
check(
  "header sr-only unsynced branch",
  `Data synchronized from the college ERP, read-only. ${lastSyncAt === null ? `Last sync ${fmtDT(lastSyncAt)}.` : "Not synced yet."}`.endsWith("Not synced yet.")
);

/* 6. the notification body, built as use-due-notifications.ts builds it */
const dueAt = "2026-10-05T05:30:00.000Z"; // 11:00 IST Mon 5 Oct — Monday's class
const notifBody = `Due ${istFormat(dueAt, "d MMM, h:mm a")} IST`;
check("notification body pinned + labeled", notifBody === "Due 5 Oct, 11:00 AM IST", notifBody);

/* 7. digest lines, built as digest-dialog.tsx builds them */
check(
  "digest upcoming line",
  `  • ${istFormat(dueAt, "d MMM h:mm a")} — Submit project report (ERP)` === "  • 5 Oct 11:00 AM — Submit project report (ERP)"
);
check(
  "digest range",
  `${istFormat("2026-09-28T00:00:00Z", "d MMM")} – ${istFormat("2026-10-03T00:00:00Z", "d MMM yyyy")}` === "28 Sep – 3 Oct 2026",
  `${istFormat("2026-09-28T00:00:00Z", "d MMM")} – ${istFormat("2026-10-03T00:00:00Z", "d MMM yyyy")}`
);

/* 8. acceptance: 12h hour renders unpadded (date-fns "h"), period is upper */
check("12h hour no pad", istFormat(SYNC, "h") === "3", istFormat(SYNC, "h"));
check("period uppercase", istFormat(SYNC, "a") === "PM", istFormat(SYNC, "a"));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
