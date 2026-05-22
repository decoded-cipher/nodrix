// <iot-map> — geographic markers on a Leaflet/OpenStreetMap canvas.
//
// Attributes:
//   - data-title
//   - data-basemap     'auto' | 'streets' | 'light' | 'dark' | 'satellite'  (default 'auto')
//   - data-zoom        fallback zoom shown before any marker has a position  (default 13)
//   - data-center-lat  fallback center lat                   (default 0)
//   - data-center-lng  fallback center lng                   (default 0)
//
// Properties:
//   - markers: Array<{ source, lat, lng, latVar, lngVar, label, valueVar, color }>
//       A marker's position is static (lat/lng) or live (latVar/lngVar). An
//       optional valueVar feeds the hover tooltip.
//
// Methods:
//   - updateVar(key, value, ts): the page calls this for every bound-variable
//     update (snapshot + live). We resolve key -> marker/field, move the marker
//     or refresh its tooltip, and re-fit if auto-fit is on.
//
// Contract: data in via attributes/properties, no transport knowledge. Markers
// are L.divIcon pins (a CSS dot + an expanding pulse ring) — no marker-image
// assets to break inside the bundler / shadow root, and per-marker color is
// passed through a CSS variable.

import type * as L from 'leaflet';
import leafletCss from 'leaflet/dist/leaflet.css?raw';

// Leaflet is a heavy dependency. Load it as a separate async chunk the first time
// a map initialises, so dashboards without a map widget never download it. The
// promise is shared across all map instances.
let leafletPromise: Promise<typeof import('leaflet')> | null = null;
function loadLeaflet(): Promise<typeof import('leaflet')> {
  if (!leafletPromise) {
    leafletPromise = import('leaflet').then(
      (m) => (m as { default?: typeof import('leaflet') }).default ?? m
    );
  }
  return leafletPromise;
}

type MarkerSource = 'static' | 'variable';
type MarkerConfig = {
  source?: MarkerSource;
  lat?: number;
  lng?: number;
  latVar?: string;
  lngVar?: string;
  label?: string;
  valueVar?: string;
  color?: string;
};
type Resolved = { lat: number | null; lng: number | null; value: unknown; ts: number | null };
type Binding = { idx: number; field: 'lat' | 'lng' | 'value' };
type BasemapKind = 'streets' | 'light' | 'dark' | 'satellite';

const DEFAULT_COLOR = '#ea580c';

const TILES: Record<BasemapKind, { url: string; attribution: string; maxZoom: number; subdomains: string }> = {
  streets: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19,
    subdomains: 'abc',
  },
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 20,
    subdomains: 'abcd',
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 20,
    subdomains: 'abcd',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri',
    maxZoom: 19,
    subdomains: 'abc',
  },
};

const WIDGET_CSS = `
  :host {
    display: block;
    height: 100%;
    width: 100%;
    box-sizing: border-box;
    font-family: system-ui, sans-serif;
    color: var(--color-text, #171717);
  }
  .card {
    display: grid;
    grid-template-rows: auto 1fr;
    height: 100%;
    width: 100%;
    box-sizing: border-box;
    padding: clamp(10px, 4cqmin, 16px);
    gap: 8px;
    background: var(--color-bg-elevated, white);
    border: 1px solid var(--color-border, #e5e5e5);
    border-radius: 10px;
    transition: border-color 120ms ease;
    overflow: hidden;
  }
  .card:hover { border-color: var(--color-border-strong, #d4d4d4); }
  .header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    min-width: 0;
  }
  .title {
    font-size: 13px;
    line-height: 1.2;
    color: var(--color-text-muted, #525252);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .title:empty { display: none; }
  .ts {
    font-size: 9px;
    color: var(--color-text-faint, #a3a3a3);
    font-variant-numeric: tabular-nums;
    line-height: 1;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .map-host {
    min-height: 0;
    min-width: 0;
    border-radius: 8px;
    overflow: hidden;
  }
  /* Leaflet container fills the row; pull in the dashboard theme. */
  .map-host.leaflet-container {
    height: 100%;
    width: 100%;
    background: var(--color-bg, #fafafa);
    font: inherit;
  }
  /* Hover tooltip, themed to match the dashboard. */
  .leaflet-tooltip {
    background: var(--color-bg-elevated, white);
    color: var(--color-text, #171717);
    border: 1px solid var(--color-border, #e5e5e5);
    border-radius: 4px;
    box-shadow: 0 4px 16px -6px rgba(0,0,0,0.3);
    padding: 5px 8px;
    font: inherit;
    font-size: 12px;
  }
  .leaflet-tooltip-top::before { border-top-color: var(--color-bg-elevated, white); }
  .leaflet-tooltip-bottom::before { border-bottom-color: var(--color-bg-elevated, white); }
  .leaflet-tooltip-left::before { border-left-color: var(--color-bg-elevated, white); }
  .leaflet-tooltip-right::before { border-right-color: var(--color-bg-elevated, white); }
  .popup-title { font-weight: 600; }
  .popup-val { font-variant-numeric: tabular-nums; }
  .popup-ts { color: var(--color-text-faint, #a3a3a3); font-size: 10px; margin-top: 2px; }
  /* Marker pin: a colored dot with a small expanding pulse ring behind it. */
  .map-pin-icon { background: none; border: none; }
  .map-pin { position: relative; display: block; width: 20px; height: 20px; }
  .map-pin-dot {
    position: absolute;
    inset: 5px;
    border-radius: 50%;
    background: var(--pin, #ea580c);
    border: 2px solid #fff;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.18);
    box-sizing: border-box;
  }
  .map-pin-pulse {
    position: absolute;
    inset: 5px;
    border-radius: 50%;
    background: var(--pin, #ea580c);
    opacity: 0.5;
    animation: map-pin-pulse 1.8s ease-out infinite;
  }
  @keyframes map-pin-pulse {
    0%   { transform: scale(1);   opacity: 0.5; }
    70%  { transform: scale(2.2); opacity: 0; }
    100% { transform: scale(2.2); opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .map-pin-pulse { animation: none; opacity: 0; }
  }
`;

export class IotMapElement extends HTMLElement {
  #L: typeof import('leaflet') | null = null;
  #map: L.Map | null = null;
  #host: HTMLElement | null = null;
  #tileLayer: L.TileLayer | null = null;
  #tileKind: BasemapKind | null = null;

  #markers: MarkerConfig[] = [];
  #resolved: Resolved[] = [];
  #layers: (L.Marker | undefined)[] = [];
  #bindings = new Map<string, Binding[]>();
  #values = new Map<string, { value: unknown; ts: number | null }>();

  #frame: number | null = null;
  #needInvalidate = false;
  #forceView = false;
  #viewSet = false;
  #ro: ResizeObserver | null = null;
  #themeObserver: MutationObserver | null = null;

  static get observedAttributes() {
    return ['data-title', 'data-basemap', 'data-zoom', 'data-center-lat', 'data-center-lng'];
  }

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    // Leaflet's stylesheet is normally added to document head, which can't
    // reach into shadow DOM — bundle it as raw text and copy it inside.
    // Leaflet first, our overrides second so ours win.
    shadow.innerHTML = `
      <style>${leafletCss}</style>
      <style>${WIDGET_CSS}</style>
      <div class="card">
        <div class="header">
          <div class="title"></div>
          <div class="ts"></div>
        </div>
        <div class="map-host"></div>
      </div>
    `;
    this.#host = shadow.querySelector('.map-host');
  }

  connectedCallback() {
    this.renderTitle();
    void this.initMap();
  }

  disconnectedCallback() {
    if (this.#frame !== null) {
      cancelAnimationFrame(this.#frame);
      this.#frame = null;
    }
    this.#ro?.disconnect();
    this.#ro = null;
    this.#themeObserver?.disconnect();
    this.#themeObserver = null;
    if (this.#map) {
      this.#map.remove();
      this.#map = null;
      this.#tileLayer = null;
      this.#tileKind = null;
      this.#layers = [];
    }
  }

  attributeChangedCallback(name: string) {
    if (name === 'data-title') {
      this.renderTitle();
      return;
    }
    if (name === 'data-basemap') {
      if (this.#map) this.setBasemap();
      return;
    }
    // auto-fit / zoom / center changes → re-apply the view.
    this.#forceView = true;
    this.scheduleRender();
  }

  set markers(list: MarkerConfig[]) {
    // Indices may have changed — drop existing layers and rebuild from scratch.
    for (const lyr of this.#layers) lyr?.remove();
    this.#layers = [];
    this.#markers = Array.isArray(list) ? list : [];
    this.#resolved = this.#markers.map((m) =>
      (m.source ?? 'static') === 'static'
        ? { lat: numOrNull(m.lat), lng: numOrNull(m.lng), value: null, ts: null }
        : { lat: null, lng: null, value: null, ts: null }
    );
    this.#bindings.clear();
    this.#markers.forEach((m, idx) => {
      if ((m.source ?? 'static') === 'variable') {
        if (m.latVar) this.addBinding(m.latVar, { idx, field: 'lat' });
        if (m.lngVar) this.addBinding(m.lngVar, { idx, field: 'lng' });
      }
      if (m.valueVar) this.addBinding(m.valueVar, { idx, field: 'value' });
    });
    // Replay values we already know so a config edit doesn't lose live data.
    for (const [key, v] of this.#values) this.applyValue(key, v.value, v.ts);
    this.scheduleRender();
  }
  get markers(): MarkerConfig[] {
    return this.#markers;
  }

  updateVar(key: string, value: unknown, ts: number): void {
    this.applyValue(key, value, ts);
    this.scheduleRender();
  }

  private addBinding(key: string, b: Binding) {
    let arr = this.#bindings.get(key);
    if (!arr) {
      arr = [];
      this.#bindings.set(key, arr);
    }
    arr.push(b);
  }

  private applyValue(key: string, value: unknown, ts: number | null) {
    this.#values.set(key, { value, ts });
    const binds = this.#bindings.get(key);
    if (!binds) return;
    for (const b of binds) {
      const r = this.#resolved[b.idx];
      if (!r) continue;
      if (b.field === 'lat') r.lat = numOrNull(value);
      else if (b.field === 'lng') r.lng = numOrNull(value);
      else r.value = value;
      r.ts = ts;
    }
  }

  private async initMap() {
    if (this.#map || !this.#host) return;
    try {
      this.#L = await loadLeaflet();
    } catch {
      return; // chunk failed to load
    }
    // The element may have disconnected while the chunk was loading.
    if (!this.#host || !this.isConnected || this.#map) return;
    const lib = this.#L;
    this.#map = lib.map(this.#host, {
      zoomControl: false,
      attributionControl: false,
    });
    this.#map.setView([this.numAttr('data-center-lat', 0), this.numAttr('data-center-lng', 0)], this.numAttr('data-zoom', 13));
    this.setBasemap();

    // Grid drag/resize doesn't fire a window resize — observe the host and
    // invalidate the map size when it changes.
    this.#ro = new ResizeObserver(() => this.scheduleRender(true));
    this.#ro.observe(this.#host);

    // Swap tiles live when the dashboard theme toggles (basemap 'auto').
    this.#themeObserver = new MutationObserver(() => {
      if (this.basemapAttr() === 'auto') this.setBasemap();
    });
    this.#themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    // First paint + a size invalidate in case the host sized after init.
    this.scheduleRender(true);
  }

  private setBasemap() {
    if (!this.#map || !this.#L) return;
    const kind = this.resolveBasemap();
    if (this.#tileKind === kind && this.#tileLayer) return;
    this.#tileKind = kind;
    if (this.#tileLayer) this.#tileLayer.remove();
    const def = TILES[kind];
    this.#tileLayer = this.#L.tileLayer(def.url, {
      attribution: def.attribution,
      maxZoom: def.maxZoom,
      subdomains: def.subdomains,
    }).addTo(this.#map);
  }

  private scheduleRender(invalidate = false) {
    if (invalidate) this.#needInvalidate = true;
    if (this.#frame !== null) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = null;
      if (!this.#map) return;
      if (this.#needInvalidate) {
        this.#needInvalidate = false;
        this.#map.invalidateSize();
      }
      this.render();
    });
  }

  private render() {
    if (!this.#map || !this.#L) return;
    const bounds: [number, number][] = [];

    for (let i = 0; i < this.#markers.length; i++) {
      const r = this.#resolved[i];
      const layer = this.#layers[i];
      const hasPos = r && r.lat !== null && r.lng !== null && Number.isFinite(r.lat) && Number.isFinite(r.lng);

      if (hasPos) {
        const latlng: [number, number] = [r!.lat as number, r!.lng as number];
        bounds.push(latlng);
        const color = this.#markers[i]?.color || DEFAULT_COLOR;
        if (!layer) {
          const m = this.#L.marker(latlng, { icon: this.makeIcon(color), keyboard: false }).addTo(this.#map);
          m.bindTooltip(this.tooltipHtml(i), { direction: 'top', offset: [0, -10], opacity: 1 });
          this.#layers[i] = m;
        } else {
          // Color is config-driven; a config change rebuilds all layers, so on a
          // data tick we only move the pin (keeps the pulse animation running).
          layer.setLatLng(latlng);
          layer.setTooltipContent(this.tooltipHtml(i));
        }
      } else if (layer) {
        layer.remove();
        this.#layers[i] = undefined;
      }
    }

    // Drop any layers left over from a shorter marker list.
    for (let i = this.#markers.length; i < this.#layers.length; i++) this.#layers[i]?.remove();
    this.#layers.length = this.#markers.length;

    this.updateTs();
    this.applyView(bounds);
  }

  private applyView(bounds: [number, number][]) {
    if (!this.#map || !this.#L) return;
    // Always auto-fit to the markers. The center/zoom is only a fallback shown
    // before any marker has a resolved position.
    if (bounds.length > 0) {
      this.#map.fitBounds(this.#L.latLngBounds(bounds), { padding: [24, 24], maxZoom: 16 });
      this.#viewSet = true;
    } else if (this.#forceView || !this.#viewSet) {
      this.#map.setView(
        [this.numAttr('data-center-lat', 0), this.numAttr('data-center-lng', 0)],
        this.numAttr('data-zoom', 13)
      );
      this.#viewSet = true;
    }
    this.#forceView = false;
  }

  private tooltipHtml(idx: number): string {
    const m = this.#markers[idx];
    const r = this.#resolved[idx];
    const label = (m?.label && m.label.trim()) || `Marker ${idx + 1}`;
    let html = `<div class="popup-title">${esc(label)}</div>`;
    if (m?.valueVar) {
      const val = r?.value === null || r?.value === undefined ? '—' : String(r.value);
      html += `<div class="popup-val">${esc(val)}</div>`;
    }
    if (r?.ts) html += `<div class="popup-ts">${new Date(r.ts * 1000).toLocaleTimeString()}</div>`;
    return html;
  }

  // A pin = colored dot + an expanding pulse ring. Color rides in via a CSS
  // custom property so the pulse keyframes can reuse it.
  private makeIcon(color: string): L.DivIcon {
    return this.#L!.divIcon({
      className: 'map-pin-icon',
      html: `<span class="map-pin" style="--pin:${esc(color)}"><span class="map-pin-pulse"></span><span class="map-pin-dot"></span></span>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
  }

  private renderTitle() {
    const t = this.shadowRoot!.querySelector('.title');
    if (t) t.textContent = this.getAttribute('data-title') ?? '';
  }

  private updateTs() {
    const tsEl = this.shadowRoot!.querySelector('.ts');
    if (!tsEl) return;
    const stamps = this.#resolved.map((r) => r.ts).filter((t): t is number => t !== null);
    tsEl.textContent = stamps.length ? new Date(Math.max(...stamps) * 1000).toLocaleTimeString() : '';
  }

  private basemapAttr(): string {
    return (this.getAttribute('data-basemap') ?? 'auto').toLowerCase();
  }

  private resolveBasemap(): BasemapKind {
    const b = this.basemapAttr();
    if (b === 'streets' || b === 'light' || b === 'dark' || b === 'satellite') return b;
    return isDark() ? 'dark' : 'light'; // 'auto'
  }

  private numAttr(name: string, dflt: number): number {
    const v = this.getAttribute(name);
    if (v === null) return dflt;
    const n = Number(v);
    return Number.isFinite(n) ? n : dflt;
  }
}

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}

function isDark(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}
