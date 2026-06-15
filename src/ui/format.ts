/**
 * Shared display formatters — used by both Builder and Runner.
 */

/** Format a duration as "m:ss" (e.g. 0:00, 3:05, 25:00). */
export function fmtClock(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** Format a total duration for the read-only Total Time display. */
export function fmtTotal(secs: number): { val: string | number; unit: string } {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m === 0) return { val: s, unit: s === 1 ? 'sec' : 'secs' };
  if (s === 0) return { val: m, unit: 'min' };
  return { val: `${m}:${String(s).padStart(2, '0')}`, unit: 'min' };
}

/** Escape HTML special characters to safely set textContent-equivalent via innerHTML. */
export function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c),
  );
}
