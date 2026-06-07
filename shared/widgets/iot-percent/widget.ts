// <iot-percent> — circular percentage ring. Maps value through min/max to 0–100%;
// thresholds ({ value, color }, value as %) recolour the ring (highest band ≤ value wins).

type Threshold = { value: number; color: string };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// r=42 ring in a 100×100 viewBox; C is its circumference.
const C = 2 * Math.PI * 42;

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
      display: grid;
      grid-template-rows: auto 1fr auto;
      height: 100%;
      width: 100%;
      box-sizing: border-box;
      padding: clamp(10px, 7cqmin, 20px);
      background: var(--color-bg-elevated, white);
      border: 1px solid var(--color-border, #e5e5e5);
      border-radius: 10px;
      transition: border-color 120ms ease;
      overflow: hidden;
    }
    .card:hover { border-color: var(--color-border-strong, #d4d4d4); }
    .title {
      /* font-size: clamp(10px, 5cqmin, 13px); */
      font-size: 11px;
      color: var(--color-text-muted, #525252);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ring {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 0;
      min-width: 0;
    }
    svg {
      width: 100%;
      height: 100%;
      max-width: 100%;
      max-height: 100%;
      display: block;
    }
    svg .track {
      stroke: var(--color-border, #e5e5e5);
      opacity: 0.55;
    }
    svg .arc {
      stroke: var(--accent-600, #ea580c);
      transition: stroke-dasharray 320ms ease, stroke 200ms ease;
    }
    .center {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
      pointer-events: none;
      width: 64%;
    }
    .value {
      font-size: clamp(15px, 17cqmin, 40px);
      font-weight: 700;
      line-height: 1;
      letter-spacing: -0.02em;
      color: var(--color-text, #171717);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .unit {
      margin-top: 0.25em;
      font-size: clamp(9px, 7cqmin, 15px);
      font-weight: 600;
      color: var(--color-text-subtle, #737373);
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
    <div class="ring">
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
        <circle class="track" cx="50" cy="50" r="42" stroke-width="9" fill="none" />
        <circle class="arc" cx="50" cy="50" r="42" stroke-width="9" fill="none"
          stroke-linecap="round" transform="rotate(-90 50 50)" stroke-dasharray="0 ${C}" />
      </svg>
      <div class="center"><div class="value">—</div><div class="unit"></div></div>
    </div>
    <div class="ts"></div>
  </div>
`;

export class IotPercentElement extends HTMLElement {
  #value: number | null = null;
  #thresholds: Threshold[] = [];
  #ts: number | null = null;

  static get observedAttributes() {
    return ['data-title', 'data-min', 'data-max', 'data-unit'];
  }

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = TEMPLATE;
  }

  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }

  set value(v: unknown) {
    const n = typeof v === 'number' ? v : Number(v);
    this.#value = Number.isFinite(n) ? n : null;
    this.#ts = Math.floor(Date.now() / 1000);
    this.render();
  }
  get value(): number | null { return this.#value; }

  set thresholds(v: unknown) {
    this.#thresholds = Array.isArray(v)
      ? v
          .filter((t) => t && typeof (t as Threshold).value === 'number' && typeof (t as Threshold).color === 'string')
          .map((t) => ({ value: (t as Threshold).value, color: (t as Threshold).color }))
      : [];
    this.render();
  }

  set ts(t: number) { this.#ts = t; this.render(); }

  // Colour for the band with the greatest value <= pct; else accent.
  private colorFor(pct: number): string {
    const sorted = [...this.#thresholds].sort((a, b) => a.value - b.value);
    let color: string | null = null;
    for (const t of sorted) {
      if (pct >= t.value) color = t.color;
      else break;
    }
    return color ?? 'var(--accent-600, #ea580c)';
  }

  private render() {
    const shadow = this.shadowRoot!;
    const min = Number(this.getAttribute('data-min') ?? '0');
    const max = Number(this.getAttribute('data-max') ?? '100');
    const unit = this.getAttribute('data-unit') ?? '%';
    const value = this.#value;

    shadow.querySelector('.title')!.textContent = this.getAttribute('data-title') ?? '';
    shadow.querySelector('.ts')!.textContent = this.#ts ? new Date(this.#ts * 1000).toLocaleTimeString() : '';

    const arc = shadow.querySelector('.arc') as SVGCircleElement;
    const valueEl = shadow.querySelector('.value')!;
    const unitEl = shadow.querySelector('.unit')!;

    if (value === null) {
      valueEl.textContent = '—';
      unitEl.textContent = '';
      arc.setAttribute('stroke-dasharray', `0 ${C}`);
      arc.style.visibility = 'hidden';
      return;
    }

    const range = max - min;
    const pct = range !== 0 ? clamp01((value - min) / range) : 0;
    const displayPct = pct * 100;

    valueEl.textContent = String(Math.round(displayPct));
    unitEl.textContent = unit;
    arc.setAttribute('stroke-dasharray', `${pct * C} ${C}`);
    arc.style.stroke = this.colorFor(displayPct);
    // Hide the arc at 0% so the round line-cap doesn't leave a stray dot.
    arc.style.visibility = pct > 0 ? 'visible' : 'hidden';
  }
}
