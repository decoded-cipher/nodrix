// Runtime body validation for HTTP routes. A route parses with parseBody(schema);
// a bad payload throws a ServiceError that serviceErrorResponse turns into a clean
// 400, instead of malformed data reaching the service or D1.

import type { Context } from 'hono';
import type { ZodType } from 'zod';
import { ServiceError } from './service';

export async function parseBody<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ServiceError('bad_request', 'invalid JSON body', 'invalid_json');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join('.');
    throw new ServiceError('bad_request', issue?.message ?? 'invalid input', path ? `invalid:${path}` : 'invalid_input');
  }
  return parsed.data;
}
