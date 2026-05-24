import { Hono } from 'hono';
import type { Env } from '../env';
import { requireSession, type UserContextVars } from '../middleware/require-session';
import { getSetting, setSetting } from '../lib/deployment-settings';
import { AUDIT_ENABLED_KEY, recordAudit } from '../lib/audit';

// Deployment-wide settings — owner only. Currently just the audit-log toggle.

const settings = new Hono<{ Bindings: Env; Variables: UserContextVars }>();

settings.use('*', requireSession);
settings.use('*', async (c, next) => {
  if (c.get('user').role !== 'owner') return c.json({ error: 'forbidden', reason: 'owner_only' }, 403);
  await next();
});

// GET /v1/admin/settings
settings.get('/', async (c) => {
  const auditEnabled = (await getSetting(c.env, AUDIT_ENABLED_KEY)) === '1';
  return c.json({ audit_log_enabled: auditEnabled });
});

// PUT /v1/admin/settings/audit-log  body: { enabled: boolean }
// Enabling starts recording every action (user + system). Disabling stops
// recording AND wipes all existing entries — "stop and forget".
settings.put('/audit-log', async (c) => {
  const actor = c.get('user');
  const body = await c.req.json<{ enabled?: boolean }>();
  const enabled = body.enabled === true;

  await setSetting(c.env, AUDIT_ENABLED_KEY, enabled ? '1' : null);

  if (enabled) {
    // setSetting busted the KV cache, so recordAudit now sees the flag as on —
    // make the enable itself the first entry of the fresh log.
    await recordAudit(c.env, {
      projectId: null,
      userId: actor.id,
      action: 'audit_log.enable',
      targetType: 'deployment',
    });
  } else {
    await c.env.DB.prepare(`DELETE FROM audit_log`).run();
  }

  return c.json({ audit_log_enabled: enabled });
});

export default settings;
