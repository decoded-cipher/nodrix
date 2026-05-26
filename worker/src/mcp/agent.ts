// The MCP server, run on Workers as a Durable Object via the `agents` library.
// One instance per client session (keyed streamable-http:<sessionId>), so the
// server never funnels through a singleton. Tool/resource authority comes from
// `this.props`, set by the gate from the bearer token (see gate.ts).

import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Env } from '../env';
import type { McpProps } from './gate';
import { VERSION } from '../version.gen';
import { registerReadTools } from './tools-read';
import { registerWriteTools } from './tools-write';
import { registerResources } from './resources';
import { mcpWriteEnabled } from './flags';

export class NodrixMcpAgent extends McpAgent<Env, unknown, McpProps> {
  server = new McpServer(
    { name: 'nodrix', version: VERSION },
    { capabilities: { tools: {}, resources: {} } }
  );

  async init(): Promise<void> {
    const props = this.props;
    if (!props) return; // no auth context resolved — expose nothing

    registerReadTools(this.server, this.env, props);
    registerResources(this.server, this.env, props);

    // Management/control tools require an admin-scope token AND the owner's
    // explicit mcp_write_enabled opt-in. Either off → read-only.
    if (props.scope === 'admin' && (await mcpWriteEnabled(this.env))) {
      registerWriteTools(this.server, this.env, props);
    }
  }
}
