// <iot-chart> — multi-series line chart. SVG, no deps.
//
// Properties set by the page:
//   - series: Array<{ key: string; label?: string; color?: string; points: Array<{ ts: number; value: number }> }>
//
// The page appends new points to the matching series on each update.

type SeriesPoint = { ts: number; value: number };
type SeriesData = { key: string; label?: string; color?: string; points: SeriesPoint[] };

const PALETTE = ['#ea580c', '#0ea5e9', '#10b981', '#a855f7', '#f59e0b', '#ef4444'];

const TEMPLATE = `
  <style>
    :host {
      display: block;
      height: 100%;
      width: 100%;
      box-sizing: border-box;
      container-type: size;
      font-family: system-ui, sans-serif;
      color: var(--color-text, #171717);
    }
    .card {
      display: flex;
      flex-direction: column;
      height: 100%;
      width: 100%;
      box-sizing: border-box;
      padding: clamp(10px, 5cqmin, 18px);
      background: var(--color-bg-elevated, white);
      border: 1px solid var(--color-border, #e5e5e5);
      border-radius: 10px;
      transition: border-color 120ms ease;
      overflow: hidden;
      gap: clamp(4px, 2cqmin, 10px);
    }
    .card:hover { border-color: var(--color-border-strong, #d4d4d4); }
    .title {
      font-size: clamp(10px, 4cqmin, 13px);
      color: var(--color-text-muted, #525252);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex-shrink: 0;
    }
    .chart-area {
      flex: 1;
      min-height: 0;
      width: 100%;
      position: relative;
    }
    svg { width: 100%; height: 100%; display: block; }
    svg .grid-line { stroke: var(--color-border, #e5e5e5); stroke-opacity: 0.4; stroke-dasharray: 2 3; }
    svg .empty-text { fill: var(--color-text-faint, #a3a3a3); }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 0.6em 0.9em;
      font-size: clamp(9px, 3.5cqmin, 12px);
      color: var(--color-text-muted, #525252);
      flex-shrink: 0;
    }
    .legend-item { display: inline-flex; align-items: center; gap: 0.35em; }
    .swatch {
      width: 0.7em;
      height: 0.7em;
      border-radius: 2px;
      flex-shrink: 0;
    }
    .footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75em;
      flex-shrink: 0;
    }
    .ts {
      font-size: 9px;
      color: var(--color-text-faint, #a3a3a3);
      font-variant-numeric: tabular-nums;
      line-height: 1;
      white-space: nowrap;
    }
  </style>
  <div class="card">
    <div class="title"></div>
    <div class="chart-area">
      <svg viewBox="0 0 400 200" preserveAspectRatio="none"></svg>
    </div>
    <div class="footer">
      <div class="legend"></div>
      <div class="ts"></div>
    </div>
  </div>
`;

export class IotChartElement extends HTMLElement {
  #series: SeriesData[] = [];
  #maxPoints = 600;

  static get observedAttributes() { return ['data-title']; }

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = TEMPLATE;
  }

  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }

  set series(s: SeriesData[]) {
    this.#series = s.map((row) => ({
      ...row,
      points: [...row.points].sort((a, b) => a.ts - b.ts),
    }));
    this.render();
  }
  get series(): SeriesData[] { return this.#series; }

  appendPoint(key: string, point: SeriesPoint): void {
    const s = this.#series.find((x) => x.key === key);
    if (!s) return;
    s.points.push(point);
    if (s.points.length > this.#maxPoints) s.points = s.points.slice(-this.#maxPoints);
    this.render();
  }

  private render() {
    const shadow = this.shadowRoot!;
    shadow.querySelector('.title')!.textContent = this.getAttribute('data-title') ?? '';
    const svg = shadow.querySelector('svg')!;
    const legend = shadow.querySelector('.legend')!;
    const tsEl = shadow.querySelector('.ts')!;
    svg.innerHTML = '';
    legend.innerHTML = '';
    tsEl.textContent = '';

    const all = this.#series.flatMap((s) => s.points);
    if (all.length === 0) {
      svg.innerHTML = `<text x="200" y="100" text-anchor="middle" class="empty-text" font-size="12">No data yet</text>`;
      return;
    }

    const minTs = Math.min(...all.map((p) => p.ts));
    const maxTs = Math.max(...all.map((p) => p.ts));
    tsEl.textContent = new Date(maxTs * 1000).toLocaleTimeString();
    const minV = Math.min(...all.map((p) => p.value));
    const maxV = Math.max(...all.map((p) => p.value));
    const tSpan = Math.max(1, maxTs - minTs);
    const vSpan = Math.max(0.0001, maxV - minV);

    const W = 400, H = 200, PAD = 8;
    const xs = (ts: number) => PAD + ((ts - minTs) / tSpan) * (W - 2 * PAD);
    const ys = (v: number) => H - PAD - ((v - minV) / vSpan) * (H - 2 * PAD);

    // Horizontal grid lines (3 of them, evenly spaced).
    for (let i = 1; i <= 3; i++) {
      const y = PAD + (i / 4) * (H - 2 * PAD);
      svg.innerHTML += `<line class="grid-line" x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" />`;
    }

    this.#series.forEach((s, i) => {
      if (s.points.length === 0) return;
      const color = s.color ?? PALETTE[i % PALETTE.length]!;
      const d = s.points
        .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${xs(p.ts).toFixed(2)} ${ys(p.value).toFixed(2)}`)
        .join(' ');
      svg.innerHTML += `<path d="${d}" stroke="${color}" stroke-width="1.75" fill="none" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />`;

      const item = document.createElement('span');
      item.className = 'legend-item';
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = color;
      const label = document.createElement('span');
      label.textContent = s.label ?? s.key;
      item.append(swatch, label);
      legend.appendChild(item);
    });
  }
}
