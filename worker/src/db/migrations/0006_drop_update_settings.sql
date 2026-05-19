-- v6: drop the deployment_settings rows that backed the now-removed
-- one-click-update flow (CF API token, account_id, build status, onboarding
-- dismiss timestamp). The deployment_settings table itself stays — it's
-- generic K/V used for other deployment-wide config.
--
-- Safe to run on deployments that never had these keys: DELETE is a no-op.

DELETE FROM deployment_settings WHERE key IN (
  'cf.api_token_enc',
  'cf.account_id',
  'cf.account_name',
  'cf.script_name',
  'cf.last_build_id',
  'onboarding.dismissed_at'
);
