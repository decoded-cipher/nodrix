// <iot-push> — momentary push-and-hold button. Tracks the hold, not clicks:
// emits iot-command { variable, value } with value=true on press, false on
// release. Bubbles + composed.

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
      font-size: 11px;
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
      width: clamp(60px, min(78cqh, 40cqw), 220px);
      aspect-ratio: 1;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: var(--accent-600, #ea580c);
      color: white;
      cursor: pointer;
      font-family: inherit;
      font-size: clamp(11px, min(14cqh, 7cqw), 19px);
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      /* don't select text or scroll on a press-drag */
      user-select: none;
      -webkit-user-select: none;
      touch-action: none;
      box-shadow: 0 6px 18px -4px color-mix(in srgb, var(--accent-600, #ea580c) 55%, transparent), inset 0 -3px 0 rgba(0, 0, 0, 0.14);
      transition: transform 80ms ease, background 140ms ease, box-shadow 140ms ease;
      max-width: 100%;
      max-height: 100%;
    }
    .button:hover { background: var(--accent-500, #f97316); }
    .button:active,
    .button.pressing {
      transform: translateY(1px) scale(0.97);
      background: var(--accent-700, #c2410c);
      box-shadow: 0 2px 6px -1px color-mix(in srgb, var(--accent-600, #ea580c) 50%, transparent), inset 0 3px 0 rgba(0, 0, 0, 0.18);
    }
    .label {
      max-width: 84%;
      text-align: center;
      line-height: 1.12;
      overflow-wrap: anywhere;
      /* wrap onto centered lines instead of truncating; cap at 3 lines */
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 3;
      overflow: hidden;
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
  #held = false;
  #onWindowRelease = () => this.release();

  static get observedAttributes() {
    return ['data-title', 'data-label', 'data-variable'];
  }

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = TEMPLATE;
    const btn = shadow.querySelector('.button')!;
    btn.addEventListener('pointerdown', (e) => this.onPointerDown(e as PointerEvent));
    btn.addEventListener('pointerup', () => this.release());
    btn.addEventListener('pointercancel', () => this.release());
    btn.addEventListener('keydown', (e) => this.onKeyDown(e as KeyboardEvent));
    btn.addEventListener('keyup', (e) => this.onKeyUp(e as KeyboardEvent));
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }
  disconnectedCallback() {
    this.release(); // don't leave the variable stuck true if torn down mid-hold
    window.removeEventListener('blur', this.#onWindowRelease);
  }

  set ts(t: number) { this.#ts = t; this.render(); }

  private onPointerDown(e: PointerEvent) {
    // capture so the release still reaches us if the pointer slides off the button
    const btn = this.shadowRoot!.querySelector('.button') as HTMLButtonElement;
    try { btn.setPointerCapture(e.pointerId); } catch { /* unsupported */ }
    this.hold();
  }

  private onKeyDown(e: KeyboardEvent) {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (e.repeat) return; // ignore keydown auto-repeat while held
    this.hold();
  }

  private onKeyUp(e: KeyboardEvent) {
    if (e.key === ' ' || e.key === 'Enter') this.release();
  }

  private hold() {
    if (this.#held) return;
    this.#held = true;
    this.shadowRoot!.querySelector('.button')!.classList.add('pressing');
    window.addEventListener('blur', this.#onWindowRelease); // release if the tab loses focus
    this.#ts = Math.floor(Date.now() / 1000);
    this.emit(true);
    this.render();
  }

  private release() {
    if (!this.#held) return;
    this.#held = false;
    this.shadowRoot!.querySelector('.button')!.classList.remove('pressing');
    window.removeEventListener('blur', this.#onWindowRelease);
    this.emit(false);
    this.render();
  }

  private emit(value: boolean) {
    this.dispatchEvent(new CustomEvent('iot-command', {
      bubbles: true,
      composed: true,
      detail: { variable: this.getAttribute('data-variable') ?? '', value },
    }));
  }

  private render() {
    const shadow = this.shadowRoot!;
    shadow.querySelector('.title')!.textContent = this.getAttribute('data-title') ?? '';
    shadow.querySelector('.label')!.textContent = this.getAttribute('data-label') ?? '';
    shadow.querySelector('.ts')!.textContent = this.#ts ? new Date(this.#ts * 1000).toLocaleTimeString() : '';
  }
}
