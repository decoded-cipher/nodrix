import { Hono } from 'hono';
import type { Env } from '../env';
import { requireAccess } from '../middleware/require-access';
import { resolveUser } from '../middleware/resolve-user';
import { resolveProject, type ProjectContextVars } from '../middleware/resolve-project';
import { newId, newToken, sha256Hex } from '../lib/ids';
import type { DeviceDO } from '../do/device-do';

const devices = new Hono<{ Bindings: Env; Variables: ProjectContextVars }>();

devices.use('*', requireAccess);
devices.use('*', resolveUser);
devices.use('*', resolveProject);

// GET /v1/admin/projects/:proj/devices
devices.get('/', async (c) => {
  const project = c.get('project');
  const rows = await c.env.DB
    .prepare(`SELECT id, name, created_at, last_seen FROM devices WHERE project_id = ? ORDER BY created_at ASC`)
    .bind(project.id)
    .all<{ id: string; name: string; created_at: number; last_seen: number | null }>();
  return c.json({ devices: rows.results });
});

// POST /v1/admin/projects/:proj/devices  body: { name }
// Returns { id, name, token } ONCE — token is never stored plaintext.
devices.post('/', async (c) => {
  const body = await c.req.json<{ name?: string }>();
  const name = (body.name ?? '').trim();
  if (!name) return c.json({ error: 'bad_request', reason: 'missing_name' }, 400);

  const project = c.get('project');
  const deviceId = newId('device');
  const tokenId = newId('token');
  const token = newToken();
  const hash = await sha256Hex(token);
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.batch([
    c.env.DB
      .prepare(`INSERT INTO devices (id, project_id, name, created_at) VALUES (?, ?, ?, ?)`)
      .bind(deviceId, project.id, name, now),
    c.env.DB
      .prepare(
        `INSERT INTO device_tokens (id, device_id, hash, created_at) VALUES (?, ?, ?, ?)`
      )
      .bind(tokenId, deviceId, hash, now),
  ]);

  return c.json({ id: deviceId, name, created_at: now, token }, 201);
});

// DELETE /v1/admin/projects/:proj/devices/:id
// Cascade: DO storage (latest_state, ring buffer, pending commands) and R2
// telemetry history are also removed. Best-effort — if the DO destroy throws,
// the metadata is still deleted (orphaned data is wastage, not a security issue).
devices.delete('/:id', async (c) => {
  const project = c.get('project');
  const deviceId = c.req.param('id');

  const dev = await c.env.DB
    .prepare(`SELECT id FROM devices WHERE id = ? AND project_id = ?`)
    .bind(deviceId, project.id)
    .first<{ id: string }>();
  if (!dev) return c.json({ error: 'not_found' }, 404);

  try {
    const stub = c.env.DEVICE_DO.get(c.env.DEVICE_DO.idFromName(deviceId)) as unknown as DeviceDO;
    await stub.destroy();
  } catch (e) {
    console.error('device destroy failed', deviceId, e);
  }

  await c.env.DB
    .prepare(`DELETE FROM devices WHERE id = ? AND project_id = ?`)
    .bind(deviceId, project.id)
    .run();

  return c.body(null, 204);
});

// POST /v1/admin/projects/:proj/devices/:id/flush  -> { flushed, keys, newCursor }
// Forces the Device DO alarm to run now. Handy for smoke tests + ops; nothing
// on the hot path depends on this.
devices.post('/:id/flush', async (c) => {
  const project = c.get('project');
  const deviceId = c.req.param('id');
  const dev = await c.env.DB
    .prepare(`SELECT id FROM devices WHERE id = ? AND project_id = ?`)
    .bind(deviceId, project.id)
    .first<{ id: string }>();
  if (!dev) return c.json({ error: 'not_found' }, 404);

  const stub = c.env.DEVICE_DO.get(c.env.DEVICE_DO.idFromName(deviceId)) as unknown as DeviceDO;
  const result = await stub.flushNow();
  return c.json(result);
});

// POST /v1/admin/projects/:proj/devices/:id/command  body: { name, value }
// Convenience for testing the command path without spinning up a dashboard.
devices.post('/:id/command', async (c) => {
  const project = c.get('project');
  const deviceId = c.req.param('id');
  const body = await c.req.json<{ name?: string; value?: unknown }>();
  const name = (body.name ?? '').trim();
  if (!name) return c.json({ error: 'bad_request', reason: 'missing_name' }, 400);

  // Confirm device belongs to project
  const dev = await c.env.DB
    .prepare(`SELECT id FROM devices WHERE id = ? AND project_id = ?`)
    .bind(deviceId, project.id)
    .first<{ id: string }>();
  if (!dev) return c.json({ error: 'not_found' }, 404);

  const cmdId = newId('command');
  const stub = c.env.DEVICE_DO.get(c.env.DEVICE_DO.idFromName(deviceId)) as unknown as DeviceDO;
  await stub.addCommand(cmdId, name, body.value ?? null);

  return c.json({ id: cmdId, name, value: body.value ?? null }, 201);
});

export default devices;
