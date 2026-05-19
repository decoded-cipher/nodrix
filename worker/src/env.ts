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

  // Better Auth signing secret. Set as a Workers Secret (KMS-encrypted) —
  // never a plaintext var. baseURL is derived from each request's origin so
  // there's no APP_URL to configure.
  BETTER_AUTH_SECRET: string;

  // Upstream repo (owner/repo) the Settings → Version & updates page polls
  // to detect new commits. Plaintext var defaulted in wrangler.toml.
  NODRIX_UPSTREAM_REPO?: string;
}
