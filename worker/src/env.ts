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

  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
}
