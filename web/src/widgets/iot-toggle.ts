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
      transition: border-color 120ms ease;
      overflow: hidden;
      gap: clamp(8px, 4cqmin, 16px);
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
    .switch {
      align-self: flex-start;
      display: inline-flex;
      align-items: center;
      gap: 0.5em;
      padding: clamp(6px, 3cqmin, 12px) clamp(12px, 5cqmin, 20px);
      border: 1px solid var(--color-border, #d4d4d4);
      border-radius: 9999px;
      background: var(--color-bg-elevated, white);
      color: var(--color-text, #171717);
      cursor: pointer;
      font-family: inherit;
      font-size: clamp(12px, 5cqmin, 16px);
      font-weight: 600;
      letter-spacing: 0.02em;
      transition: background 140ms ease, color 140ms ease, border-color 140ms ease, transform 80ms ease;
    }
    .switch:active { transform: scale(0.97); }
    .switch.on {
      background: #ea580c;
      color: white;
      border-color: #ea580c;
      box-shadow: 0 0 0 3px rgba(234, 88, 12, 0.18);
    }
    .dot {
      width: 0.55em;
      height: 0.55em;
      border-radius: 9999px;
      background: var(--color-text-faint, #a3a3a3);
      transition: background 140ms ease;
    }
    .switch.on .dot { background: white; }
    .label { text-transform: uppercase; }
  </style>
  <div class="card">
    <div class="title"></div>
    <button class="switch" type="button"><span class="dot"></span><span class="label">—</span></button>
  </div>
`;

export class IotToggleElement extends HTMLElement {
  #current: unknown = null;

  static get observedAttributes() { return ['data-title', 'data-on-value', 'data-off-value']; }

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = TEMPLATE;
    shadow.querySelector('.switch')!.addEventListener('click', () => this.toggle());
  }

  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }

  set current(v: unknown) { this.#current = v; this.render(); }
  get current(): unknown { return this.#current; }
  set value(v: unknown) { this.current = v; }

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
    this.render();
  }

  private render() {
    const shadow = this.shadowRoot!;
    shadow.querySelector('.title')!.textContent = this.getAttribute('data-title') ?? '';
    const sw = shadow.querySelector('.switch')!;
    const on = this.isOn();
    sw.classList.toggle('on', on);
    shadow.querySelector('.label')!.textContent = on ? this.onValue() : this.offValue();
  }
}
