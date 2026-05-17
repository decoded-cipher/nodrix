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

  // Better Auth.
  BETTER_AUTH_SECRET: string;   // wrangler secret put BETTER_AUTH_SECRET
  APP_URL?: string;             // public origin; defaults to localhost in dev
}
