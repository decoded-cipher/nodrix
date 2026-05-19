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
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: clamp(2px, 1cqmin, 6px);
      width: clamp(56px, min(70cqh, 36cqw), 200px);
      aspect-ratio: 1;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: #ea580c;
      color: white;
      cursor: pointer;
      font-family: inherit;
      font-size: clamp(11px, min(13cqh, 6cqw), 18px);
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      box-shadow: 0 6px 18px -4px rgba(234, 88, 12, 0.55), inset 0 -3px 0 rgba(0, 0, 0, 0.14);
      transition: transform 80ms ease, background 140ms ease, box-shadow 140ms ease;
      max-width: 100%;
      max-height: 100%;
    }
    .button:hover { background: #f97316; }
    .button:active,
    .button.pressing {
      transform: translateY(1px) scale(0.97);
      background: #c2410c;
      box-shadow: 0 2px 6px -1px rgba(234, 88, 12, 0.5), inset 0 3px 0 rgba(0, 0, 0, 0.18);
    }
    .button.flashed {
      box-shadow: 0 0 0 8px rgba(234, 88, 12, 0.22), 0 6px 18px -4px rgba(234, 88, 12, 0.55), inset 0 -3px 0 rgba(0, 0, 0, 0.14);
    }
    .label {
      max-width: 80%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .label:empty { display: none; }
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
    <div class="button-wrap">
      <button class="button" type="button">
        <span class="label"></span>
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
    // Only show in-button label if explicitly set — otherwise the icon stands alone.
    shadow.querySelector('.label')!.textContent = this.getAttribute('data-label') ?? '';
    shadow.querySelector('.ts')!.textContent = this.#ts ? new Date(this.#ts * 1000).toLocaleTimeString() : '';
  }
}
