import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { Env } from '../env';
import { ensureMigrated } from '../db/auto-migrate';

// Provisioning workflow. Reserved for durable-execution provisioning tasks that
// genuinely need checkpointing/retries (post-v1: dataset imports, complex
// re-provisioning). Routine migration application happens automatically in the
// request pipeline; this Workflow exists for the §10 contract and is exposed
// via /v1/admin/reprovision (admin-only) for forcing a fresh migration check.
//
// MUST NEVER be invoked from the telemetry/commands/dashboard hot paths.
export type ProvisionParams = {
  reason: 'manual_reprovision' | 'post_deploy_check';
};

export class Provision extends WorkflowEntrypoint<Env, ProvisionParams> {
  override async run(_event: WorkflowEvent<ProvisionParams>, step: WorkflowStep) {
    await step.do('run-migrations', async () => {
      await ensureMigrated(this.env.DB);
      return { ok: true };
    });

    await step.do('sanity-check-r2', async () => {
      // Read a known-absent key; just exercising the binding.
      await this.env.R2.head('.provision-sentinel').catch(() => null);
      return { ok: true };
    });

    await step.do('sanity-check-kv', async () => {
      await this.env.KV.get('.provision-sentinel');
      return { ok: true };
    });
  }
}
