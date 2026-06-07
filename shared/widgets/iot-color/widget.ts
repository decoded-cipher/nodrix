// <iot-color> — "Aura Wheel" colour picker for writing a colour to a variable.
// Drag the HSV wheel (hue = angle, saturation = distance from centre); set
// brightness on the track below. The handle glows in the live colour and the
// whole card casts a soft ambient glow, so it reads as a light. Like the
// slider, it dispatches `iot-command` on release (pointerup / change / preset /
// hex commit), not on every frame, so the wire — and the bulb — isn't flooded.
//
// Attributes:
//   - data-title, data-variable
//   - data-format: "hex" | "hsv" | "rgb"  (output shape; default hex)
//   - data-brightness, data-hex-input, data-presets: "true" | "false"
// Property:
//   - value: last known colour (hex string, {h,s,v} or {r,g,b}); also `current`
// Event:
//   - iot-command { variable, value }  bubbles + composed

type Rgb = { r: number; g: number; b: number };
type Hsv = { h: number; s: number; v: number };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function hsvToRgb(h: number, s: number, v: number): Rgb {
  const c = v * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = v - c;
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

function rgbToHsv(r: number, g: number, b: number): Hsv {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = h * 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

const hex2 = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
const rgbToHex = ({ r, g, b }: Rgb) => `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase();

function hexToRgb(input: string): Rgb | null {
  let s = input.trim().replace(/^#/, '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) };
}

// Accepts a hex string, {h,s,v} (s/v in 0–100 or 0–1) or {r,g,b} (0–255).
function parseColor(v: unknown): Hsv | null {
  if (typeof v === 'string') {
    const rgb = hexToRgb(v);
    return rgb ? rgbToHsv(rgb.r, rgb.g, rgb.b) : null;
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const num = (k: string) => (typeof o[k] === 'number' ? (o[k] as number) : NaN);
    if (Number.isFinite(num('h')) && Number.isFinite(num('s')) && Number.isFinite(num('v'))) {
      const s = num('s'), vv = num('v');
      return { h: ((num('h') % 360) + 360) % 360, s: clamp(s > 1 ? s / 100 : s, 0, 1), v: clamp(vv > 1 ? vv / 100 : vv, 0, 1) };
    }
    if (Number.isFinite(num('r')) && Number.isFinite(num('g')) && Number.isFinite(num('b'))) {
      return rgbToHsv(clamp(num('r'), 0, 255), clamp(num('g'), 0, 255), clamp(num('b'), 0, 255));
    }
  }
  return null;
}

// Smart-light friendly quick picks.
const PRESETS: ReadonlyArray<{ label: string; hex: string }> = [
  { label: 'Warm white', hex: '#FFC98A' },
  { label: 'Cool white', hex: '#F4F8FF' },
  { label: 'Red', hex: '#FF2D2D' },
  { label: 'Amber', hex: '#FF8A1F' },
  { label: 'Green', hex: '#2DD46A' },
  { label: 'Blue', hex: '#2D6BFF' },
  { label: 'Purple', hex: '#B23BFF' },
];

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
      grid-template-rows: auto minmax(0, 1fr) auto auto auto;
      gap: clamp(5px, 2cqh, 11px);
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
      /* font-size: clamp(10px, 5cqmin, 13px); */
      font-size: 11px;
      color: var(--color-text-muted, #525252);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .stage {
      display: grid;
      place-items: center;
      container-type: size;
      min-height: 0;
      min-width: 0;
    }
    .wheel {
      position: relative;
      /* Largest square that fits BOTH the stage's width and height, so the wheel
         never overflows the card at any cell ratio. Sized against .stage, which
         is a size container. */
      width: min(100cqw, 100cqh);
      height: min(100cqw, 100cqh);
      border-radius: 50%;
      cursor: crosshair;
      touch-action: none;
      background:
        radial-gradient(circle closest-side, #fff 0%, rgba(255, 255, 255, 0) 70%),
        conic-gradient(from 90deg,
          hsl(0, 100%, 50%), hsl(60, 100%, 50%), hsl(120, 100%, 50%),
          hsl(180, 100%, 50%), hsl(240, 100%, 50%), hsl(300, 100%, 50%), hsl(360, 100%, 50%));
      box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
    }
    .handle {
      position: absolute;
      top: 50%;
      left: 50%;
      width: clamp(16px, 10cqmin, 26px);
      height: clamp(16px, 10cqmin, 26px);
      border-radius: 50%;
      background: #fff;
      border: 2.5px solid #fff;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25), 0 2px 6px -1px rgba(0, 0, 0, 0.3);
      transform: translate(-50%, -50%);
      pointer-events: none;
      transition: box-shadow 140ms ease;
    }
    .bright {
      display: flex;
      align-items: center;
      gap: clamp(5px, 2.5cqmin, 9px);
      min-width: 0;
    }
    .bicon {
      flex: none;
      width: clamp(13px, 5.5cqh, 18px);
      height: clamp(13px, 5.5cqh, 18px);
      color: var(--color-text-subtle, #737373);
      display: inline-flex;
    }
    .bicon svg { width: 100%; height: 100%; }
    .track-wrap {
      position: relative;
      flex: 1;
      height: clamp(12px, 5cqh, 18px);
      display: flex;
      align-items: center;
    }
    .track {
      position: relative;
      width: 100%;
      height: clamp(5px, 2.4cqh, 9px);
      border-radius: 9999px;
      background: linear-gradient(to right, #000, #fff);
      box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.1);
    }
    .brange {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      margin: 0;
      opacity: 0;
      cursor: grab;
      -webkit-appearance: none;
      appearance: none;
      background: transparent;
      touch-action: none;
    }
    .brange:active { cursor: grabbing; }
    .bthumb {
      position: absolute;
      top: 50%;
      left: 0;
      width: clamp(11px, 4.5cqh, 16px);
      height: clamp(11px, 4.5cqh, 16px);
      border-radius: 9999px;
      background: #fff;
      border: 1.5px solid rgba(0, 0, 0, 0.18);
      box-shadow: 0 1px 3px -1px rgba(0, 0, 0, 0.28);
      transform: translate(-50%, -50%);
      pointer-events: none;
    }
    .presets {
      display: flex;
      gap: clamp(4px, 2cqmin, 7px);
      min-width: 0;
    }
    .swatch {
      flex: 1;
      min-width: 0;
      height: clamp(14px, 6cqh, 24px);
      padding: 0;
      border: 1px solid rgba(0, 0, 0, 0.12);
      border-radius: 6px;
      cursor: pointer;
      transition: transform 100ms ease, box-shadow 120ms ease;
    }
    .swatch:hover { transform: translateY(-1px); box-shadow: 0 2px 6px -1px rgba(0, 0, 0, 0.25); }
    .swatch:active { transform: translateY(0); }
    .foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5em;
      min-width: 0;
    }
    .hex {
      width: clamp(70px, 38cqmin, 104px);
      box-sizing: border-box;
      font-family: ui-monospace, monospace;
      font-size: clamp(10px, 4cqh, 13px);
      letter-spacing: 0.02em;
      text-transform: uppercase;
      padding: clamp(3px, 1.6cqh, 6px) clamp(5px, 2cqmin, 8px);
      color: var(--color-text, #171717);
      background: var(--color-bg, #fff);
      border: 1px solid var(--color-border, #e5e5e5);
      border-radius: 6px;
      outline: none;
    }
    .hex:focus { border-color: var(--accent-600, #ea580c); }
    .ts {
      font-size: 9px;
      color: var(--color-text-faint, #a3a3a3);
      white-space: nowrap;
      margin-left: auto;
    }
    :host([data-brightness="false"]) .bright { display: none; }
    :host([data-presets="false"]) .presets { display: none; }
    :host([data-hex-input="false"]) .hex { display: none; }
  </style>
  <div class="card">
    <div class="head">
      <div class="title"></div>
    </div>
    <div class="stage">
      <div class="wheel"><div class="handle"></div></div>
    </div>
    <div class="bright">
      <span class="bicon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></span>
      <div class="track-wrap">
        <div class="track"></div>
        <input class="brange" type="range" min="0" max="100" step="1" value="100" aria-label="Brightness" />
        <div class="bthumb"></div>
      </div>
    </div>
    <div class="presets"></div>
    <div class="foot">
      <input class="hex" type="text" spellcheck="false" autocomplete="off" aria-label="Hex colour" />
      <div class="ts"></div>
    </div>
  </div>
`;

export class IotColorElement extends HTMLElement {
  #h = 0;
  #s = 0;
  #v = 1;
  #ts: number | null = null;
  #dragging = false;
  #hexFocused = false;

  static get observedAttributes() { return ['data-title']; }

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = TEMPLATE;

    // Preset swatches.
    const presets = shadow.querySelector('.presets')!;
    for (const p of PRESETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.background = p.hex;
      b.title = p.label;
      b.setAttribute('aria-label', p.label);
      b.addEventListener('click', () => {
        const hsv = parseColor(p.hex);
        if (!hsv) return;
        this.#h = hsv.h; this.#s = hsv.s; this.#v = hsv.v;
        this.commit();
      });
      presets.appendChild(b);
    }

    // Wheel: drag for hue + saturation, commit on release.
    const wheel = shadow.querySelector('.wheel') as HTMLElement;
    const pick = (e: PointerEvent) => {
      const rect = wheel.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const radius = Math.min(rect.width, rect.height) / 2;
      this.#s = radius > 0 ? clamp(Math.hypot(dx, dy) / radius, 0, 1) : 0;
      let h = Math.atan2(dy, dx) * 180 / Math.PI;
      if (h < 0) h += 360;
      this.#h = h;
      this.render();
    };
    wheel.addEventListener('pointerdown', (e) => {
      this.#dragging = true;
      wheel.setPointerCapture(e.pointerId);
      pick(e);
    });
    wheel.addEventListener('pointermove', (e) => { if (this.#dragging) pick(e); });
    const endWheel = (e: PointerEvent) => {
      if (!this.#dragging) return;
      this.#dragging = false;
      try { wheel.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      this.commit();
    };
    wheel.addEventListener('pointerup', endWheel);
    wheel.addEventListener('pointercancel', endWheel);

    // Brightness: live preview on input, commit on release.
    const brange = shadow.querySelector('.brange') as HTMLInputElement;
    brange.addEventListener('input', () => { this.#v = Number(brange.value) / 100; this.render(); });
    brange.addEventListener('change', () => { this.#v = Number(brange.value) / 100; this.commit(); });

    // Hex field: parse on Enter / blur.
    const hex = shadow.querySelector('.hex') as HTMLInputElement;
    hex.addEventListener('focus', () => { this.#hexFocused = true; });
    hex.addEventListener('blur', () => {
      this.#hexFocused = false;
      const hsv = parseColor(hex.value);
      if (hsv) { this.#h = hsv.h; this.#s = hsv.s; this.#v = hsv.v; this.commit(); }
      else this.render();
    });
    hex.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') hex.blur(); });
  }

  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }

  set value(v: unknown) {
    const hsv = parseColor(v);
    if (!hsv) return;
    this.#h = hsv.h; this.#s = hsv.s; this.#v = hsv.v;
    this.#ts = Math.floor(Date.now() / 1000);
    if (!this.#dragging) this.render();
  }
  get value(): string { return rgbToHex(hsvToRgb(this.#h, this.#s, this.#v)); }
  set current(v: unknown) { this.value = v; }
  set ts(t: number) { this.#ts = t; if (!this.#dragging) this.render(); }

  private format(): string { return this.getAttribute('data-format') ?? 'hex'; }

  private commit() {
    const rgb = hsvToRgb(this.#h, this.#s, this.#v);
    let value: unknown;
    switch (this.format()) {
      case 'hsv':
        value = { h: Math.round(this.#h), s: Math.round(this.#s * 100), v: Math.round(this.#v * 100) };
        break;
      case 'rgb':
        value = rgb;
        break;
      default:
        value = rgbToHex(rgb);
    }
    this.dispatchEvent(new CustomEvent('iot-command', {
      bubbles: true,
      composed: true,
      detail: { variable: this.getAttribute('data-variable') ?? '', value },
    }));
    this.#ts = Math.floor(Date.now() / 1000);
    this.render();
  }

  private render() {
    const shadow = this.shadowRoot!;
    const live = hsvToRgb(this.#h, this.#s, this.#v);
    const liveHex = rgbToHex(live);

    shadow.querySelector('.title')!.textContent = this.getAttribute('data-title') ?? '';

    // Handle: position by hue (angle) + saturation (radius); fill = live colour.
    const handle = shadow.querySelector('.handle') as HTMLElement;
    const rad = this.#h * Math.PI / 180;
    handle.style.left = `${50 + Math.cos(rad) * this.#s * 50}%`;
    handle.style.top = `${50 + Math.sin(rad) * this.#s * 50}%`;
    handle.style.background = liveHex;

    // Brightness track: black → full colour at this hue/saturation; thumb at v.
    const hue = hsvToRgb(this.#h, this.#s, 1);
    const track = shadow.querySelector('.track') as HTMLElement;
    track.style.background = `linear-gradient(to right, #000, ${rgbToHex(hue)})`;
    const bthumb = shadow.querySelector('.bthumb') as HTMLElement;
    bthumb.style.left = `${this.#v * 100}%`;
    const brange = shadow.querySelector('.brange') as HTMLInputElement;
    if (document.activeElement !== this) brange.value = String(Math.round(this.#v * 100));

    // Hex field reflects the live value unless the user is editing it.
    const hex = shadow.querySelector('.hex') as HTMLInputElement;
    if (!this.#hexFocused) hex.value = liveHex;

    shadow.querySelector('.ts')!.textContent = this.#ts ? new Date(this.#ts * 1000).toLocaleTimeString() : '';
  }
}
