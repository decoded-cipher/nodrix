// Compact, columnar encoding for chart series shipped to dashboards.
//
// The old wire shape was a flat `{ ts, variable, value }[]`, which repeats the
// variable name and the field keys once per point — the dominant cost of the
// /state payload. Grouping by variable into parallel `t`/`v` arrays writes each
// name once. Values are coerced to numbers (charts are numeric) and non-finite
// samples dropped. An optional `cap` stride-samples dense series so the payload
// stays bounded regardless of how often a device reports.

export type CompactSeries = Record<string, { t: number[]; v: number[] }>;

type SeriesRow = { ts: number; variable: string; value: unknown };

// Rows must already be ordered by ts ASC (the ring-buffer queries are).
export function toCompactSeries(rows: SeriesRow[], cap?: number): CompactSeries {
  const out: CompactSeries = {};
  for (const r of rows) {
    const v = typeof r.value === 'number' ? r.value : Number(r.value);
    if (!Number.isFinite(v)) continue;
    let s = out[r.variable];
    if (!s) {
      s = { t: [], v: [] };
      out[r.variable] = s;
    }
    s.t.push(r.ts);
    s.v.push(v);
  }
  if (cap && cap > 0) {
    for (const key of Object.keys(out)) {
      const s = out[key]!;
      if (s.t.length > cap) out[key] = stride(s, cap);
    }
  }
  return out;
}

// Keep every k-th point (k = ceil(len/cap)), always including the final sample so
// the chart's right edge stays current. Deterministic, so the edge cache holds.
function stride(s: { t: number[]; v: number[] }, cap: number): { t: number[]; v: number[] } {
  const len = s.t.length;
  const k = Math.ceil(len / cap);
  const t: number[] = [];
  const v: number[] = [];
  for (let i = 0; i < len; i += k) {
    t.push(s.t[i]!);
    v.push(s.v[i]!);
  }
  if (t[t.length - 1] !== s.t[len - 1]) {
    t.push(s.t[len - 1]!);
    v.push(s.v[len - 1]!);
  }
  return { t, v };
}
