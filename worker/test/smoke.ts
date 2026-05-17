// Smoke test for the §11 loop end-to-end. Runs against `wrangler dev`.
//
// Usage:
//   # terminal 1
//   cd worker && bun run dev
//   # terminal 2
//   bun run worker/test/smoke.ts
//
// Defaults: BASE_URL=http://localhost:8787, DEV_EMAIL=smoke@example.com.

const BASE = process.env['BASE_URL'] ?? 'http://localhost:8787';
const DEV_EMAIL = process.env['DEV_EMAIL'] ?? 'smoke@example.com';
const RUN_ID = Date.now().toString(36);

type Json = Record<string, unknown> | unknown[];

async function req<T = unknown>(
  method: string,
  path: string,
  opts: { body?: Json; bearer?: string } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-dev-email': DEV_EMAIL,
  };
  if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('PASS:', msg);
}

async function main() {
  console.log(`Running smoke against ${BASE} as ${DEV_EMAIL} (run_id=${RUN_ID})`);

  // 1. Bootstrap (or noop if user exists).
  const me = await req<{
    user: { id: string; email: string };
    projects: Array<{ id: string; name: string }>;
  }>('GET', '/v1/admin/me');
  assert(me.user.email === DEV_EMAIL, `/me returned email=${me.user.email}`);
  assert(me.projects.length >= 1, `/me returned at least one project`);

  // 2. Create a smoke-run-specific project so re-runs don't collide.
  const proj = await req<{ id: string; name: string }>('POST', '/v1/admin/projects', {
    body: { name: `smoke-${RUN_ID}` },
  });
  assert(proj.id.startsWith('prj_'), `project id has prj_ prefix: ${proj.id}`);

  // 3. Create a device.
  const dev = await req<{ id: string; name: string; token: string }>(
    'POST',
    `/v1/admin/projects/${proj.id}/devices`,
    { body: { name: 'sensor-1' } }
  );
  assert(dev.token.length > 20, `device token issued (${dev.token.length} chars)`);

  // 4. POST telemetry as the device.
  const telRes = await fetch(`${BASE}/v1/telemetry`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${dev.token}`,
    },
    body: JSON.stringify({ ts: Math.floor(Date.now() / 1000), metrics: { temperature: 22.5 } }),
  });
  assert(telRes.status === 204, `telemetry returned 204 (got ${telRes.status})`);

  // 5. Mint a read token for the public API.
  const tok = await req<{ id: string; token: string }>('POST', '/v1/admin/tokens', {
    body: { scope: 'read', project_id: proj.id },
  });
  assert(tok.token.length > 20, `read token issued`);

  // 6. Read state via public API.
  const state = await req<{ state: Record<string, { value: unknown }> }>(
    'GET',
    `/v1/projects/${proj.id}/devices/${dev.id}/state`,
    { bearer: tok.token }
  );
  assert(state.state['temperature']?.value === 22.5, `state echoed temperature=22.5`);

  // 7. Create a dashboard with two widgets pointing at the device.
  const layout = {
    grid: { columns: 12 },
    items: [
      {
        id: 'w_value',
        x: 0,
        y: 0,
        w: 3,
        h: 2,
        type: 'iot-value',
        props: { title: 'Temp', device: dev.id, metric: 'temperature', unit: '°C' },
      },
      {
        id: 'w_chart',
        x: 3,
        y: 0,
        w: 6,
        h: 3,
        type: 'iot-chart',
        props: {
          title: 'Trend',
          window: '1h',
          series: [{ device: dev.id, metric: 'temperature', label: 'sensor-1' }],
        },
      },
    ],
  };
  const dash = await req<{ id: string; updated_at: number }>(
    'POST',
    `/v1/admin/projects/${proj.id}/dashboards`,
    { body: { name: 'smoke-dash', layout } }
  );

  // 8. Open WebSocket and assert snapshot arrives.
  const wsUrl = `${BASE.replace(/^http/, 'ws')}/ws/${dash.id}?dev_email=${encodeURIComponent(DEV_EMAIL)}`;
  const ws = new WebSocket(wsUrl);

  const snapshot = await waitForMessage(ws, (m) => m.type === 'snapshot', 5000);
  assert(snapshot.dashboard === dash.id, `snapshot dashboard matches`);
  // @ts-expect-error narrowed by predicate
  assert(snapshot.devices[dev.id]?.state.temperature?.value === 22.5, `snapshot includes latest temperature`);

  // 9. Post another telemetry reading and assert update arrives over WS.
  await fetch(`${BASE}/v1/telemetry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${dev.token}` },
    body: JSON.stringify({ metrics: { temperature: 23.7 } }),
  });
  const update = await waitForMessage(
    ws,
    (m) => m.type === 'update' && m.device === dev.id && m.metric === 'temperature' && m.value === 23.7,
    5000
  );
  assert(update.type === 'update', `update message received`);

  // 10. Send command via WS, poll as device, ack, re-poll empty.
  ws.send(JSON.stringify({ type: 'command', req: 'r1', device: dev.id, name: 'relay', value: 'on' }));
  const ack = await waitForMessage(ws, (m) => m.type === 'ack' && m.req === 'r1', 5000);
  assert(ack.type === 'ack' && ack.ok === true, `command ack ok`);

  const pollRes = await fetch(`${BASE}/v1/commands`, {
    headers: { authorization: `Bearer ${dev.token}` },
  });
  const pollBody = (await pollRes.json()) as { commands: Array<{ id: string; name: string; value: unknown }> };
  assert(
    pollBody.commands.some((c) => c.name === 'relay' && c.value === 'on'),
    `device sees pending command relay=on`
  );
  const cmdIds = pollBody.commands.map((c) => c.id);

  const ackRes = await fetch(`${BASE}/v1/commands/ack`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${dev.token}` },
    body: JSON.stringify({ ids: cmdIds }),
  });
  const ackBody = (await ackRes.json()) as { acked: number };
  assert(ackBody.acked === cmdIds.length, `device acks ${cmdIds.length} commands`);

  const repollRes = await fetch(`${BASE}/v1/commands`, {
    headers: { authorization: `Bearer ${dev.token}` },
  });
  const repollBody = (await repollRes.json()) as { commands: unknown[] };
  assert(repollBody.commands.length === 0, `re-poll returns no pending commands`);

  // 11. Force the alarm flush; assert keys + cursor advanced.
  const flushRes = await req<{ flushed: number; keys: string[]; newCursor: number }>(
    'POST',
    `/v1/admin/projects/${proj.id}/devices/${dev.id}/flush`
  );
  assert(flushRes.flushed >= 2, `flush wrote at least 2 points (got ${flushRes.flushed})`);
  assert(flushRes.keys.length >= 1, `flush produced at least 1 R2 key`);
  assert(flushRes.keys[0]!.startsWith(`telemetry/${dev.id}/`), `R2 key partitioned by device id`);

  ws.close();

  console.log('\nALL CHECKS PASSED.');
}

function waitForMessage<T = { type: string } & Record<string, unknown>>(
  ws: WebSocket,
  match: (m: any) => boolean,
  timeoutMs: number
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for WS message')), timeoutMs);
    const onMsg = (e: MessageEvent) => {
      try {
        const m = JSON.parse(typeof e.data === 'string' ? e.data : '');
        if (match(m)) {
          clearTimeout(timer);
          ws.removeEventListener('message', onMsg);
          resolve(m as T);
        }
      } catch {}
    };
    ws.addEventListener('message', onMsg);
  });
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e);
  process.exit(1);
});
