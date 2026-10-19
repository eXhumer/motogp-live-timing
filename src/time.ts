/** Convert a timing value (1/10 000 s) to milliseconds. */
export function toMilliseconds(value: number): number {
  return value / 10;
}

/** Format a timing value (1/10 000 s) as `m:ss.SSS`, or `''` for zero or less. */
export function formatLapTime(value: number): string {
  if (!(value > 0)) return '';
  const ms = Math.round(value / 10);
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

/** Format a gap (1/10 000 s) as `s.SSS`, or `m.ss.SSS` from a minute, the way the web app does. */
export function formatGap(value: number): string {
  if (!(value > 0)) return '';
  const ms = Math.round(value / 10);
  const seconds = Math.floor(ms / 1000);
  const fraction = String(ms % 1000).padStart(3, '0');
  if (seconds < 60) return `${seconds}.${fraction}`;
  return `${Math.floor(seconds / 60)}.${String(seconds % 60).padStart(2, '0')}.${fraction}`;
}
