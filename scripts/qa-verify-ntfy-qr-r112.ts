/**
 * r112 QA — live decode-by-comparison: the QR the browser actually drew
 * (extracted from the DOM) must be byte-identical to a local render of
 * the EXPECTED payload for the ntfy topic the wizard minted. Proves the
 * QR encodes the exact https web link — no drift between rulebook and
 * pixels.
 */
import QRCode from "qrcode";
import { readFileSync } from "node:fs";

const raw = readFileSync("/tmp/ntfy-qr-state.json", "utf8").trim();
const state = JSON.parse(JSON.parse(raw));

const domQr: string = state.qr;
const topic: string = state.topic;
const webAnchor: string | null = state.webAnchor ?? null;

const expectedLink = `https://ntfy.sh/${topic}`;
const localQr = await QRCode.toDataURL(expectedLink, {
  width: 336,
  margin: 4,
  errorCorrectionLevel: "M",
  color: { dark: "#0f172a", light: "#ffffff" },
});

console.log("topic:", topic);
console.log("expected link:", expectedLink);
console.log("web anchor (https):", webAnchor);
console.log("DOM QR === local render of expected link:", domQr === localQr);
if (domQr !== localQr) {
  console.log("dom len:", domQr.length, "local len:", localQr.length);
  process.exit(1);
}
console.log("PASS — the wizard's QR pixel-encodes the exact documented web link");
