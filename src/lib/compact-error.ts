/**
 * Reduce a raw error string (e.g. Prisma dumps the whole invocation snippet
 * with file paths and code frames) to the single meaningful reason line so
 * logs, notifications and UI stay readable.
 *
 * Strategy: pick the LAST non-empty line — for Prisma-style errors that is the
 * actual reason ("Unknown argument `x`...", "Timed out fetching..."); for
 * plain single-line errors it is the line itself. Cap the length.
 */
export function compactErrorText(raw: string, max = 300): string {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return raw.slice(0, max);
  const reason = lines[lines.length - 1];
  // Prefer the trailing "reason" line, but if the error is short overall just
  // use the first line (some errors put the reason first).
  const text = lines.length > 1 ? reason : lines[0];
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
