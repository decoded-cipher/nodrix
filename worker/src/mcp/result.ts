// Shared result mapping for MCP tools: serialize success as pretty JSON text,
// and turn a thrown ServiceError (or any error) into an MCP tool error result
// instead of crashing the request.

import { isServiceError } from '../platform/lib/service';

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

export async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    const data = await fn();
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  } catch (e) {
    const msg = isServiceError(e)
      ? `${e.code}: ${e.message}`
      : (e instanceof Error ? e.message : 'internal error');
    return { content: [{ type: 'text', text: msg }], isError: true };
  }
}
