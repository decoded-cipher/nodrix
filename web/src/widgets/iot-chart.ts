// <iot-chart> — multi-series time-series chart, powered by ApexCharts.
//
// Attributes:
//   - data-title
//   - data-chart-type   'line' | 'area' | 'bar' | 'stepline'  (default 'line')
//   - data-smooth       'true' | 'false'                       (default 'true' for line/area)
//   - data-stacked      'true' | 'false'                       (default 'false')
//   - data-zoom         'true' | 'false'                       (default 'false' — toolbar off)
//
// Properties:
//   - series: Array<{ key, label?, color?, points: Array<{ ts, value }> }>
//
// The page calls appendPoint(key, {ts, value}) on each WS update; we feed
// that into apex's appendData() so live ticks animate in.

import ApexCharts from 'apexcharts';
import apexCss from 'apexcharts/dist/apexcharts.css?raw';

type SeriesPoint = { ts: number; value: number };
type SeriesData = { key: string; label?: string; color?: string; points: SeriesPoint[] };
type ChartType = 'line' | 'area' | 'bar' | 'stepline';

const PALETTE = ['#ea580c', '#0ea5e9', '#10b981', '#a855f7', '#f59e0b', '#ef4444'];

const WIDGET_CSS = `
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
    display: grid;
    grid-template-rows: auto 1fr auto;
    gap: clamp(4px, 2cqmin, 8px);
    height: 100%;
    width: 100%;
    box-sizing: border-box;
    padding: clamp(10px, 4cqmin, 16px);
    background: var(--color-bg-elevated, white);
    border: 1px solid var(--color-border, #e5e5e5);
    border-radius: 10px;
    transition: border-color 120ms ease;
    overflow: hidden;
  }
  .card:hover { border-color: var(--color-border-strong, #d4d4d4); }
  .title {
    font-size: clamp(10px, min(8cqh, 4cqw), 14px);
    color: var(--color-text-muted, #525252);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chart-host {
    min-height: 0;
    min-width: 0;
    position: relative;
  }
  .ts {
    font-size: 9px;
    color: var(--color-text-faint, #a3a3a3);
    font-variant-numeric: tabular-nums;
    line-height: 1;
    text-align: right;
    white-space: nowrap;
  }
  /* Bring ApexCharts text colors in line with the dashboard theme. */
  :host .apexcharts-text,
  :host .apexcharts-legend-text,
  :host .apexcharts-tooltip-text,
  :host .apexcharts-xaxistooltip-text {
    fill: var(--color-text-muted, #525252) !important;
    color: var(--color-text-muted, #525252) !important;
  }
  :host .apexcharts-tooltip {
    background: var(--color-bg-elevated, white) !important;
    border-color: var(--color-border, #e5e5e5) !important;
    color: var(--color-text, #171717) !important;
  }
  :host .apexcharts-tooltip-title {
    background: var(--color-bg, #fafafa) !important;
    border-color: var(--color-border, #e5e5e5) !important;
  }
  :host .apexcharts-gridline { stroke: var(--color-border, #e5e5e5) !important; opacity: 0.45; }
`;

export class IotChartElement extends HTMLElement {
  #series: SeriesData[] = [];
  #maxPoints = 600;
  #chart: ApexCharts | null = null;
  #host: HTMLElement | null = null;
  #pendingFrame: number | null = null;

  static get observedAttributes() {
    return ['data-title', 'data-chart-type', 'data-smooth', 'data-stacked', 'data-zoom'];
  }

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    // Apex's stylesheet is injected into the document head by default —
    // which can't reach into shadow DOM. Bundle it as raw text and put a
    // copy inside the shadow root so legend / tooltip / axes look right.
    shadow.innerHTML = `
      <style>${WIDGET_CSS}</style>
      <style>${apexCss}</style>
      <div class="card">
        <div class="title"></div>
        <div class="chart-host"></div>
        <div class="ts"></div>
      </div>
    `;
    this.#host = shadow.querySelector('.chart-host');
  }

  connectedCallback() {
    this.renderTitle();
    this.scheduleRebuild();
  }

  disconnectedCallback() {
    if (this.#pendingFrame !== null) {
      cancelAnimationFrame(this.#pendingFrame);
      this.#pendingFrame = null;
    }
    this.destroyChart();
  }

  attributeChangedCallback(name: string) {
    if (name === 'data-title') {
      this.renderTitle();
      return;
    }
    // Anything that affects chart construction → rebuild.
    this.scheduleRebuild();
  }

  set series(s: SeriesData[]) {
    this.#series = s.map((row) => ({
      ...row,
      points: [...row.points].sort((a, b) => a.ts - b.ts),
    }));
    this.scheduleRebuild();
  }
  get series(): SeriesData[] { return this.#series; }

  appendPoint(key: string, point: SeriesPoint): void {
    const idx = this.#series.findIndex((s) => s.key === key);
    if (idx < 0) return;
    const s = this.#series[idx]!;
    s.points.push(point);
    if (s.points.length > this.#maxPoints) s.points = s.points.slice(-this.#maxPoints);

    this.updateTs();
    if (this.#chart) {
      // Live push — keeps existing axes/animations rather than rebuilding.
      this.#chart.appendData([{ data: [{ x: point.ts * 1000, y: point.value }] }]);
    } else {
      this.scheduleRebuild();
    }
  }

  private renderTitle() {
    const t = this.shadowRoot!.querySelector('.title');
    if (t) t.textContent = this.getAttribute('data-title') ?? '';
  }

  private updateTs() {
    const tsEl = this.shadowRoot!.querySelector('.ts');
    if (!tsEl) return;
    const all = this.#series.flatMap((s) => s.points);
    if (all.length === 0) {
      tsEl.textContent = '';
      return;
    }
    const maxTs = Math.max(...all.map((p) => p.ts));
    tsEl.textContent = new Date(maxTs * 1000).toLocaleTimeString();
  }

  private destroyChart() {
    if (this.#chart) {
      this.#chart.destroy();
      this.#chart = null;
    }
  }

  // Coalesce rapid rebuild requests (initial mount, attribute flurry,
  // series push) into one paint.
  private scheduleRebuild() {
    if (this.#pendingFrame !== null) return;
    this.#pendingFrame = requestAnimationFrame(() => {
      this.#pendingFrame = null;
      this.rebuild();
    });
  }

  private rebuild() {
    if (!this.#host) return;
    this.destroyChart();
    this.updateTs();

    const type = this.chartType();
    const smooth = this.boolAttr('data-smooth', type !== 'bar' && type !== 'stepline');
    const stacked = this.boolAttr('data-stacked', false);
    const zoom = this.boolAttr('data-zoom', false);

    const apexType: 'line' | 'area' | 'bar' = type === 'bar' ? 'bar' : type === 'area' ? 'area' : 'line';
    const curve: 'smooth' | 'straight' | 'stepline' =
      type === 'stepline' ? 'stepline' : smooth ? 'smooth' : 'straight';

    const seriesData = this.#series.map((s, i) => ({
      name: s.label ?? s.key,
      color: s.color ?? PALETTE[i % PALETTE.length]!,
      data: s.points.map((p) => ({ x: p.ts * 1000, y: p.value })),
    }));

    const options: ApexCharts.ApexOptions = {
      chart: {
        type: apexType,
        height: '100%',
        stacked,
        toolbar: { show: zoom, tools: { zoom: zoom, zoomin: zoom, zoomout: zoom, pan: zoom, reset: zoom, download: false, selection: false } },
        zoom: { enabled: zoom, type: 'x' },
        animations: { enabled: true, speed: 250 },
        fontFamily: 'system-ui, sans-serif',
        background: 'transparent',
        foreColor: 'var(--color-text-muted, #525252)',
      },
      series: seriesData,
      colors: seriesData.map((s) => s.color as string),
      stroke: {
        curve,
        width: type === 'bar' ? 0 : 2,
        lineCap: 'round',
      },
      fill: type === 'area'
        ? { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05, stops: [0, 100] } }
        : { type: 'solid', opacity: type === 'bar' ? 0.9 : 1 },
      dataLabels: { enabled: false },
      markers: {
        size: 0,
        hover: { size: 4 },
      },
      xaxis: {
        type: 'datetime',
        labels: {
          datetimeUTC: false,
          style: { fontSize: '10px' },
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: {
          style: { fontSize: '10px' },
          formatter: (v: number) => formatNumber(v),
        },
      },
      tooltip: {
        x: { format: 'HH:mm:ss' },
        theme: isDark() ? 'dark' : 'light',
      },
      legend: {
        show: this.#series.length > 1,
        position: 'bottom',
        fontSize: '11px',
        markers: { size: 5 },
        itemMargin: { horizontal: 8, vertical: 2 },
      },
      grid: {
        borderColor: 'var(--color-border, #e5e5e5)',
        strokeDashArray: 3,
        padding: { left: 0, right: 0, top: 0, bottom: 0 },
      },
      noData: {
        text: 'No data yet',
        style: { fontSize: '12px', color: 'var(--color-text-faint, #a3a3a3)' },
      },
    };

    this.#chart = new ApexCharts(this.#host, options);
    this.#chart.render();
  }

  private chartType(): ChartType {
    const t = (this.getAttribute('data-chart-type') ?? 'line').toLowerCase();
    return t === 'area' || t === 'bar' || t === 'stepline' ? (t as ChartType) : 'line';
  }

  private boolAttr(name: string, dflt: boolean): boolean {
    const v = this.getAttribute(name);
    if (v === null) return dflt;
    return v === 'true' || v === '1' || v === 'yes';
  }
}

function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return '';
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  if (abs >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

function isDark(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}
