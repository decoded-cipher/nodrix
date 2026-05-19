// <iot-toggle> — button that dispatches an iot-command event.
//
// Attributes:
//   - data-title, data-device, data-command, data-on-value, data-off-value
// Property:
//   - current: last known value (so the toggle reflects state)
// Event:
//   - iot-command { device, name, value }  bubbles + composed

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
      gap: clamp(6px, 3cqmin, 12px);
      height: 100%;
      width: 100%;
      box-sizing: border-box;
      padding: clamp(10px, 5cqmin, 18px);
      background: var(--color-bg-elevated, white);
      border: 1px solid var(--color-border, #e5e5e5);
      border-radius: 10px;
      transition: border-color 120ms ease;
      overflow: hidden;
    }
    .ts {
      font-size: clamp(9px, min(6cqh, 3cqw), 12px);
      color: var(--color-text-faint, #a3a3a3);
      font-variant-numeric: tabular-nums;
      line-height: 1;
      white-space: nowrap;
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
    .switch-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 0;
      min-width: 0;
    }
    .switch {
      display: inline-flex;
      align-items: center;
      gap: clamp(6px, 2cqmin, 12px);
      padding: clamp(8px, min(10cqh, 5cqw), 24px) clamp(14px, min(16cqh, 8cqw), 40px);
      border: 1.5px solid var(--color-border, #d4d4d4);
      border-radius: 9999px;
      background: var(--color-bg-elevated, white);
      color: var(--color-text, #171717);
      cursor: pointer;
      font-family: inherit;
      font-size: clamp(14px, min(18cqh, 9cqw), 28px);
      font-weight: 700;
      letter-spacing: 0.04em;
      transition: background 140ms ease, color 140ms ease, border-color 140ms ease, transform 80ms ease, box-shadow 140ms ease;
      max-width: 100%;
    }
    .switch:hover { border-color: var(--color-border-strong, #a3a3a3); }
    .switch:active { transform: scale(0.96); }
    .switch.on {
      background: #ea580c;
      color: white;
      border-color: #ea580c;
      box-shadow: 0 0 0 6px rgba(234, 88, 12, 0.18);
    }
    .switch.on:hover { background: #c2410c; border-color: #c2410c; }
    .dot {
      width: 0.6em;
      height: 0.6em;
      border-radius: 9999px;
      background: var(--color-text-faint, #a3a3a3);
      transition: background 140ms ease;
      flex-shrink: 0;
    }
    .switch.on .dot { background: white; }
    .label {
      text-transform: uppercase;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  </style>
  <div class="card">
    <div class="title"></div>
    <div class="switch-wrap">
      <button class="switch" type="button"><span class="dot"></span><span class="label">—</span></button>
    </div>
    <div class="ts"></div>
  </div>
`;

export class IotToggleElement extends HTMLElement {
  #current: unknown = null;
  #ts: number | null = null;

  static get observedAttributes() { return ['data-title', 'data-on-value', 'data-off-value']; }

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = TEMPLATE;
    shadow.querySelector('.switch')!.addEventListener('click', () => this.toggle());
  }

  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }

  set current(v: unknown) { this.#current = v; this.#ts = Math.floor(Date.now() / 1000); this.render(); }
  get current(): unknown { return this.#current; }
  set value(v: unknown) { this.current = v; }
  set ts(t: number) { this.#ts = t; this.render(); }

  private onValue(): string { return this.getAttribute('data-on-value') ?? 'on'; }
  private offValue(): string { return this.getAttribute('data-off-value') ?? 'off'; }

  private isOn(): boolean {
    return String(this.#current) === this.onValue();
  }

  private toggle() {
    const next = this.isOn() ? this.offValue() : this.onValue();
    this.dispatchEvent(new CustomEvent('iot-command', {
      bubbles: true,
      composed: true,
      detail: {
        device: this.getAttribute('data-device') ?? '',
        name: this.getAttribute('data-command') ?? '',
        value: next,
      },
    }));
    // Optimistic local update; the next state arrives via WS.
    this.#current = next;
    this.#ts = Math.floor(Date.now() / 1000);
    this.render();
  }

  private render() {
    const shadow = this.shadowRoot!;
    shadow.querySelector('.title')!.textContent = this.getAttribute('data-title') ?? '';
    const sw = shadow.querySelector('.switch')!;
    const on = this.isOn();
    sw.classList.toggle('on', on);
    shadow.querySelector('.label')!.textContent = on ? this.onValue() : this.offValue();
    shadow.querySelector('.ts')!.textContent = this.#ts ? new Date(this.#ts * 1000).toLocaleTimeString() : '';
  }
}
