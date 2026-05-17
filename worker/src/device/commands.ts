import { Hono } from 'hono';
import type { Env } from '../env';
import { requireDevice, type DeviceContextVars } from '../middleware/require-device';
import type { DeviceDO } from '../do/device-do';

const commands = new Hono<{ Bindings: Env; Variables: DeviceContextVars }>();

commands.use('*', requireDevice);

// GET /v1/commands  -> { commands: [{ id, name, value }, ...] }
commands.get('/', async (c) => {
  const device = c.get('device');
  const stub = c.env.DEVICE_DO.get(c.env.DEVICE_DO.idFromName(device.id)) as unknown as DeviceDO;
  const pending = await stub.listPendingCommands();
  return c.json({ commands: pending });
});

// POST /v1/commands/ack  body: { ids: string[] }  -> { acked: number }
commands.post('/ack', async (c) => {
  const body = await c.req.json<{ ids?: string[] }>();
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === 'string') : [];
  if (ids.length === 0) return c.json({ acked: 0 });

  const device = c.get('device');
  const stub = c.env.DEVICE_DO.get(c.env.DEVICE_DO.idFromName(device.id)) as unknown as DeviceDO;
  const result = await stub.ackCommands(ids);
  return c.json(result);
});

export default commands;
