/**
 * r102 — shared browser download for generated text files (.ics exports).
 *
 * DOM work lives HERE so every builder module stays pure (ics.ts exports
 * strings only; components stay declarative). Both the timetable chip's
 * per-class export (r101) and the command palette's class rows (r102) go
 * through this one path — the anchor-click dance (append → click → remove
 * → revoke) is written once, tested once, and behaves identically
 * everywhere.
 */
export function downloadTextFile(
  text: string,
  filename: string,
  mime = "text/calendar;charset=utf-8"
): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
