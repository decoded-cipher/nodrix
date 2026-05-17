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
      display: flex;
      flex-direction: column;
      height: 100%;
      padding: 1rem;
      box-sizing: border-box;
      background: white;
      border: 1px solid #e5e5e5;
      border-radius: 8px;
      font-family: system-ui, sans-serif;
    }
    .title { font-size: 0.75rem; color: #525252; text-transform: uppercase; letter-spacing: 0.05em; }
    svg { flex: 1; width: 100%; min-height: 0; }
    .legend { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 0.5rem; font-size: 0.75rem; color: #525252; }
    .swatch { display: inline-block; width: 0.75rem; height: 0.75rem; border-radius: 2px; vertical-align: middle; margin-right: 0.25rem; }
    .empty { display: flex; align-items: center; justify-content: center; height: 100%; color: #a3a3a3; font-size: 0.875rem; }
  </style>
  <div class="title"></div>
  <svg viewBox="0 0 400 200" preserveAspectRatio="none"></svg>
  <div class="legend"></div>
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
    svg.innerHTML = '';
    legend.innerHTML = '';

    const all = this.#series.flatMap((s) => s.points);
    if (all.length === 0) {
      svg.innerHTML = `<text x="200" y="100" text-anchor="middle" fill="#a3a3a3" font-size="12">No data yet</text>`;
      return;
    }

    const minTs = Math.min(...all.map((p) => p.ts));
    const maxTs = Math.max(...all.map((p) => p.ts));
    const minV = Math.min(...all.map((p) => p.value));
    const maxV = Math.max(...all.map((p) => p.value));
    const tSpan = Math.max(1, maxTs - minTs);
    const vSpan = Math.max(0.0001, maxV - minV);

    const W = 400, H = 200, PAD = 8;
    const xs = (ts: number) => PAD + ((ts - minTs) / tSpan) * (W - 2 * PAD);
    const ys = (v: number) => H - PAD - ((v - minV) / vSpan) * (H - 2 * PAD);

    this.#series.forEach((s, i) => {
      if (s.points.length === 0) return;
      const color = s.color ?? PALETTE[i % PALETTE.length]!;
      const d = s.points
        .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${xs(p.ts).toFixed(2)} ${ys(p.value).toFixed(2)}`)
        .join(' ');
      svg.innerHTML += `<path d="${d}" stroke="${color}" stroke-width="1.5" fill="none" />`;

      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = color;
      const label = document.createElement('span');
      label.textContent = s.label ?? s.key;
      const wrap = document.createElement('span');
      wrap.append(swatch, label);
      legend.appendChild(wrap);
    });
  }
}
