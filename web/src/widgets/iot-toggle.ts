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
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      height: 100%;
      padding: 1rem;
      box-sizing: border-box;
      background: white;
      border: 1px solid #e5e5e5;
      border-radius: 8px;
      font-family: system-ui, sans-serif;
    }
    .title { font-size: 0.75rem; color: #525252; text-transform: uppercase; letter-spacing: 0.05em; }
    .switch {
      align-self: flex-start;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      border: 1px solid #d4d4d4;
      border-radius: 9999px;
      background: white;
      cursor: pointer;
      font-size: 0.875rem;
      font-weight: 500;
    }
    .switch.on { background: #ea580c; color: white; border-color: #ea580c; }
    .dot { width: 0.5rem; height: 0.5rem; border-radius: 9999px; background: #d4d4d4; }
    .switch.on .dot { background: white; }
  </style>
  <div class="title"></div>
  <button class="switch" type="button"><span class="dot"></span><span class="label">—</span></button>
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
