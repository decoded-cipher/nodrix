// Tool layer for the AI chat assistant. Mirrors the MCP tools but binds to the
// logged-in human (an http Actor) and a fixed project from the request URL.
//
// Read tools run server-side during the stream. Write tools are PROPOSALS: they
// are exposed to the model without an execute fn, so the model can only suggest
// them — the UI shows a confirm card and the human approves, which calls the
// /chat/apply route that runs the matching WRITE_TOOLS spec. Same service layer,
// same authority as the HTTP API; never more than the human. No delete tools.

import { z } from 'zod';
import { tool, isToolUIPart, type ToolSet, type UIMessage } from 'ai';
import type { Env } from '../../env';
import type { Actor } from '../../platform/lib/service';
import { redactIntegration } from '../../mcp/redact';
import { parseStructured, parseStructuredArray } from '../../mcp/coerce';
import { newId } from '../../platform/lib/ids';
import { listVariables, getState, getSeries, createVariable, updateVariable, setVariableControl } from '../variables/service';
import { listDashboards, getDashboard, createDashboard, updateDashboard } from '../dashboards/service';
import { listAutomations, createAutomation, updateAutomation, runAutomationNow } from '../automations/service';
import { listIntegrations, createIntegration, updateIntegration, testIntegration } from '../integrations/service';
import { dispatchEvent } from '../../platform/engine/run';
import { WIDGET_IDS, type WidgetType, CATALOG as WIDGET_CATALOG } from '@nodrix/widgets-shared';
import { TRIGGER_CATALOG, CONDITION_CATALOG, ACTION_CATALOG, type BlockManifest } from '@nodrix/blocks-shared';
import { INTEGRATION_KINDS, CATALOG as INTEGRATION_CATALOG, connectionFields, operationFields } from '@nodrix/integrations-shared';

const WIDGET_SPECS = WIDGET_CATALOG.map((m) => ({
  type: m.id,
  description: m.mcp.description,
  defaultProps: m.defaultProps,
  propTypes: m.mcp.propTypes,
}));

const blockSpec = (b: BlockManifest) => ({
  kind: b.kind,
  category: b.category,
  label: b.label,
  description: b.description,
  ports: b.ports,
  fields: b.fields,
});

const integrationKindSpecs = INTEGRATION_CATALOG.map((c) => ({
  kind: c.kind,
  label: c.label,
  description: c.description,
  executable: c.executable,
  connection_fields: connectionFields(c.kind),
  operations: (c.operations ?? []).map((o) => ({
    key: o.key,
    label: o.label,
    description: o.description,
    params: operationFields(c.kind, o.key),
  })),
}));

const widgetType = z.enum(WIDGET_IDS as unknown as readonly [WidgetType, ...WidgetType[]]);

type WidgetItem = { id: string; type: string; x: number; y: number; w: number; h: number; props: Record<string, unknown> };
type DashboardLayout = { grid: { columns: number }; items: WidgetItem[]; mobile?: unknown; refresh?: number };

// ── Read tools — executed inline during the stream ──────────────────────────

export function readTools(env: Env, projectId: string): ToolSet {
  return {
    list_variables: tool({
      description: 'List declared variables (key, unit, last seen) in this project.',
      inputSchema: z.object({}),
      execute: async () => ({ variables: await listVariables(env, projectId) }),
    }),
    get_state: tool({
      description: 'Get the latest value of every variable in this project.',
      inputSchema: z.object({}),
      execute: async () => ({ state: await getState(env, projectId) }),
    }),
    get_series: tool({
      description: 'Get recent time-series points for one variable (recent ring buffer only).',
      inputSchema: z.object({
        variable: z.string().describe('Variable key.'),
        window: z.string().regex(/^\d+[smh]$/).optional().describe('Lookback like 30s, 15m, 1h. Defaults to 1h.'),
      }),
      execute: async ({ variable, window }) => {
        const r = await getSeries(env, projectId, variable, window ?? '1h');
        return { variable, window: r.window, points: r.points };
      },
    }),
    list_dashboards: tool({
      description: 'List dashboards in this project.',
      inputSchema: z.object({}),
      execute: async () => ({ dashboards: await listDashboards(env, projectId) }),
    }),
    get_dashboard: tool({
      description: 'Get one dashboard including its widget layout.',
      inputSchema: z.object({ dashboard_id: z.string() }),
      execute: async ({ dashboard_id }) => getDashboard(env, projectId, dashboard_id),
    }),
    list_widgets: tool({
      description: 'List widgets in a dashboard (id, type, position, props).',
      inputSchema: z.object({ dashboard_id: z.string() }),
      execute: async ({ dashboard_id }) => {
        const d = await getDashboard(env, projectId, dashboard_id);
        const layout = (d.layout ?? null) as { grid?: { columns: number }; items?: unknown[] } | null;
        return {
          dashboard_id: d.id,
          updated_at: d.updated_at,
          grid: layout?.grid ?? { columns: 16 },
          widgets: Array.isArray(layout?.items) ? layout.items : [],
        };
      },
    }),
    list_widget_types: tool({
      description: 'List widget types and their canonical prop shapes. Call before proposing add_widget / update_widget.',
      inputSchema: z.object({}),
      execute: async () => ({ widget_types: WIDGET_SPECS }),
    }),
    list_block_types: tool({
      description:
        'List automation block kinds (triggers, conditions, actions) with config fields and ports. ' +
        'Call before proposing create_automation / update_automation: an automation is a flow graph of ' +
        'nodes { id, kind, config } joined by edges { from, to, port }.',
      inputSchema: z.object({}),
      execute: async () => ({
        triggers: TRIGGER_CATALOG.map(blockSpec),
        conditions: CONDITION_CATALOG.map(blockSpec),
        actions: ACTION_CATALOG.map(blockSpec),
      }),
    }),
    list_integration_kinds: tool({
      description: 'List integration kinds with their connection fields and operations. Call before proposing create_integration.',
      inputSchema: z.object({}),
      execute: async () => ({ integration_kinds: integrationKindSpecs }),
    }),
    list_automations: tool({
      description: 'List automations (flow graph + last run status) in this project.',
      inputSchema: z.object({}),
      execute: async () => ({ automations: await listAutomations(env, projectId) }),
    }),
    list_integrations: tool({
      description: 'List integrations in this project. Secret config values are redacted.',
      inputSchema: z.object({}),
      execute: async () => ({ integrations: (await listIntegrations(env, projectId)).map(redactIntegration) }),
    }),
  };
}

// ── Write tools — proposals the human confirms before they run ──────────────

const triggerType = z.enum(['variable', 'manual', 'schedule', 'sunset_sunrise', 'event']);

export type WriteSpec = {
  description: string;
  inputSchema: z.ZodType;
  run: (env: Env, actor: Actor, projectId: string, input: Record<string, unknown>) => Promise<unknown>;
};

// `any` is safe here: each spec's inputSchema validates the args before run() sees them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type A = any;

export const WRITE_TOOLS: Record<string, WriteSpec> = {
  create_variable: {
    description: 'Declare a variable (optionally with a unit).',
    inputSchema: z.object({ key: z.string(), unit: z.string().nullable().optional() }),
    run: (env, actor, pid, a: A) => createVariable(env, actor, pid, { key: a.key, unit: a.unit }),
  },
  update_variable: {
    description: "Update a variable's unit.",
    inputSchema: z.object({ variable_id: z.string(), unit: z.string().nullable() }),
    run: (env, actor, pid, a: A) => updateVariable(env, actor, pid, a.variable_id, { unit: a.unit }),
  },
  set_variable: {
    description:
      'Enqueue a control write to hardware: set a variable value the device picks up on its next poll. The variable must already exist.',
    inputSchema: z.object({ variable: z.string().describe('Variable key.'), value: z.any().describe('Value to send.') }),
    run: (env, actor, pid, a: A) => setVariableControl(env, actor, pid, { variable: a.variable, value: a.value }),
  },
  create_dashboard: {
    description: 'Create a dashboard. Layout is the widget-grid object; omit for an empty grid.',
    inputSchema: z.object({ name: z.string(), layout: z.any().optional() }),
    run: (env, actor, pid, a: A) => createDashboard(env, actor, pid, { name: a.name, layout: parseStructured(a.layout) }),
  },
  update_dashboard: {
    description: 'Update a dashboard name/description/layout. Pass if_updated_at for optimistic concurrency.',
    inputSchema: z.object({
      dashboard_id: z.string(),
      name: z.string().optional(),
      description: z.string().nullable().optional(),
      layout: z.any().optional(),
      if_updated_at: z.number().optional(),
    }),
    run: (env, actor, pid, a: A) =>
      updateDashboard(env, actor, pid, a.dashboard_id, {
        name: a.name,
        description: a.description,
        layout: parseStructured(a.layout),
        if_updated_at: a.if_updated_at,
      }),
  },
  add_widget: {
    description:
      'Add a widget to a dashboard. Call list_widget_types first for each type\'s `props` shape. Generates the widget id if omitted.',
    inputSchema: z.object({
      dashboard_id: z.string(),
      type: widgetType,
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
      props: z.record(z.string(), z.unknown()).optional(),
      widget_id: z.string().optional(),
    }),
    run: async (env, actor, pid, a: A) => {
      const dash = await getDashboard(env, pid, a.dashboard_id);
      const layout = (dash.layout ?? { grid: { columns: 16 }, items: [] }) as DashboardLayout;
      const widget: WidgetItem = { id: a.widget_id ?? newId('widget'), type: a.type, x: a.x, y: a.y, w: a.w, h: a.h, props: a.props ?? {} };
      await updateDashboard(env, actor, pid, a.dashboard_id, {
        layout: { ...layout, items: [...(layout.items ?? []), widget] },
        if_updated_at: dash.updated_at,
      });
      return { dashboard_id: dash.id, widget };
    },
  },
  update_widget: {
    description: 'Update a single widget in a dashboard. Omitted fields are unchanged; props REPLACES (not merges).',
    inputSchema: z.object({
      dashboard_id: z.string(),
      widget_id: z.string(),
      type: widgetType.optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      w: z.number().optional(),
      h: z.number().optional(),
      props: z.record(z.string(), z.unknown()).optional(),
    }),
    run: async (env, actor, pid, a: A) => {
      const dash = await getDashboard(env, pid, a.dashboard_id);
      const layout = (dash.layout ?? { grid: { columns: 16 }, items: [] }) as DashboardLayout;
      const items = layout.items ?? [];
      const idx = items.findIndex((w) => w.id === a.widget_id);
      if (idx === -1) throw new Error(`widget ${a.widget_id} not found in dashboard ${a.dashboard_id}`);
      const cur = items[idx]!;
      const next: WidgetItem = {
        id: cur.id,
        type: a.type ?? cur.type,
        x: a.x ?? cur.x,
        y: a.y ?? cur.y,
        w: a.w ?? cur.w,
        h: a.h ?? cur.h,
        props: a.props ?? cur.props,
      };
      const newItems = items.slice();
      newItems[idx] = next;
      await updateDashboard(env, actor, pid, a.dashboard_id, { layout: { ...layout, items: newItems }, if_updated_at: dash.updated_at });
      return { dashboard_id: dash.id, widget: next };
    },
  },
  create_automation: {
    description:
      'Create an automation. Prefer `graph` ({nodes,edges}) — call list_block_types first. The legacy ' +
      'trigger_type+trigger_config+actions shape still works for a simple linear automation.',
    inputSchema: z.object({
      name: z.string(),
      description: z.string().nullable().optional(),
      graph: z.any().optional(),
      trigger_type: triggerType.optional(),
      trigger_config: z.any().optional(),
      actions: z.array(z.any()).optional(),
      enabled: z.boolean().optional(),
    }),
    run: (env, actor, pid, a: A) =>
      createAutomation(env, actor, pid, {
        name: a.name,
        description: a.description,
        graph: parseStructured(a.graph),
        trigger_type: a.trigger_type,
        trigger_config: parseStructured(a.trigger_config),
        actions: parseStructuredArray(a.actions),
        enabled: a.enabled,
      }),
  },
  update_automation: {
    description: 'Update an automation. Pass `graph` to replace the whole flow, or name/enabled/trigger_config/actions for the legacy shape.',
    inputSchema: z.object({
      automation_id: z.string(),
      name: z.string().optional(),
      description: z.string().nullable().optional(),
      enabled: z.boolean().optional(),
      graph: z.any().optional(),
      trigger_type: triggerType.optional(),
      trigger_config: z.any().optional(),
      actions: z.array(z.any()).optional(),
    }),
    run: (env, actor, pid, a: A) =>
      updateAutomation(env, actor, pid, a.automation_id, {
        name: a.name,
        description: a.description,
        enabled: a.enabled,
        graph: parseStructured(a.graph),
        trigger_type: a.trigger_type,
        trigger_config: parseStructured(a.trigger_config),
        actions: parseStructuredArray(a.actions),
      }),
  },
  run_automation: {
    description: 'Run an automation now (drives manual automations; also a test harness).',
    inputSchema: z.object({ automation_id: z.string() }),
    run: (env, actor, pid, a: A) => runAutomationNow(env, actor, pid, a.automation_id),
  },
  emit_event: {
    description: 'Fire a named event, running any enabled event-triggered automations that match it.',
    inputSchema: z.object({ event: z.string(), payload: z.record(z.string(), z.unknown()).optional() }),
    run: async (env, _actor, pid, a: A) => ({ event: a.event, automations_run: await dispatchEvent(env, pid, a.event, a.payload) }),
  },
  create_integration: {
    description: `Create an integration. kind ∈ ${INTEGRATION_KINDS.join('|')}.`,
    inputSchema: z.object({ name: z.string(), kind: z.enum(INTEGRATION_KINDS), config: z.any().optional(), enabled: z.boolean().optional() }),
    run: async (env, actor, pid, a: A) =>
      redactIntegration(await createIntegration(env, actor, pid, { name: a.name, kind: a.kind, config: parseStructured(a.config), enabled: a.enabled })),
  },
  update_integration: {
    description: 'Update an integration (name, config, enabled).',
    inputSchema: z.object({ integration_id: z.string(), name: z.string().optional(), config: z.any().optional(), enabled: z.boolean().optional() }),
    run: async (env, actor, pid, a: A) =>
      redactIntegration(await updateIntegration(env, actor, pid, a.integration_id, { name: a.name, config: parseStructured(a.config), enabled: a.enabled })),
  },
  test_integration: {
    description: 'Fire an integration once with a synthetic context to verify delivery.',
    inputSchema: z.object({ integration_id: z.string() }),
    run: (env, actor, pid, a: A) => testIntegration(env, actor, pid, a.integration_id),
  },
};

// Write tools surfaced to the model as proposals (no execute) — the model can
// suggest them, but only /chat/apply runs them after the human approves.
export function proposalTools(): ToolSet {
  const out: ToolSet = {};
  for (const [name, spec] of Object.entries(WRITE_TOOLS)) {
    out[name] = tool({ description: spec.description, inputSchema: spec.inputSchema });
  }
  return out;
}

// Fill any unresolved (un-approved / declined-then-ignored) tool proposal with a
// placeholder result so convertToModelMessages never emits a dangling tool call,
// which the provider would reject.
export function sanitizeMessages(messages: UIMessage[]): UIMessage[] {
  return messages.map((m) => {
    if (m.role !== 'assistant') return m;
    const parts = m.parts.map((p) => {
      if (isToolUIPart(p) && p.state !== 'output-available' && p.state !== 'output-error') {
        return { ...p, state: 'output-available', output: { skipped: 'not executed' } };
      }
      return p;
    });
    return { ...m, parts } as UIMessage;
  });
}

export function systemPrompt(projectName: string): string {
  return [
    `You are the Nodrix assistant for the project "${projectName}".`,
    'Nodrix is an IoT/automation platform with variables, dashboards, automations, and integrations.',
    'Use the read tools to inspect project state. Use the write tools to PROPOSE operations.',
    'A proposed operation is shown to the user as a confirmation card and only runs after they approve.',
    'Never claim an operation is done until you receive its result.',
    'Before building an automation graph call list_block_types; before adding widgets call list_widget_types; before creating an integration call list_integration_kinds.',
    'Keep replies concise. Everything is scoped to this one project.',
  ].join(' ');
}
