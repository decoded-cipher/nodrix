// Management MCP tools (Phase 3): create/update + run + control writes. Never
// delete. Registered only when the token is admin-scope AND mcp_write_enabled is
// on (see agent.ts), and each tool delegates to the shared service layer, which
// re-derives the token creator's authority — so MCP can never exceed the human.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Env } from '../env';
import type { McpProps } from './gate';
import { actorOf, scopeProjectId } from './scope';
import { run } from './result';
import { redactIntegration } from './redact';
import { createProject, updateProject } from '../domains/projects/service';
import { createVariable, updateVariable, setVariableControl } from '../domains/variables/service';
import { createDashboard, updateDashboard, getDashboard } from '../domains/dashboards/service';
import { newId } from '../platform/lib/ids';
import { createAutomation, updateAutomation, runAutomationNow } from '../domains/automations/service';
import { createIntegration, updateIntegration, testIntegration } from '../domains/integrations/service';

const project = z
  .string()
  .describe('Project id. Optional for a project-scoped token; required for an all-projects token.')
  .optional();

export function registerWriteTools(server: McpServer, env: Env, props: McpProps): void {
  const actor = () => actorOf(props);

  server.registerTool(
    'create_project',
    { description: 'Create a project. Requires an owner/admin token.', inputSchema: { name: z.string() } },
    (args) => run(() => createProject(env, actor(), { name: args.name }))
  );

  server.registerTool(
    'update_project',
    {
      description: 'Rename or re-describe a project.',
      inputSchema: { project, name: z.string().optional(), description: z.string().nullable().optional() },
    },
    (args) =>
      run(() => updateProject(env, actor(), scopeProjectId(props, args.project), { name: args.name, description: args.description }))
  );

  server.registerTool(
    'create_variable',
    {
      description: 'Declare a variable (optionally with a unit). Telemetry also auto-creates variables.',
      inputSchema: { project, key: z.string(), unit: z.string().nullable().optional() },
    },
    (args) => run(() => createVariable(env, actor(), scopeProjectId(props, args.project), { key: args.key, unit: args.unit }))
  );

  server.registerTool(
    'update_variable',
    {
      description: "Update a variable's unit.",
      inputSchema: { project, variable_id: z.string(), unit: z.string().nullable() },
    },
    (args) => run(() => updateVariable(env, actor(), scopeProjectId(props, args.project), args.variable_id, { unit: args.unit }))
  );

  server.registerTool(
    'set_variable',
    {
      description:
        'Enqueue a control write to hardware: set a variable value the device picks up on its next poll. The variable must already exist in the project.',
      inputSchema: {
        project,
        variable: z.string().describe('Variable key.'),
        value: z.any().describe('Value to send (number, boolean, string, or JSON).'),
      },
    },
    (args) => run(() => setVariableControl(env, actor(), scopeProjectId(props, args.project), { variable: args.variable, value: args.value }))
  );

  server.registerTool(
    'create_dashboard',
    {
      description: 'Create a dashboard. Layout is the widget-grid object; omit for an empty grid.',
      inputSchema: { project, name: z.string(), layout: z.any().optional() },
    },
    (args) => run(() => createDashboard(env, actor(), scopeProjectId(props, args.project), { name: args.name, layout: args.layout }))
  );

  server.registerTool(
    'update_dashboard',
    {
      description: 'Update a dashboard name/description/layout. Pass if_updated_at for optimistic concurrency.',
      inputSchema: {
        project,
        dashboard_id: z.string(),
        name: z.string().optional(),
        description: z.string().nullable().optional(),
        layout: z.any().optional(),
        if_updated_at: z.number().optional(),
      },
    },
    (args) =>
      run(() =>
        updateDashboard(env, actor(), scopeProjectId(props, args.project), args.dashboard_id, {
          name: args.name,
          description: args.description,
          layout: args.layout,
          if_updated_at: args.if_updated_at,
        })
      )
  );

  const widgetType = z.enum([
    'iot-value', 'iot-gauge', 'iot-chart', 'iot-toggle', 'iot-push', 'iot-slider', 'iot-map',
  ]);

  type WidgetItem = { id: string; type: string; x: number; y: number; w: number; h: number; props: Record<string, unknown> };
  type DashboardLayout = { grid: { columns: number }; items: WidgetItem[]; mobile?: unknown; refresh?: number };

  server.registerTool(
    'add_widget',
    {
      description:
        'Add a widget to a dashboard. Generates the widget id if omitted. Returns the inserted widget.',
      inputSchema: {
        project,
        dashboard_id: z.string(),
        type: widgetType,
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
        props: z.record(z.string(), z.unknown()).optional(),
        widget_id: z.string().optional(),
      },
    },
    (args) =>
      run(async () => {
        const pid = scopeProjectId(props, args.project);
        const dash = await getDashboard(env, pid, args.dashboard_id);
        const layout = (dash.layout ?? { grid: { columns: 24 }, items: [] }) as DashboardLayout;
        const widget: WidgetItem = {
          id: args.widget_id ?? newId('widget'),
          type: args.type,
          x: args.x, y: args.y, w: args.w, h: args.h,
          props: args.props ?? {},
        };
        const next: DashboardLayout = { ...layout, items: [...(layout.items ?? []), widget] };
        await updateDashboard(env, actor(), pid, args.dashboard_id, {
          layout: next,
          if_updated_at: dash.updated_at,
        });
        return { dashboard_id: dash.id, widget };
      })
  );

  server.registerTool(
    'update_widget',
    {
      description:
        'Update a single widget in a dashboard. Any field omitted is left unchanged; props REPLACES (not merges) — fetch via list_widgets first if you want to merge.',
      inputSchema: {
        project,
        dashboard_id: z.string(),
        widget_id: z.string(),
        type: widgetType.optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        w: z.number().optional(),
        h: z.number().optional(),
        props: z.record(z.string(), z.unknown()).optional(),
      },
    },
    (args) =>
      run(async () => {
        const pid = scopeProjectId(props, args.project);
        const dash = await getDashboard(env, pid, args.dashboard_id);
        const layout = (dash.layout ?? { grid: { columns: 24 }, items: [] }) as DashboardLayout;
        const items = layout.items ?? [];
        const idx = items.findIndex((w) => w.id === args.widget_id);
        if (idx === -1) {
          throw new Error(`widget ${args.widget_id} not found in dashboard ${args.dashboard_id}`);
        }
        const cur = items[idx]!;
        const next: WidgetItem = {
          id: cur.id,
          type: args.type ?? cur.type,
          x: args.x ?? cur.x,
          y: args.y ?? cur.y,
          w: args.w ?? cur.w,
          h: args.h ?? cur.h,
          props: args.props ?? cur.props,
        };
        const newItems = items.slice();
        newItems[idx] = next;
        await updateDashboard(env, actor(), pid, args.dashboard_id, {
          layout: { ...layout, items: newItems },
          if_updated_at: dash.updated_at,
        });
        return { dashboard_id: dash.id, widget: next };
      })
  );

  server.registerTool(
    'create_automation',
    {
      description: 'Create an automation. trigger_type ∈ variable|scene|schedule|sunset_sunrise|event.',
      inputSchema: {
        project,
        name: z.string(),
        description: z.string().nullable().optional(),
        trigger_type: z.enum(['variable', 'scene', 'schedule', 'sunset_sunrise', 'event']),
        trigger_config: z.any().optional(),
        actions: z.array(z.any()).optional(),
        enabled: z.boolean().optional(),
      },
    },
    (args) =>
      run(() =>
        createAutomation(env, actor(), scopeProjectId(props, args.project), {
          name: args.name,
          description: args.description,
          trigger_type: args.trigger_type,
          trigger_config: args.trigger_config,
          actions: args.actions,
          enabled: args.enabled,
        })
      )
  );

  server.registerTool(
    'update_automation',
    {
      description: 'Update an automation (name, enabled, trigger_config, actions).',
      inputSchema: {
        project,
        automation_id: z.string(),
        name: z.string().optional(),
        description: z.string().nullable().optional(),
        enabled: z.boolean().optional(),
        trigger_config: z.any().optional(),
        actions: z.array(z.any()).optional(),
      },
    },
    (args) =>
      run(() =>
        updateAutomation(env, actor(), scopeProjectId(props, args.project), args.automation_id, {
          name: args.name,
          description: args.description,
          enabled: args.enabled,
          trigger_config: args.trigger_config,
          actions: args.actions,
        })
      )
  );

  server.registerTool(
    'run_automation',
    {
      description: 'Run an automation now (drives scene automations; also a test harness).',
      inputSchema: { project, automation_id: z.string() },
    },
    (args) => run(() => runAutomationNow(env, actor(), scopeProjectId(props, args.project), args.automation_id))
  );

  server.registerTool(
    'create_integration',
    {
      description: 'Create an integration. kind ∈ webhook|code_block|slack|email|mqtt|http_service.',
      inputSchema: {
        project,
        name: z.string(),
        kind: z.enum(['webhook', 'code_block', 'slack', 'email', 'mqtt', 'http_service']),
        config: z.any().optional(),
        enabled: z.boolean().optional(),
      },
    },
    (args) =>
      run(async () =>
        redactIntegration(
          await createIntegration(env, actor(), scopeProjectId(props, args.project), {
            name: args.name,
            kind: args.kind,
            config: args.config,
            enabled: args.enabled,
          })
        )
      )
  );

  server.registerTool(
    'update_integration',
    {
      description: 'Update an integration (name, config, enabled).',
      inputSchema: {
        project,
        integration_id: z.string(),
        name: z.string().optional(),
        config: z.any().optional(),
        enabled: z.boolean().optional(),
      },
    },
    (args) =>
      run(async () =>
        redactIntegration(
          await updateIntegration(env, actor(), scopeProjectId(props, args.project), args.integration_id, {
            name: args.name,
            config: args.config,
            enabled: args.enabled,
          })
        )
      )
  );

  server.registerTool(
    'test_integration',
    {
      description: 'Fire an integration once with a synthetic context to verify delivery.',
      inputSchema: { project, integration_id: z.string() },
    },
    (args) => run(() => testIntegration(env, actor(), scopeProjectId(props, args.project), args.integration_id))
  );
}
