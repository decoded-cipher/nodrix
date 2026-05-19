// <iot-value> — shows the latest value of a single metric.
//
// Contract (plan §9): data in via property/attribute, no transport knowledge.
// The page calls `el.value = ...` from WS updates.

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
      justify-content: space-between;
      height: 100%;
      width: 100%;
      box-sizing: border-box;
      padding: clamp(10px, 7cqmin, 20px);
      background: var(--color-bg-elevated, white);
      border: 1px solid var(--color-border, #e5e5e5);
      border-radius: 10px;
      transition: border-color 120ms ease, box-shadow 120ms ease;
      overflow: hidden;
    }
    .card:hover { border-color: var(--color-border-strong, #d4d4d4); }
    .title {
      font-size: clamp(10px, 5cqmin, 13px);
      color: var(--color-text-muted, #525252);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 600;
      line-height: 1.2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .reading {
      display: flex;
      align-items: baseline;
      gap: 0.25em;
      min-width: 0;
      line-height: 1;
    }
    .value {
      font-size: clamp(20px, 28cqmin, 64px);
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
      font-size: clamp(10px, 8cqmin, 18px);
      color: var(--color-text-subtle, #737373);
      font-weight: 500;
    }
    .ts {
      font-size: clamp(9px, 4cqmin, 12px);
      color: var(--color-text-faint, #a3a3a3);
      font-variant-numeric: tabular-nums;
      line-height: 1;
    }
  </style>
  <div class="card">
    <div class="title"></div>
    <div class="reading">
      <span class="value">—</span><span class="unit"></span>
    </div>
    <div class="ts"></div>
  </div>
`;

export class IotValueElement extends HTMLElement {
  #value: unknown = null;
  #ts: number | null = null;

  static get observedAttributes() { return ['data-title', 'data-unit']; }

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = TEMPLATE;
  }

  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }

  set value(v: unknown) { this.#value = v; this.#ts = Math.floor(Date.now() / 1000); this.render(); }
  get value(): unknown { return this.#value; }

  set ts(t: number) { this.#ts = t; this.render(); }

  private render() {
    const shadow = this.shadowRoot!;
    const title = shadow.querySelector('.title')!;
    const value = shadow.querySelector('.value')!;
    const unit = shadow.querySelector('.unit')!;
    const ts = shadow.querySelector('.ts')!;

    title.textContent = this.getAttribute('data-title') ?? '';
    unit.textContent = this.getAttribute('data-unit') ?? '';
    value.textContent = this.#value === null || this.#value === undefined ? '—' : String(this.#value);
    ts.textContent = this.#ts ? new Date(this.#ts * 1000).toLocaleTimeString() : '';
  }
}
