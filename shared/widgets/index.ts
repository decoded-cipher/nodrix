// Widget catalog, types, and pure helpers. Worker-safe (no DOM).
// The registry (browser-only customElements.define) lives in ./registry.ts.

import iotValue from './iot-value/manifest.json';
import iotGauge from './iot-gauge/manifest.json';
import iotChart from './iot-chart/manifest.json';
import iotMap from './iot-map/manifest.json';
import iotToggle from './iot-toggle/manifest.json';
import iotPush from './iot-push/manifest.json';
import iotSlider from './iot-slider/manifest.json';
import iotColor from './iot-color/manifest.json';

// ─── Types ──────────────────────────────────────────────────────────────────
// Loose on purpose — runtime data shape matches what the manifests declare.

export type Kinded = { kind: string } & Record<string, unknown>;

export type WidgetField = {
  key: string;
  label: string;
  type: string;
  options?: ReadonlyArray<string>;
  default?: unknown;
};

export type WidgetManifest = {
  // Identity
  id: string;
  label: string;
  description: string;
  category: string;
  dataTypes: ReadonlyArray<string>;
  whenToUse: string;
  icon: string;
  // Layout
  defaultSize: { w: number; h: number };
  defaultProps: Record<string, unknown>;
  // Form + render
  fields: ReadonlyArray<WidgetField>;
  bindings: { attributes: Array<Record<string, unknown>>; properties: Array<Record<string, unknown>> };
  // Data wiring
  runtime: {
    variableExtractor: Kinded;
    liveUpdate: Kinded;
    snapshot: Kinded;
  };
  // Optional render quirks
  quirks?: {
    mobile?: { paired?: boolean };
    swapDimensionsOnPropChange?: string;
  };
  // MCP (AI clients)
  mcp: {
    description: string;
    propTypes: Record<string, string>;
  };
};

// ─── Catalog ────────────────────────────────────────────────────────────────

const RAW = [iotValue, iotGauge, iotChart, iotMap, iotToggle, iotPush, iotSlider, iotColor] as const;

export type WidgetType = (typeof RAW)[number]['id'];

export const CATALOG: ReadonlyArray<WidgetManifest> =
  RAW as unknown as ReadonlyArray<WidgetManifest>;

export const WIDGET_IDS: ReadonlyArray<WidgetType> = CATALOG.map((m) => m.id as WidgetType);

export const ALLOWED_TYPES: ReadonlySet<WidgetType> = new Set(WIDGET_IDS);

const BY_ID = new Map<WidgetType, WidgetManifest>(
  CATALOG.map((m) => [m.id as WidgetType, m]),
);

export function manifestFor(type: WidgetType): WidgetManifest {
  const m = BY_ID.get(type);
  if (!m) throw new Error(`Unknown widget type: ${type}`);
  return m;
}

// ─── Variable extraction ────────────────────────────────────────────────────
// Driven by manifest.variableExtractor — same dispatch in web renderer + worker
// validator. Kinds: 'none' | 'scalar' | 'arrayItems' | 'markerArray'.

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function extractVariables(
  manifest: Pick<WidgetManifest, 'runtime'>,
  props: Record<string, unknown>,
): string[] {
  const ex = manifest.runtime.variableExtractor;
  const kind = ex.kind;

  if (kind === 'none') return [];

  if (kind === 'scalar') {
    const v = str(props[str(ex['prop'])]);
    return v ? [v] : [];
  }

  if (kind === 'arrayItems') {
    const arr = props[str(ex['prop'])];
    if (!Array.isArray(arr)) return [];
    const varKey = str(ex['varKey']);
    const out: string[] = [];
    for (const item of arr as Array<Record<string, unknown>>) {
      const v = str(item?.[varKey]);
      if (v) out.push(v);
    }
    return out;
  }

  if (kind === 'markerArray') {
    const arr = props[str(ex['prop'])];
    if (!Array.isArray(arr)) return [];
    const srcField = str(ex['sourceField']);
    const srcVarValue = str(ex['sourceVariableValue']);
    const gated = Array.isArray(ex['gatedVarKeys']) ? (ex['gatedVarKeys'] as string[]) : [];
    const always = Array.isArray(ex['unconditionalVarKeys']) ? (ex['unconditionalVarKeys'] as string[]) : [];
    const out: string[] = [];
    for (const item of arr as Array<Record<string, unknown>>) {
      const source = item?.[srcField] ?? 'static';
      if (source === srcVarValue) {
        for (const k of gated) {
          const v = str(item?.[k]);
          if (v) out.push(v);
        }
      }
      for (const k of always) {
        const v = str(item?.[k]);
        if (v) out.push(v);
      }
    }
    return out;
  }

  return [];
}

export function isChartSeriesExtractor(ex: Kinded): boolean {
  return ex.kind === 'arrayItems' && ex['isChartSeries'] === true;
}
