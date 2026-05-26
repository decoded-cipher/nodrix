// MCP resources: a project's current state and its variable list, addressable as
// nodrix://{project}/state and nodrix://{project}/variables. Clients can attach
// these as context without a tool round-trip. Listing and reads are both scoped
// to what the token can reach.

import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Env } from '../env';
import type { McpProps } from './gate';
import { actorOf, resolveProjectId } from './scope';
import { listAccessibleProjects, getProject, type ProjectSummary } from '../domains/projects/service';
import { getState, listVariables } from '../domains/variables/service';

export function registerResources(server: McpServer, env: Env, props: McpProps): void {
  const accessibleProjects = async (): Promise<ProjectSummary[]> => {
    if (props.projectId) {
      const p = await getProject(env, props.projectId);
      return p ? [p] : [];
    }
    return listAccessibleProjects(env, actorOf(props));
  };

  server.registerResource(
    'project-state',
    new ResourceTemplate('nodrix://{project}/state', {
      list: async () => ({
        resources: (await accessibleProjects()).map((p) => ({
          uri: `nodrix://${p.id}/state`,
          name: `${p.name} — current state`,
          description: `Latest value of every variable in ${p.name}`,
          mimeType: 'application/json',
        })),
      }),
    }),
    { description: 'Latest value of every variable in a project.', mimeType: 'application/json' },
    async (uri, variables) => {
      const pid = await resolveProjectId(env, props, String(variables.project));
      const state = await getState(env, pid);
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ project: pid, state }, null, 2) },
        ],
      };
    }
  );

  server.registerResource(
    'project-variables',
    new ResourceTemplate('nodrix://{project}/variables', {
      list: async () => ({
        resources: (await accessibleProjects()).map((p) => ({
          uri: `nodrix://${p.id}/variables`,
          name: `${p.name} — variables`,
          mimeType: 'application/json',
        })),
      }),
    }),
    { description: 'Declared variables in a project.', mimeType: 'application/json' },
    async (uri, variables) => {
      const pid = await resolveProjectId(env, props, String(variables.project));
      const vars = await listVariables(env, pid);
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ project: pid, variables: vars }, null, 2) },
        ],
      };
    }
  );
}
