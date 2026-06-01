// Read-only MCP tools. Every tool resolves its target project through the
// token scope (see scope.ts) before calling the shared service layer, so it can
// never read a project the token can't reach.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Env } from '../env';
import type { McpProps } from './gate';
import { actorOf, resolveProjectId } from './scope';
import { run } from './result';
import { listAccessibleProjects, getProject } from '../domains/projects/service';
import { listVariables, getState, getSeries } from '../domains/variables/service';
import { listDashboards, getDashboard } from '../domains/dashboards/service';
import { listAutomations } from '../domains/automations/service';
import { listIntegrations } from '../domains/integrations/service';
import { redactIntegration } from './redact';
import { CATALOG as WIDGET_CATALOG } from '@nodrix/widgets-shared';
import { TRIGGER_CATALOG, CONDITION_CATALOG, ACTION_CATALOG, type BlockManifest } from '@nodrix/blocks-shared';
import { CATALOG as INTEGRATION_CATALOG } from '@nodrix/integrations-shared';

// Public MCP shape — mirrors what the old worker/src/mcp/widget-specs.ts exposed.
const WIDGET_SPECS = WIDGET_CATALOG.map((m) => ({
  type: m.id,
  description: m.mcp.description,
  defaultProps: m.defaultProps,
  propTypes: m.mcp.propTypes,
}));

// Automation block → the shape an agent needs to build a graph node { id, kind, config }.
const blockSpec = (b: BlockManifest) => ({
  kind: b.kind,
  category: b.category,
  label: b.label,
  description: b.description,
  ports: b.ports,
  fields: b.fields,
});

const READ_ONLY = { readOnlyHint: true } as const;
const project = z.string().describe('Project id. Optional for a project-scoped token; required for an all-projects token.');

export function registerReadTools(server: McpServer, env: Env, props: McpProps): void {
  server.registerTool(
    'list_projects',
    {
      description: 'List the projects this token can access.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    () =>
      run(async () => {
        // A project-scoped token sees only its own project.
        if (props.projectId) {
          const p = await getProject(env, props.projectId);
          return { projects: p ? [p] : [] };
        }
        return { projects: await listAccessibleProjects(env, actorOf(props)) };
      })
  );

  server.registerTool(
    'list_variables',
    {
      description: 'List declared variables (key, unit, last seen) for a project.',
      inputSchema: { project: project.optional() },
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        const pid = await resolveProjectId(env, props, args.project);
        return { project: pid, variables: await listVariables(env, pid) };
      })
  );

  server.registerTool(
    'get_state',
    {
      description: 'Get the latest value of every variable in a project.',
      inputSchema: { project: project.optional() },
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        const pid = await resolveProjectId(env, props, args.project);
        return { project: pid, state: await getState(env, pid) };
      })
  );

  server.registerTool(
    'get_series',
    {
      description: 'Get recent time-series points for one variable (recent ring buffer only).',
      inputSchema: {
        project: project.optional(),
        variable: z.string().describe('Variable key.'),
        window: z
          .string()
          .regex(/^\d+[smh]$/)
          .optional()
          .describe('Lookback window like 30s, 15m, 1h. Defaults to 1h.'),
      },
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        const pid = await resolveProjectId(env, props, args.project);
        const { window, points } = await getSeries(env, pid, args.variable, args.window ?? '1h');
        return { project: pid, variable: args.variable, window, points };
      })
  );

  server.registerTool(
    'list_dashboards',
    {
      description: 'List dashboards in a project.',
      inputSchema: { project: project.optional() },
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        const pid = await resolveProjectId(env, props, args.project);
        return { project: pid, dashboards: await listDashboards(env, pid) };
      })
  );

  server.registerTool(
    'get_dashboard',
    {
      description: 'Get one dashboard including its widget layout.',
      inputSchema: { project: project.optional(), dashboard_id: z.string() },
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        const pid = await resolveProjectId(env, props, args.project);
        return await getDashboard(env, pid, args.dashboard_id);
      })
  );

  server.registerTool(
    'list_widget_types',
    {
      description:
        'List the available widget types and their canonical prop shapes. Call before add_widget / update_widget to know what `props` each type expects.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    () => run(async () => ({ widget_types: WIDGET_SPECS }))
  );

  server.registerTool(
    'list_widgets',
    {
      description:
        'List widgets in a dashboard (id, type, position, props). Mutating tools take the whole layout — read this, edit items, write back via update_dashboard.',
      inputSchema: { project: project.optional(), dashboard_id: z.string() },
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        const pid = await resolveProjectId(env, props, args.project);
        const d = await getDashboard(env, pid, args.dashboard_id);
        const layout = d.layout as { grid?: { columns: number }; items?: unknown[] } | null;
        return {
          dashboard_id: d.id,
          updated_at: d.updated_at,
          grid: layout?.grid ?? { columns: 24 },
          widgets: Array.isArray(layout?.items) ? layout!.items : [],
        };
      })
  );

  server.registerTool(
    'list_block_types',
    {
      description:
        'List automation block kinds — triggers, conditions, actions — with their config fields and ports. ' +
        'Call before create_automation/update_automation: an automation is a flow graph of nodes ' +
        '{ id, kind, config } joined by edges { from, to, port }, where `kind` is one of these and `config` ' +
        'keys are each block’s field `key`s. Condition nodes branch via "true"/"false" output ports.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    () =>
      run(async () => ({
        triggers: TRIGGER_CATALOG.map(blockSpec),
        conditions: CONDITION_CATALOG.map(blockSpec),
        actions: ACTION_CATALOG.map(blockSpec),
      }))
  );

  server.registerTool(
    'list_integration_kinds',
    {
      description:
        'List integration kinds and the config fields each expects. Call before create_integration so ' +
        '`config` carries the right field keys (e.g. webhook → url; email → api_key, from, to).',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    () =>
      run(async () => ({
        integration_kinds: INTEGRATION_CATALOG.map((c) => ({
          kind: c.kind,
          label: c.label,
          description: c.description,
          executable: c.executable,
          fields: c.fields,
        })),
      }))
  );

  server.registerTool(
    'list_automations',
    {
      description: 'List automations (flow graph + last run status) in a project.',
      inputSchema: { project: project.optional() },
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        const pid = await resolveProjectId(env, props, args.project);
        return { project: pid, automations: await listAutomations(env, pid) };
      })
  );

  server.registerTool(
    'list_integrations',
    {
      description: 'List integrations in a project. Secret config values are redacted.',
      inputSchema: { project: project.optional() },
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        const pid = await resolveProjectId(env, props, args.project);
        const integrations = (await listIntegrations(env, pid)).map(redactIntegration);
        return { project: pid, integrations };
      })
  );
}
