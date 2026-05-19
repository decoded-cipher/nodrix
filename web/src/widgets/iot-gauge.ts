// <iot-gauge> — arc gauge for a numeric metric with min/max bounds.

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
    .ts {
      font-size: 9px;
      color: var(--color-text-faint, #a3a3a3);
      font-variant-numeric: tabular-nums;
      line-height: 1;
      white-space: nowrap;
    }
    .card:hover { border-color: var(--color-border-strong, #d4d4d4); }
    .title {
      font-size: clamp(10px, 5cqmin, 13px);
      color: var(--color-text-muted, #525252);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .gauge {
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
      opacity: 0.6;
    }
    svg .arc {
      transition: stroke-dasharray 280ms ease;
    }
    .center {
      position: absolute;
      top: 58%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
      pointer-events: none;
      width: 70%;
    }
    .value {
      font-size: clamp(16px, 18cqmin, 40px);
      font-weight: 700;
      line-height: 1;
      letter-spacing: -0.02em;
      color: var(--color-text, #171717);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .bounds {
      position: absolute;
      bottom: 6%;
      left: 8%;
      right: 8%;
      display: flex;
      justify-content: space-between;
      font-size: clamp(9px, 4cqmin, 11px);
      color: var(--color-text-faint, #a3a3a3);
      font-variant-numeric: tabular-nums;
      pointer-events: none;
    }
  </style>
  <div class="card">
    <div class="title"></div>
    <div class="gauge">
      <svg viewBox="0 0 100 60" preserveAspectRatio="xMidYMid meet">
        <path class="track" d="M 10 50 A 40 40 0 0 1 90 50" stroke-width="8" fill="none" stroke-linecap="round" />
        <path class="arc" d="M 10 50 A 40 40 0 0 1 90 50" stroke="#ea580c" stroke-width="8" fill="none" stroke-linecap="round" />
      </svg>
      <div class="center"><div class="value">—</div></div>
      <div class="bounds"><span class="min"></span><span class="max"></span></div>
    </div>
    <div class="ts"></div>
  </div>
`;

export class IotGaugeElement extends HTMLElement {
  #value: number | null = null;
  #ts: number | null = null;

  static get observedAttributes() { return ['data-title', 'data-min', 'data-max']; }

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

  set ts(t: number) { this.#ts = t; this.render(); }

  private render() {
    const shadow = this.shadowRoot!;
    const min = Number(this.getAttribute('data-min') ?? '0');
    const max = Number(this.getAttribute('data-max') ?? '100');
    const value = this.#value;

    shadow.querySelector('.title')!.textContent = this.getAttribute('data-title') ?? '';
    shadow.querySelector('.min')!.textContent = String(min);
    shadow.querySelector('.max')!.textContent = String(max);
    shadow.querySelector('.value')!.textContent = value === null ? '—' : value.toFixed(1);
    shadow.querySelector('.ts')!.textContent = this.#ts ? new Date(this.#ts * 1000).toLocaleTimeString() : '';

    // Arc length: full semicircle is ~125.66 (π * 40). Compute fraction filled.
    const arc = shadow.querySelector('.arc') as SVGPathElement;
    if (value === null) {
      arc.style.strokeDasharray = '0 125.66';
      return;
    }
    const range = max - min;
    const pct = range > 0 ? Math.max(0, Math.min(1, (value - min) / range)) : 0;
    const filled = pct * 125.66;
    arc.style.strokeDasharray = `${filled} 125.66`;
  }
}
