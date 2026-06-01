// Integration catalog, types, and pure helpers. Worker-safe (no fetch/DOM).
// The behavior (executeIntegration + per-kind handlers) lives in ./runtime.ts.

import webhook from './webhook/manifest.json';
import httpService from './http_service/manifest.json';
import email from './email/manifest.json';
import telegram from './telegram/manifest.json';
import slack from './slack/manifest.json';
import discord from './discord/manifest.json';

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

export type ConnSpec = {
  kind: IntegrationKind;
  label: string;
  description: string;
  icon: string;                 // 24x24 outline path
  executable: boolean;          // false = "coming soon", not run by the engine yet
  fields: readonly ConnField[];
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

const RAW = [webhook, httpService, email, telegram, slack, discord] as const;

export type IntegrationKind = (typeof RAW)[number]['kind'];

export const CATALOG: readonly ConnSpec[] = RAW as unknown as readonly ConnSpec[];

export function connSpec(kind: IntegrationKind): ConnSpec {
  return CATALOG.find((c) => c.kind === kind) ?? CATALOG[0]!;
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
