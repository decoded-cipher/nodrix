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
import { refreshProps } from './scope';
import { run } from './result';
import { ServiceError } from '../platform/lib/service';

// Sessions are hard-expired so abandoned or junk session objects don't pile up.
const SESSION_TTL_SECONDS = 24 * 60 * 60;

export class NodrixMcpAgent extends McpAgent<Env, unknown, McpProps> {
  server = new McpServer(
    { name: 'nodrix', version: VERSION },
    { capabilities: { tools: {}, resources: {} } }
  );

  async init(): Promise<void> {
    await this.schedule(SESSION_TTL_SECONDS, 'expire', undefined, { idempotent: true });

    const props = this.props;
    if (!props) return; // no auth context resolved — expose nothing

    registerReadTools(guarded(this.server, this.env, props, false), this.env, props);
    registerResources(this.server, this.env, props);

    // Management/control tools require an admin-scope token AND the owner's
    // explicit mcp_write_enabled opt-in. Both are re-checked on every call.
    if (props.scope === 'admin' && (await mcpWriteEnabled(this.env))) {
      registerWriteTools(guarded(this.server, this.env, props, true), this.env, props);
    }
  }

  async expire(): Promise<void> {
    await this.destroy();
  }
}

// Wraps registerTool so every call re-authorizes the session's credential first.
function guarded(server: McpServer, env: Env, props: McpProps, write: boolean): McpServer {
  return new Proxy(server, {
    get(target, key, receiver) {
      if (key !== 'registerTool') return Reflect.get(target, key, receiver);
      return (name: string, config: unknown, handler: (...args: unknown[]) => unknown) =>
        target.registerTool(name, config as never, (async (...args: unknown[]) => {
          try {
            await refreshProps(env, props);
            if (write && !(props.scope === 'admin' && (await mcpWriteEnabled(env)))) {
              throw new ServiceError('forbidden', 'MCP writes are disabled');
            }
          } catch (e) {
            return run(() => Promise.reject(e));
          }
          return handler(...args);
        }) as never);
    },
  });
}
