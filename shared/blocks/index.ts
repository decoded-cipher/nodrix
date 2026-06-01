// Manifest-driven catalog of automation blocks (triggers + actions). Per-kind
// eval/run lives in the worker engine, so these are pure metadata; the kind enums
// and validation sets all derive from here. Worker-safe (no fetch/DOM).

import type { SummaryDescriptor } from '@nodrix/integrations-shared';
import { TRIGGER_CATALOG } from './triggers';
import { ACTION_CATALOG } from './actions';

export { TRIGGER_CATALOG } from './triggers';
export { ACTION_CATALOG } from './actions';
export * from './graph';

// ─── Manifest types ─────────────────────────────────────────────────────────

export type BlockCategory = 'trigger' | 'condition' | 'action';

// Superset of integration ConnField types; drives the editor field renderer.
export type BlockFieldType =
  | 'text'
  | 'textarea'
  | 'json'
  | 'select'
  | 'number'
  | 'boolean'
  | 'variable'
  | 'integration'
  | 'time'
  | 'weekdays';

export type BlockField = {
  key: string;
  label: string;
  type: BlockFieldType;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  mono?: boolean;
  options?: readonly string[];
  default?: string | number | boolean;
};

// Graph ports: triggers are entrypoints (out only), actions are in→out,
// conditions fan out via named ports (e.g. true/false).
export type BlockPorts = {
  in?: readonly string[];
  out?: readonly string[];
};

export type BlockManifest = {
  kind: string;
  category: BlockCategory;
  label: string;
  description: string;
  icon: string;                 // 24x24 outline path
  executable: boolean;          // false = "coming soon", not run by the engine yet
  ports: BlockPorts;
  fields: readonly BlockField[];
  summary?: SummaryDescriptor;
};

// ─── Derived kinds ──────────────────────────────────────────────────────────

export type TriggerKind = (typeof TRIGGER_CATALOG)[number]['kind'];
export type ActionKind = (typeof ACTION_CATALOG)[number]['kind'];
export type BlockKind = TriggerKind | ActionKind;

// Non-empty tuples for allowlists (worker validation, z.enum, …).
export const TRIGGER_KINDS = TRIGGER_CATALOG.map((t) => t.kind) as [TriggerKind, ...TriggerKind[]];
export const ACTION_KINDS = ACTION_CATALOG.map((a) => a.kind) as [ActionKind, ...ActionKind[]];

export const VALID_TRIGGER_KINDS: ReadonlySet<string> = new Set(TRIGGER_KINDS);
export const VALID_ACTION_KINDS: ReadonlySet<string> = new Set(ACTION_KINDS);

export function triggerSpec(kind: string): BlockManifest {
  return TRIGGER_CATALOG.find((t) => t.kind === kind) ?? TRIGGER_CATALOG[0];
}

export function actionSpec(kind: string): BlockManifest {
  return ACTION_CATALOG.find((a) => a.kind === kind) ?? ACTION_CATALOG[0];
}

// Find a block by kind across catalogs (the editor only knows a node's kind).
export function findBlock(kind: string): BlockManifest | undefined {
  return TRIGGER_CATALOG.find((b) => b.kind === kind) ?? ACTION_CATALOG.find((b) => b.kind === kind);
}
