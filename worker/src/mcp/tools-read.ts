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
    'list_automations',
    {
      description: 'List automations (triggers + actions, last run status) in a project.',
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
