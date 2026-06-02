// Integration catalog, types, and pure helpers. Worker-safe (no fetch/DOM).
// The behavior (executeIntegration + per-kind handlers) lives in ./runtime.ts.

import httpService from './http_service/manifest.json';
import email from './email/manifest.json';
import telegram from './telegram/manifest.json';
import slack from './slack/manifest.json';
import discord from './discord/manifest.json';
import twilio from './twilio/manifest.json';
import msTeams from './ms_teams/manifest.json';
import pagerduty from './pagerduty/manifest.json';

// ─── Catalog types ────────────────────────────────────────────────────────────

export type ConnFieldType = 'text' | 'url' | 'textarea' | 'json' | 'select' | 'code';

export type ConnField = {
  key: string;                  // maps to a config key
  label: string;
  type: ConnFieldType;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  mono?: boolean;               // monospace input
  options?: readonly string[];  // for type 'select'
  default?: string;
};

// Declarative card subtitle (JSON can't hold a function); interpreted by summarize().
export type SummaryDescriptor = {
  template?: string;
  value?: string;
  requires?: string;
  fallback?: string;
};

// One function an integration can perform. `params` lists the keys of the
// fields (from `fields`) this operation collects at the call site — a field key
// shared by several operations is simply listed in each (no separate "common").
export type ConnOperation = {
  key: string;
  label: string;
  description?: string;
  params: readonly string[];
};

export type ConnSpec = {
  kind: IntegrationKind;
  label: string;
  description: string;
  icon: string;                 // 24x24 outline path
  executable: boolean;          // false = "coming soon", not run by the engine yet
  fields: readonly ConnField[]; // every field: connection-level + every operation's params
  operations?: readonly ConnOperation[]; // omitted = single implicit operation
  summary: SummaryDescriptor;
};

// ─── Runtime types (shared by worker engine + admin/web) ──────────────────────

// Minimal column projection the engine reads from D1.
export type IntegrationRow = {
  id: string;
  project_id: string;
  name: string;
  kind: string;
  config: string;               // JSON
  enabled: number;
};

// Admin-facing row (config parsed). Mirrors the integrations API + web store.
export type Integration = {
  id: string;
  project_id: string;
  name: string;
  kind: IntegrationKind;
  config: unknown;              // JSON; shape depends on kind
  enabled: boolean;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
  last_run_at: number | null;
  last_run_status: 'ok' | 'error' | 'skipped' | null;
  last_error: string | null;
};

export type IntegrationResult = { status: 'ok' | 'error' | 'skipped'; detail?: string };

// The subset of the engine's AutomationContext the runtime reads. The worker's
// AutomationContext is structurally assignable to this.
export type IntegrationContext = {
  source: string;
  projectId: string;
  ts: number;
  variable?: string;
  value?: unknown;
  event?: string;
  payload?: Record<string, unknown>;
};

// ─── Catalog ──────────────────────────────────────────────────────────────────

const RAW = [httpService, email, telegram, slack, discord, twilio, msTeams, pagerduty] as const;

export type IntegrationKind = (typeof RAW)[number]['kind'];

export const CATALOG: readonly ConnSpec[] = RAW as unknown as readonly ConnSpec[];

export function connSpec(kind: IntegrationKind): ConnSpec {
  return CATALOG.find((c) => c.kind === kind) ?? CATALOG[0]!;
}

export function connOperations(kind: IntegrationKind): readonly ConnOperation[] {
  return connSpec(kind).operations ?? [];
}

// Defaults to the kind's first operation when opKey is absent/unknown.
export function operationSpec(kind: IntegrationKind, opKey?: string): ConnOperation | undefined {
  const ops = connOperations(kind);
  return ops.find((o) => o.key === opKey) ?? ops[0];
}

// Field keys referenced by some operation — i.e. the call-site params.
function paramKeys(spec: ConnSpec): ReadonlySet<string> {
  const s = new Set<string>();
  for (const op of spec.operations ?? []) for (const k of op.params) s.add(k);
  return s;
}

// Connection-level fields = those no operation references (stored on the
// instance). A kind with no operations keeps all its fields here.
export function connectionFields(kind: IntegrationKind): readonly ConnField[] {
  const spec = connSpec(kind);
  const params = paramKeys(spec);
  return spec.fields.filter((f) => !params.has(f.key));
}

// Resolve an operation's param keys to their field definitions, in order.
export function operationFields(kind: IntegrationKind, opKey?: string): readonly ConnField[] {
  const spec = connSpec(kind);
  const op = operationSpec(kind, opKey);
  if (!op) return [];
  const byKey = new Map(spec.fields.map((f) => [f.key, f]));
  return op.params.map((k) => byKey.get(k)).filter((f): f is ConnField => !!f);
}

export const EXECUTABLE_CONNECTIONS = CATALOG.filter((c) => c.executable);
export const COMING_SOON_CONNECTIONS = CATALOG.filter((c) => !c.executable);

// Non-empty tuple for allowlists (worker validation, MCP z.enum, …).
export const INTEGRATION_KINDS = CATALOG.map((c) => c.kind) as [IntegrationKind, ...IntegrationKind[]];

export const VALID_KINDS: ReadonlySet<IntegrationKind> = new Set(INTEGRATION_KINDS);

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Used by the run handlers for user-facing templates ({{variable}}, {{value}}, …).
export function interpolate(tpl: string, vars: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k: string) => {
    const v = vars[k];
    return v === undefined || v === null ? '' : String(v);
  });
}

export function summarize(spec: Pick<ConnSpec, 'summary'>, config: Record<string, unknown>): string {
  const s = spec.summary;
  if (s.requires && !str(config[s.requires])) return s.fallback ?? '';
  if (s.value !== undefined) return s.value;
  if (s.template !== undefined) {
    const out = fillTemplate(s.template, config);
    return out.trim() ? out : (s.fallback ?? '');
  }
  return s.fallback ?? '';
}

// Like interpolate, but supports {{key:default}} for summary descriptors.
function fillTemplate(tpl: string, vars: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([\w.]+)(?::([^}]*))?\}\}/g, (_, k: string, def?: string) => {
    const v = vars[k];
    const s = v === undefined || v === null ? '' : String(v);
    return s !== '' ? s : (def ?? '');
  });
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
