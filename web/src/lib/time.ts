// Small time helpers shared across the automations UI. Timestamps are unix
// seconds (the API's convention).

export function formatAbsolute(ts: number | null | undefined): string {
  return ts ? new Date(ts * 1000).toLocaleString() : '—';
}

// Compact "5m ago" / "in 2h" style relative time. Returns '' for nullish.
export function relativeTime(ts: number | null | undefined): string {
  if (!ts) return '';
  const diff = ts * 1000 - Date.now();
  const abs = Math.abs(diff);
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60_000, 'second'],
    [3_600_000, 'minute'],
    [86_400_000, 'hour'],
    [604_800_000, 'day'],
    [2_629_800_000, 'week'],
    [31_557_600_000, 'month'],
    [Infinity, 'year'],
  ];
  const divisors: Record<string, number> = {
    second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000,
    week: 604_800_000, month: 2_629_800_000, year: 31_557_600_000,
  };
  if (abs < 45_000) return diff < 0 ? 'just now' : 'soon';
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [limit, unit] of units) {
    if (abs < limit) {
      return rtf.format(Math.round(diff / divisors[unit]!), unit);
    }
  }
  return '';
}
