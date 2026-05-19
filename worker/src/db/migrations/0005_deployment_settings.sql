-- v5: deployment_settings — generic K/V table for deployment-wide config that
-- isn't tied to a project, user, or device. First use: the custom-domain
-- canonical hostname (so we can 308-redirect the *.workers.dev URL once the
-- owner attaches a Workers Custom Domain in the Cloudflare dashboard).
--
-- Keep this generic: future entries (telemetry retention, branding, etc.)
-- slot in as new keys without further migrations.

CREATE TABLE IF NOT EXISTS deployment_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
