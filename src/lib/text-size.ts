/**
 * Text-size accessibility setting (A− / A / A+).
 *
 * Scales the whole UI by overriding the root font-size: the design system is
 * rem-based (Tailwind), so every spacing/typography token follows along.
 * Persisted in localStorage and applied pre-paint by a tiny inline script in
 * `layout.tsx` (same pattern as next-themes) to avoid a flash of the wrong size.
 *
 * NOTE: keep the storage key below in sync with the inline script in layout.tsx.
 */

export type TextSize = "sm" | "md" | "lg";

export const TEXT_SIZE_KEY = "erp-text-size";

/** Fired on `window` after any apply so open cards/palette can refresh. */
export const TEXT_SIZE_EVENT = "erp:text-size";

export const TEXT_SIZES: {
  key: TextSize;
  label: string;
  /** Root font-size in px applied for this step. */
  px: number;
  hint: string;
}[] = [
  { key: "sm", label: "Compact", px: 15, hint: "More content per screen" },
  { key: "md", label: "Default", px: 16, hint: "The designed size" },
  { key: "lg", label: "Large", px: 17.5, hint: "Easier on the eyes" },
];

export function normalizeTextSize(v: unknown): TextSize {
  return v === "sm" || v === "md" || v === "lg" ? v : "md";
}

export function readTextSize(): TextSize {
  if (typeof window === "undefined") return "md";
  try {
    return normalizeTextSize(window.localStorage.getItem(TEXT_SIZE_KEY));
  } catch {
    return "md";
  }
}

/** Root px for a size ("md" restores the browser default by clearing the override). */
export function textSizePx(t: TextSize): number {
  return TEXT_SIZES.find((s) => s.key === t)?.px ?? 16;
}

export function applyTextSize(t: TextSize): void {
  if (typeof document === "undefined") return;
  if (t === "md") {
    document.documentElement.style.removeProperty("font-size");
  } else {
    document.documentElement.style.fontSize = `${textSizePx(t)}px`;
  }
}

/** Apply + persist + broadcast. */
export function setTextSize(t: TextSize): void {
  applyTextSize(t);
  try {
    window.localStorage.setItem(TEXT_SIZE_KEY, t);
  } catch {
    // storage unavailable (private mode) — size still applies for this visit
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(TEXT_SIZE_EVENT));
}

export function cycleTextSize(t: TextSize): TextSize {
  const i = TEXT_SIZES.findIndex((s) => s.key === t);
  return TEXT_SIZES[(i + 1) % TEXT_SIZES.length].key;
}
