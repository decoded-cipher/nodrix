// Shared types for the automation/integration runtime.
//
// Trigger/action node configs live inside the automation's `graph` JSON. These
// are the parsed config shapes for each node kind.

export type VariableOperator = '>' | '<' | '>=' | '<=' | '==' | '!=' | 'changed';

export type VariableTriggerConfig = {
  variable: string;                    // variable key
  operator: VariableOperator;
  value?: number | string | boolean;   // omitted for 'changed'
  mode?: 'edge' | 'always';            // edge (default): fire once on entry
  cooldown_seconds?: number;           // min seconds between runs; suppresses re-fires
};

export type ScheduleTriggerConfig = {
  time: string;                        // 'HH:MM' (24h)
  days?: number[];                     // 0=Sun..6=Sat; empty/absent = every day
  tz?: string;                         // IANA tz, default 'UTC'
};

export type SolarTriggerConfig = {
  event: 'sunrise' | 'sunset';
  lat: number;
  lng: number;
  offset_minutes?: number;             // +/- minutes around the solar event
};

export type EventTriggerConfig = {
  event: string;                       // matched against POST /v1/events { event }
};

export type Action =
  | { type: 'set_variable'; variable: string; value: number | string | boolean }
  | { type: 'call_integration'; integration_id: string; payload?: Record<string, unknown> }
  | { type: 'emit_event'; event: string; payload?: Record<string, unknown> };

// Flow-graph model lives in the shared catalog (used by web + worker); re-exported
// so engine imports keep resolving from './types'.
export type { GraphNode, GraphEdge, AutomationGraph } from '@nodrix/blocks-shared';

export type TriggerSource = 'variable' | 'manual' | 'event' | 'schedule' | 'sunset_sunrise';

// Threaded through a run: feeds integration templating/payloads, the audit
// entry, and the emit_event recursion guard.
export type AutomationContext = {
  source: TriggerSource;
  projectId: string;
  ts: number;                          // unix seconds
  variable?: string;
  value?: unknown;
  event?: string;
  payload?: Record<string, unknown>;
  depth: number;                       // emit_event recursion depth
  entryNodeId?: string;                // trigger node that fired; defaults to the graph entry
  resumeNodeId?: string;               // set when resuming a delay: that node passes through, cooldown is bypassed
};

export type RunStatus = 'ok' | 'error' | 'skipped';

export type RunResult = {
  status: RunStatus;
  error?: string;
  actionsRun: number;
};

// Minimal column projections the engine reads from D1.
export type AutomationRow = {
  id: string;
  project_id: string;
  name: string;
  enabled: number;
  trigger_type: string;                // denormalized primary trigger kind
  graph: string | null;                // JSON AutomationGraph; the source of truth
  last_run_at: number | null;
};

// Minimal column projection the engine reads from D1 — defined in the shared
// integrations package alongside the runtime that consumes it.
export type { IntegrationRow } from '@nodrix/integrations-shared';
