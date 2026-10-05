"use client";

/**
 * QrReveal — the scan-to-adopt expander (r112).
 *
 * A quiet toggle that lazily draws the payload as a QR image when the
 * student asks for it. Used by the three adoption surfaces that hand a
 * link to the phone: the WhatsApp repair wizard (wa.me activation link),
 * the ntfy setup wizard (topic web link) and the calendar subscription
 * block (token-protected feed URL, with an iPhone webcal twin).
 *
 * Boundaries (deliberate):
 *  - DRAWN LOCALLY. The image is generated in the browser by the `qrcode`
 *    package — the payload (including the private calendar token) never
 *    leaves this device to be rendered. No <img src="external-qr-api">,
 *    ever.
 *  - ALWAYS DARK-ON-WHITE. The QR sits on a fixed white card regardless
 *    of theme — scanning is contrast-critical, so the app's dark mode
 *    never re-tints the code itself.
 *  - NULL PAYLOAD → NO QR AT ALL. The rulebook (qr-pair) fail-closes on
 *    any non-http(s) payload; this component renders nothing rather than
 *    a broken or misleading square.
 *  - THE ALT TEXT DESCRIBES THE PURPOSE, never the payload — a screen
 *    reader must not read out a private token, and the student who can't
 *    scan still has every copy button the surfaces already provide.
 *  - The iPhone/webcal variant only exists when the caller passes one;
 *    the pills name the PLATFORMS (what the student knows), not schemes.
 */

import { useId, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, QrCode, Smartphone, TriangleAlert } from "lucide-react";
import QRCode from "qrcode";
import { cn } from "@/lib/utils";
import {
  QR_CAPTIONS,
  QR_DISPLAY_PX,
  QR_IMG_WIDTH,
  qrHostLabel,
  type QrVariant,
} from "@/lib/qr-pair";

type QrRevealProps = {
  /** The fail-closed payload from the qr-pair rulebook (null → no QR). */
  payload: string | null;
  /** The honesty caption — qr-pair owns the words. */
  caption: string;
  /** Image alt: the PURPOSE, never the payload. */
  alt: string;
  /** Toggle label — "Scan instead" everywhere except where space is tight. */
  label?: string;
  /** Optional iPhone webcal twin → renders the platform pills. */
  webcalPayload?: string | null;
  /** Caption swap for the webcal variant. */
  webcalCaption?: string;
};

export function QrReveal({
  payload,
  caption,
  alt,
  label = "Scan instead",
  webcalPayload = null,
  webcalCaption = QR_CAPTIONS.calendarWebcal,
}: QrRevealProps) {
  const [open, setOpen] = useState(false);
  const [variant, setVariant] = useState<QrVariant>("https");
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const panelId = useId();

  /* Fail-closed at the surface too: no payload → the affordance vanishes
     (early return sits AFTER every hook — the rules-of-hooks bar). */
  const effective = variant === "webcal" && webcalPayload ? webcalPayload : payload;
  const host = effective ? qrHostLabel(effective) : null;

  useEffect(() => {
    if (!open || !effective) return;
    let cancelled = false;
    setFailed(false);
    QRCode.toDataURL(effective, {
      width: QR_IMG_WIDTH,
      margin: 4,
      errorCorrectionLevel: "M",
      color: { dark: "#0f172a", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) {
          setDataUrl(null);
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, effective]);

  if (!payload) return null;

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-background px-2.5 text-[11px] font-medium text-muted-foreground",
            "transition-colors hover:border-border hover:bg-muted hover:text-foreground",
            "motion-safe:active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          )}
        >
          <QrCode className="size-3.5" aria-hidden="true" />
          {open ? "Hide QR" : label}
          <ChevronDown
            className={cn("size-3 transition-transform duration-200", open && "rotate-180")}
            aria-hidden="true"
          />
        </button>

        {/* Platform pills — only when an iPhone twin exists. Names say
           PLATFORM, not scheme: the student has never heard of webcal. */}
        {open && webcalPayload && (
          <div role="group" aria-label="Which phone will scan this QR" className="flex items-center gap-1">
            {(
              [
                { key: "https" as const, text: "Android & web" },
                { key: "webcal" as const, text: "iPhone calendar" },
              ]
            ).map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setVariant(p.key)}
                aria-pressed={variant === p.key}
                className={cn(
                  "inline-flex h-6 items-center gap-1 rounded-full px-2 text-[10px] font-medium transition-colors",
                  variant === p.key
                    ? "bg-foreground text-background"
                    : "border border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {p.key === "webcal" && <Smartphone className="size-3" aria-hidden="true" />}
                {p.text}
              </button>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            key="qr-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-2">
              {dataUrl ? (
                <div className="w-fit rounded-xl border border-border/60 bg-white p-3 shadow-sm">
                  {/* Fixed dark-on-white — scanning is contrast-critical and
                     never theme-adaptive. Rendered at 2×, shown at 1×. */}
                  { }
                  <img
                    src={dataUrl}
                    alt={alt}
                    width={QR_DISPLAY_PX}
                    height={QR_DISPLAY_PX}
                    className="block rounded-md"
                    style={{ width: QR_DISPLAY_PX, height: QR_DISPLAY_PX }}
                  />
                  {host && (
                    <p className="mt-2 flex items-center justify-center gap-1">
                      <span className="inline-flex max-w-full items-center truncate rounded-full bg-muted/80 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {host}
                      </span>
                    </p>
                  )}
                </div>
              ) : failed ? (
                <p className="flex items-start gap-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  Couldn&apos;t draw the QR — use the copy button above instead.
                </p>
              ) : (
                <div
                  className="rounded-xl border border-border/60 bg-white p-3 shadow-sm"
                  aria-hidden="true"
                >
                  <div
                    className="animate-pulse rounded-md bg-muted"
                    style={{ width: QR_DISPLAY_PX, height: QR_DISPLAY_PX }}
                  />
                </div>
              )}
              <p className="max-w-[52ch] text-[11px] leading-snug text-muted-foreground">
                {variant === "webcal" && webcalPayload ? webcalCaption : caption}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
