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
  DEVICE_DO: DurableObjectNamespace;
  DASHBOARD_DO: DurableObjectNamespace;
  PROVISION: Workflow;

  // Legacy: the signing secret is now auto-generated on first boot and
  // stored in deployment_settings (see lib/auth-secret.ts). Still honored
  // when present so existing deployments upgrade without invalidating live
  // sessions — once seeded into D1, the env var can be removed.
  BETTER_AUTH_SECRET?: string;

  // Upstream repo (owner/repo) the Settings → Version & updates page polls
  // to detect new commits. Plaintext var defaulted in wrangler.toml.
  NODRIX_UPSTREAM_REPO?: string;
}
