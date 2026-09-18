import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireSession } from '../../platform/middleware/require-session';
import { resolveProject, type ProjectContextVars } from '../../platform/middleware/resolve-project';
import { recordAudit } from '../../platform/lib/audit';
import { serviceErrorResponse } from '../../platform/lib/service';
import { listFirmware, deleteFirmware, assignFirmware, uploadFirmware, MAX_IMAGE_BYTES } from './ota';

const admin = new Hono<{ Bindings: Env; Variables: ProjectContextVars }>();

admin.use('*', requireSession);
admin.use('*', resolveProject);

// Unlike the rest of the project routers, writes here are owner/admin: putting
// an image on a board isn't undoable from the dashboard.
admin.use('*', async (c, next) => {
  if (c.req.method === 'GET') return next();
  const role = c.get('user').role;
  if (role !== 'owner' && role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  await next();
});

admin.get('/', async (c) => {
  const project = c.get('project');
  return c.json({ firmware: await listFirmware(c.env, project.id) });
});

admin.post('/', async (c) => {
  const project = c.get('project');
  const user = c.get('user');

  // Refuse on the header rather than after buffering; the slack is multipart framing.
  const len = Number(c.req.header('content-length') ?? '0');
  if (Number.isFinite(len) && len > MAX_IMAGE_BYTES + 4096) {
    return c.json({ error: 'image_too_large', max_bytes: MAX_IMAGE_BYTES }, 413);
  }

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: 'bad_request', reason: 'invalid_form_data' }, 400);
  }

  // workers-types models a form entry as string | File-like, so narrow through unknown.
  const file = form.get('file') as unknown;
  if (!(file instanceof File)) return c.json({ error: 'bad_request', reason: 'missing_file' }, 400);
  if (file.size > MAX_IMAGE_BYTES) {
    return c.json({ error: 'image_too_large', max_bytes: MAX_IMAGE_BYTES }, 413);
  }

  const rawNotes = form.get('notes');
  try {
    const row = await uploadFirmware(c.env, project.id, user.id, {
      version: String(form.get('version') ?? ''),
      notes: typeof rawNotes === 'string' && rawNotes.trim() ? rawNotes.trim() : null,
      body: await file.arrayBuffer(),
    });
    await recordAudit(c.env, {
      projectId: project.id,
      userId: user.id,
      action: 'firmware.upload',
      targetType: 'firmware',
      targetId: row.id,
      metadata: { version: row.version, size: row.size, target: row.target },
    });
    return c.json({ firmware: row }, 201);
  } catch (e) {
    return serviceErrorResponse(c, e);
  }
});

admin.delete('/:id', async (c) => {
  const project = c.get('project');
  const id = c.req.param('id');
  try {
    await deleteFirmware(c.env, project.id, id);
    await recordAudit(c.env, {
      projectId: project.id,
      userId: c.get('user').id,
      action: 'firmware.delete',
      targetType: 'firmware',
      targetId: id,
    });
    return c.body(null, 204);
  } catch (e) {
    return serviceErrorResponse(c, e);
  }
});

admin.put('/assign/:deviceId', async (c) => {
  const project = c.get('project');
  const deviceId = c.req.param('deviceId');
  const body = await c.req.json<{ firmware_id?: string | null }>();
  try {
    await assignFirmware(c.env, project.id, deviceId, body.firmware_id ?? null);
    await recordAudit(c.env, {
      projectId: project.id,
      userId: c.get('user').id,
      action: 'firmware.assign',
      targetType: 'device',
      targetId: deviceId,
      metadata: { firmware_id: body.firmware_id ?? null },
    });
    return c.body(null, 204);
  } catch (e) {
    return serviceErrorResponse(c, e);
  }
});

export default admin;
