// <iot-slider> — horizontal slider for sending a numeric command to a
// device. Dispatches `iot-command` on commit (mouseup / keyup), not on
// every input frame, so the wire isn't flooded while dragging. Reflects
// the latest reported state via `.value`.
//
// Attributes:
//   - data-title, data-device, data-command, data-unit
//   - data-min, data-max, data-step
// Property:
//   - value: last known numeric value (also accepted via `current` for
//     symmetry with iot-toggle)
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
    .head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.5em;
      min-width: 0;
    }
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
    .reading {
      display: inline-flex;
      align-items: baseline;
      gap: 0.2em;
      font-variant-numeric: tabular-nums;
      color: var(--color-text, #171717);
      line-height: 1;
      white-space: nowrap;
    }
    .value {
      font-size: clamp(16px, min(20cqh, 10cqw), 36px);
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .unit {
      font-size: clamp(10px, min(8cqh, 4cqw), 14px);
      color: var(--color-text-subtle, #737373);
      font-weight: 500;
    }
    .control {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 0;
      min-width: 0;
      padding: clamp(4px, 2cqmin, 8px);
    }
    .track-wrap {
      position: relative;
      width: 100%;
      height: clamp(18px, min(14cqh, 7cqw), 28px);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .track {
      position: relative;
      width: 100%;
      height: clamp(8px, min(6cqh, 3cqw), 14px);
      border-radius: 9999px;
      background: var(--color-border, #e5e5e5);
      overflow: hidden;
    }
    .fill {
      position: absolute;
      inset: 0 auto 0 0;
      background: #ea580c;
      transition: width 80ms linear, height 80ms linear;
    }
    .range {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      opacity: 0;
      cursor: grab;
      -webkit-appearance: none;
      appearance: none;
      background: transparent;
    }
    .range:active { cursor: grabbing; }
    .thumb {
      position: absolute;
      top: 50%;
      left: 0;
      width: clamp(18px, min(14cqh, 7cqw), 28px);
      height: clamp(18px, min(14cqh, 7cqw), 28px);
      border-radius: 9999px;
      background: white;
      border: 2px solid #ea580c;
      box-shadow: 0 2px 6px -1px rgba(0, 0, 0, 0.15), 0 0 0 0 rgba(234, 88, 12, 0);
      transform: translate(-50%, -50%);
      pointer-events: none;
      transition: box-shadow 140ms ease, transform 80ms ease;
    }
    .range:hover ~ .thumb { box-shadow: 0 2px 6px -1px rgba(0, 0, 0, 0.18), 0 0 0 4px rgba(234, 88, 12, 0.16); }
    .range:active ~ .thumb { transform: translate(-50%, -50%) scale(1.08); box-shadow: 0 2px 8px -1px rgba(0, 0, 0, 0.2), 0 0 0 6px rgba(234, 88, 12, 0.22); }
    .range:focus-visible ~ .thumb { box-shadow: 0 2px 6px -1px rgba(0, 0, 0, 0.18), 0 0 0 4px rgba(234, 88, 12, 0.3); }

    /* Vertical orientation. Tracks the modern CSS standard for vertical
       range inputs (Chromium 115+, Safari 17+, Firefox 121+). */
    :host([data-orientation="vertical"]) .track-wrap {
      width: clamp(18px, min(14cqh, 7cqw), 28px);
      height: 100%;
      flex-direction: column;
    }
    :host([data-orientation="vertical"]) .track {
      width: clamp(8px, min(3cqw, 6cqh), 14px);
      height: 100%;
    }
    :host([data-orientation="vertical"]) .fill {
      inset: auto 0 0 0;
      width: 100%;
    }
    :host([data-orientation="vertical"]) .range {
      writing-mode: vertical-lr;
      direction: rtl;
    }
    .footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5em;
      font-variant-numeric: tabular-nums;
    }
    .bounds {
      font-size: clamp(9px, min(6cqh, 3cqw), 12px);
      color: var(--color-text-faint, #a3a3a3);
      display: flex;
      gap: 0.4em;
    }
    .ts {
      font-size: clamp(9px, min(6cqh, 3cqw), 12px);
      color: var(--color-text-faint, #a3a3a3);
      white-space: nowrap;
    }
  </style>
  <div class="card">
    <div class="head">
      <div class="title"></div>
      <div class="reading"><span class="value">—</span><span class="unit"></span></div>
    </div>
    <div class="control">
      <div class="track-wrap">
        <div class="track"><div class="fill"></div></div>
        <input class="range" type="range" min="0" max="100" step="1" value="0" />
        <div class="thumb"></div>
      </div>
    </div>
    <div class="footer">
      <div class="bounds"><span class="min"></span><span>→</span><span class="max"></span></div>
      <div class="ts"></div>
    </div>
  </div>
`;

export class IotSliderElement extends HTMLElement {
  #value: number | null = null;
  #pending: number | null = null;
  #dragging = false;
  #ts: number | null = null;

  static get observedAttributes() {
    return ['data-title', 'data-unit', 'data-min', 'data-max', 'data-step', 'data-orientation'];
  }

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = TEMPLATE;

    const range = shadow.querySelector('.range') as HTMLInputElement;
    range.addEventListener('pointerdown', () => { this.#dragging = true; });
    range.addEventListener('input', () => {
      this.#pending = Number(range.value);
      this.renderProgress();
    });
    const commit = () => {
      if (!this.#dragging && this.#pending === null) return;
      this.#dragging = false;
      const v = this.#pending ?? this.#value;
      this.#pending = null;
      if (v === null || !Number.isFinite(v)) return;
      this.#value = v;
      this.#ts = Math.floor(Date.now() / 1000);
      this.dispatchEvent(new CustomEvent('iot-command', {
        bubbles: true,
        composed: true,
        detail: {
          device: this.getAttribute('data-device') ?? '',
          name: this.getAttribute('data-command') ?? '',
          value: v,
        },
      }));
      this.render();
    };
    range.addEventListener('change', commit);
    range.addEventListener('pointerup', commit);
    range.addEventListener('pointercancel', () => { this.#dragging = false; this.#pending = null; this.render(); });
  }

  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }

  set value(v: unknown) {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return;
    this.#value = n;
    this.#ts = Math.floor(Date.now() / 1000);
    // Don't yank the thumb out from under the user mid-drag.
    if (!this.#dragging) this.render();
  }
  get value(): number | null { return this.#value; }
  set current(v: unknown) { this.value = v; }
  set ts(t: number) { this.#ts = t; if (!this.#dragging) this.render(); }

  private bounds(): { min: number; max: number; step: number } {
    const min = Number(this.getAttribute('data-min') ?? '0');
    const max = Number(this.getAttribute('data-max') ?? '100');
    const step = Number(this.getAttribute('data-step') ?? '1');
    return { min, max, step: step > 0 ? step : 1 };
  }

  private render() {
    const shadow = this.shadowRoot!;
    const { min, max, step } = this.bounds();
    const display = this.#pending ?? this.#value;

    shadow.querySelector('.title')!.textContent = this.getAttribute('data-title') ?? '';
    shadow.querySelector('.unit')!.textContent = this.getAttribute('data-unit') ?? '';
    shadow.querySelector('.min')!.textContent = String(min);
    shadow.querySelector('.max')!.textContent = String(max);
    shadow.querySelector('.value')!.textContent = display === null
      ? '—'
      : Number.isInteger(step) && Number.isInteger(display) ? String(display) : Number(display).toFixed(1);
    shadow.querySelector('.ts')!.textContent = this.#ts ? new Date(this.#ts * 1000).toLocaleTimeString() : '';

    const range = shadow.querySelector('.range') as HTMLInputElement;
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    if (display !== null && !this.#dragging) range.value = String(display);

    this.renderProgress();
  }

  private renderProgress() {
    const shadow = this.shadowRoot!;
    const { min, max } = this.bounds();
    const range = shadow.querySelector('.range') as HTMLInputElement;
    const v = Number(range.value);
    const pct = max > min ? Math.max(0, Math.min(1, (v - min) / (max - min))) : 0;
    const fill = shadow.querySelector('.fill') as HTMLElement;
    const thumb = shadow.querySelector('.thumb') as HTMLElement;
    const vertical = this.getAttribute('data-orientation') === 'vertical';
    if (vertical) {
      fill.style.width = '';
      fill.style.height = `${pct * 100}%`;
      thumb.style.left = '50%';
      thumb.style.top = `${(1 - pct) * 100}%`;
    } else {
      fill.style.height = '';
      fill.style.width = `${pct * 100}%`;
      thumb.style.top = '50%';
      thumb.style.left = `${pct * 100}%`;
    }
  }
}
