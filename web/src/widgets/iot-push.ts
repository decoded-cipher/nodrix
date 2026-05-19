// <iot-push> — momentary push button. Dispatches an iot-command on each
// press; no toggle state. Useful for triggering scenes, restarts, scripts,
// or any one-shot device command.
//
// Attributes:
//   - data-title, data-device, data-command
//   - data-value     payload sent with the command (empty string by default)
//   - data-label     button face label (falls back to command name, then "Press")
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
    .button-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 0;
      min-width: 0;
    }
    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: clamp(8px, 3cqmin, 14px);
      padding: clamp(8px, min(10cqh, 5cqw), 24px) clamp(24px, min(20cqh, 12cqw), 64px);
      min-width: min(75cqw, 320px);
      border: none;
      border-radius: 9999px;
      background: #ea580c;
      color: white;
      cursor: pointer;
      font-family: inherit;
      font-size: clamp(14px, min(18cqh, 9cqw), 28px);
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      box-shadow: 0 4px 14px -4px rgba(234, 88, 12, 0.45), inset 0 -2px 0 rgba(0, 0, 0, 0.12);
      transition: transform 80ms ease, background 140ms ease, box-shadow 140ms ease;
      max-width: 100%;
    }
    .button:hover { background: #f97316; }
    .button:active,
    .button.pressing {
      transform: translateY(1px) scale(0.98);
      background: #c2410c;
      box-shadow: 0 1px 4px -1px rgba(234, 88, 12, 0.45), inset 0 2px 0 rgba(0, 0, 0, 0.15);
    }
    .button.flashed {
      box-shadow: 0 0 0 6px rgba(234, 88, 12, 0.22), 0 4px 14px -4px rgba(234, 88, 12, 0.45), inset 0 -2px 0 rgba(0, 0, 0, 0.12);
    }
    .icon {
      width: 0.9em;
      height: 0.9em;
      flex-shrink: 0;
    }
    .label {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ts {
      font-size: clamp(9px, min(6cqh, 3cqw), 12px);
      color: var(--color-text-faint, #a3a3a3);
      font-variant-numeric: tabular-nums;
      line-height: 1;
      white-space: nowrap;
    }
  </style>
  <div class="card">
    <div class="title"></div>
    <div class="button-wrap">
      <button class="button" type="button">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 12h14" />
          <path d="m13 6 6 6-6 6" />
        </svg>
        <span class="label">Press</span>
      </button>
    </div>
    <div class="ts"></div>
  </div>
`;

export class IotPushElement extends HTMLElement {
  #ts: number | null = null;
  #flashTimer: number | null = null;

  static get observedAttributes() {
    return ['data-title', 'data-label', 'data-command'];
  }

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = TEMPLATE;
    shadow.querySelector('.button')!.addEventListener('click', () => this.press());
  }

  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }
  disconnectedCallback() {
    if (this.#flashTimer !== null) {
      window.clearTimeout(this.#flashTimer);
      this.#flashTimer = null;
    }
  }

  // The page wires `.ts = u.ts` for live confirmation if the device echoes
  // back the command via WS. The widget also stamps on local press so the
  // user gets immediate feedback either way.
  set ts(t: number) { this.#ts = t; this.render(); }

  private press() {
    this.dispatchEvent(new CustomEvent('iot-command', {
      bubbles: true,
      composed: true,
      detail: {
        device: this.getAttribute('data-device') ?? '',
        name: this.getAttribute('data-command') ?? '',
        value: this.getAttribute('data-value') ?? '',
      },
    }));
    this.#ts = Math.floor(Date.now() / 1000);
    this.flash();
    this.render();
  }

  private flash() {
    const btn = this.shadowRoot!.querySelector('.button')!;
    btn.classList.add('flashed');
    if (this.#flashTimer !== null) window.clearTimeout(this.#flashTimer);
    this.#flashTimer = window.setTimeout(() => {
      btn.classList.remove('flashed');
      this.#flashTimer = null;
    }, 220);
  }

  private render() {
    const shadow = this.shadowRoot!;
    shadow.querySelector('.title')!.textContent = this.getAttribute('data-title') ?? '';
    const label = this.getAttribute('data-label') ?? this.getAttribute('data-command') ?? 'Press';
    shadow.querySelector('.label')!.textContent = label;
    shadow.querySelector('.ts')!.textContent = this.#ts ? new Date(this.#ts * 1000).toLocaleTimeString() : '';
  }
}
