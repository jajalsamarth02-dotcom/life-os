"use client";

import { useEffect, useState } from "react";

/**
 * PWA install-prompt plumbing.
 *
 * Chromium fires `beforeinstallprompt` with a deferrable prompt; we capture it
 * once (module scope survives hot reloads) and expose reactive state.
 * iOS Safari never fires the event — expose a detector so the Settings card
 * can show "Add to Home Screen" instructions instead.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

if (typeof window !== "undefined") {
  installed =
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
    window.localStorage.getItem("erp.pwa.installed") === "1";

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    emit();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installed = true;
    try {
      window.localStorage.setItem("erp.pwa.installed", "1");
    } catch {
      /* non-fatal */
    }
    emit();
  });
}

export function isStandalone(): boolean {
  return installed;
}

export function isIOS(): boolean {
  if (typeof window === "undefined" || typeof window.navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(window.navigator.userAgent) ||
    // iPadOS 13+ identifies as Mac with touch support
    (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1)
  );
}

/** Reactive flag: a native install prompt is available right now. */
export function useCanInstall(): boolean {
  /* Initial state MUST be false on both server and client's first (hydrating)
     render — reading `deferredPrompt` here would mismatch the SSR HTML whenever
     the browser fires beforeinstallprompt before React hydrates. */
  const [can, setCan] = useState(false);
  useEffect(() => {
    const update = () => setCan(deferredPrompt !== null);
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
    };
  }, []);
  return can && !installed;
}

/** Reactive flag: the app is already running installed (standalone). */
export function useIsInstalled(): boolean {
  /* Same hydration rule: start false, sync the real value after mount. */
  const [val, setVal] = useState(false);
  useEffect(() => {
    const update = () => setVal(installed);
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
    };
  }, []);
  return val;
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferredPrompt) return "unavailable";
  try {
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    emit();
    return outcome;
  } catch {
    return "unavailable";
  }
}
