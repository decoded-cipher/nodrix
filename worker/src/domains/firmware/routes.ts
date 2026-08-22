import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireSession } from '../../platform/middleware/require-session';
import { getCatalog, fetchBinary } from './service';

const firmware = new Hono<{ Bindings: Env }>();

firmware.use('*', requireSession);

firmware.get('/catalog', async (c) => c.json(await getCatalog(c.env)));

firmware.get('/binary/:tag/:file', async (c) => {
  const res = await fetchBinary(c.req.param('tag'), c.req.param('file'));
  if (!res) return c.json({ error: 'not_found' }, 404);
  return new Response(res.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600',
    },
  });
});

export default firmware;
