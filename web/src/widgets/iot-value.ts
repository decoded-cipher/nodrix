// <iot-value> — shows the latest value of a single metric.
//
// Contract (plan §9): data in via property/attribute, no transport knowledge.
// The page calls `el.value = ...` from WS updates.

const TEMPLATE = `
  <style>
    :host {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      height: 100%;
      padding: 1rem;
      box-sizing: border-box;
      background: var(--color-bg-elevated, white);
      border: 1px solid var(--color-border, #e5e5e5);
      border-radius: 8px;
      font-family: system-ui, sans-serif;
    }
    .title { font-size: 0.75rem; color: var(--color-text-muted, #525252); text-transform: uppercase; letter-spacing: 0.05em; }
    .value { font-size: 2.5rem; font-weight: 600; line-height: 1; color: var(--color-text, #171717); }
    .unit  { font-size: 0.875rem; color: var(--color-text-subtle, #737373); margin-left: 0.25rem; }
    .ts    { font-size: 0.6875rem; color: var(--color-text-faint, #a3a3a3); font-variant-numeric: tabular-nums; }
  </style>
  <div class="title"></div>
  <div>
    <span class="value">—</span><span class="unit"></span>
  </div>
  <div class="ts"></div>
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
