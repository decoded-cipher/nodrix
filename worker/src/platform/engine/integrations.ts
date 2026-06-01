// Execution lives in @nodrix/integrations-shared; re-exported here. The
// D1-touching `recordIntegrationRun` stays in the worker (it writes env.DB).

import type { Env } from '../../env';
import type { IntegrationResult } from '@nodrix/integrations-shared';

export { executeIntegration } from '@nodrix/integrations-shared/runtime';
export type { IntegrationResult } from '@nodrix/integrations-shared';

// Stamps the outcome of a delivery onto the integration row so the UI can show
// "last delivered / last error" per connection. Best-effort: failures here must
// not break the run, so callers swallow errors.
export async function recordIntegrationRun(
  env: Env,
  id: string,
  result: IntegrationResult
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(`UPDATE integrations SET last_run_at = ?, last_run_status = ?, last_error = ? WHERE id = ?`)
    .bind(now, result.status, result.status === 'error' ? (result.detail ?? 'error') : null, id)
    .run();
}
