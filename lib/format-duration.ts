/**
 * Format a millisecond duration as a short human string:
 * under 1000ms → "920ms"; otherwise seconds with one decimal → "1.2s".
 * Returns "—" for negative or non-finite input.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
