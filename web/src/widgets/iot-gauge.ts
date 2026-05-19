// <iot-gauge> — arc gauge for a numeric metric with min/max bounds.

const TEMPLATE = `
  <style>
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      padding: 1rem;
      box-sizing: border-box;
      background: var(--color-bg-elevated, white);
      border: 1px solid var(--color-border, #e5e5e5);
      border-radius: 8px;
      font-family: system-ui, sans-serif;
    }
    .title { font-size: 0.75rem; color: var(--color-text-muted, #525252); text-transform: uppercase; letter-spacing: 0.05em; align-self: flex-start; }
    svg { width: 100%; max-width: 180px; }
    svg .track { stroke: var(--color-border, #e5e5e5); }
    .value { font-size: 1.5rem; font-weight: 600; color: var(--color-text, #171717); text-align: center; margin-top: -2rem; }
    .bounds { font-size: 0.6875rem; color: var(--color-text-faint, #a3a3a3); display: flex; justify-content: space-between; width: 100%; max-width: 180px; }
  </style>
  <div class="title"></div>
  <svg viewBox="0 0 100 60" preserveAspectRatio="xMidYMid meet">
    <path class="track" d="M 10 50 A 40 40 0 0 1 90 50" stroke-width="8" fill="none" stroke-linecap="round" />
    <path class="arc" d="M 10 50 A 40 40 0 0 1 90 50" stroke="#ea580c" stroke-width="8" fill="none" stroke-linecap="round" />
  </svg>
  <div class="value">—</div>
  <div class="bounds"><span class="min"></span><span class="max"></span></div>
`;

export class IotGaugeElement extends HTMLElement {
  #value: number | null = null;

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
    this.render();
  }
  get value(): number | null { return this.#value; }

  private render() {
    const shadow = this.shadowRoot!;
    const min = Number(this.getAttribute('data-min') ?? '0');
    const max = Number(this.getAttribute('data-max') ?? '100');
    const value = this.#value;

    shadow.querySelector('.title')!.textContent = this.getAttribute('data-title') ?? '';
    shadow.querySelector('.min')!.textContent = String(min);
    shadow.querySelector('.max')!.textContent = String(max);
    shadow.querySelector('.value')!.textContent = value === null ? '—' : value.toFixed(1);

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
