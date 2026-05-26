// MCP deployment flags, backed by deployment_settings (KV-cached via getSetting).
// Both default OFF. The owner flips them in Settings → More.
//
//   mcp_enabled        — master switch. When absent, /v1/mcp returns 404 so a
//                        disabled server looks absent, not merely forbidden.
//   mcp_write_enabled  — gates the management/control tools. Even an
//                        admin-scope token gets read-only tools unless this is on,
//                        so an LLM can never command hardware by default.

import type { Env } from '../env';
import { getSetting } from '../platform/lib/deployment-settings';

export const MCP_ENABLED_KEY = 'mcp_enabled';
export const MCP_WRITE_ENABLED_KEY = 'mcp_write_enabled';

export async function mcpEnabled(env: Env): Promise<boolean> {
  return (await getSetting(env, MCP_ENABLED_KEY)) === '1';
}

export async function mcpWriteEnabled(env: Env): Promise<boolean> {
  return (await getSetting(env, MCP_WRITE_ENABLED_KEY)) === '1';
}
