import type {
  D1Database,
  R2Bucket,
  KVNamespace,
  DurableObjectNamespace,
  Fetcher,
  Workflow,
} from '@cloudflare/workers-types';

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  KV: KVNamespace;
  ASSETS: Fetcher;
  PROJECT_DO: DurableObjectNamespace;
  DASHBOARD_DO: DurableObjectNamespace;
  // Singleton scheduler DO: one alarm set to the next schedule/sunset automation
  // fire time. Re-armed when automations change. Replaces the every-minute cron.
  SCHEDULER_DO: DurableObjectNamespace;
  PROVISION: Workflow;

  // Upstream repo (owner/repo) the Settings → Version & updates page polls
  // to detect new commits. Plaintext var defaulted in wrangler.toml.
  NODRIX_UPSTREAM_REPO?: string;
}
