import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireSession } from '../../platform/middleware/require-session';
import { getCatalog } from './service';

const firmware = new Hono<{ Bindings: Env }>();

firmware.use('*', requireSession);

// Names the editor's example picker; the sources come from raw.githubusercontent.
firmware.get('/catalog', async (c) => c.json(await getCatalog(c.env)));

export default firmware;
