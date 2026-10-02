import type { Env } from '../../env';

// A project as NDJSON, one typed record per line. Streamed: a year of history is
// larger than anything that should sit in memory. Carries no secrets — token
// hashes, sealed integration config and share tokens are all omitted.

type Row = Record<string, unknown>;

function line(type: string, data: Row): string {
  return `${JSON.stringify({ type, ...data })}\n`;
}

async function* records(env: Env, projectId: string): AsyncGenerator<string> {
  const project = await env.DB
    .prepare(`SELECT id, name, description, created_at, updated_at FROM projects WHERE id = ?`)
    .bind(projectId)
    .first<Row>();
  if (!project) return;

  yield line('project', { exported_at: Math.floor(Date.now() / 1000), project });

  const tables: Array<[string, string]> = [
    ['device', `SELECT id, name, device_key, chip, firmware_version, is_default, first_seen, last_seen, created_at
                  FROM devices WHERE project_id = ?`],
    ['variable', `SELECT id, device_id, key, unit, created_at, updated_at, last_seen
                    FROM project_variables WHERE project_id = ?`],
    ['dashboard', `SELECT id, name, description, layout, visibility, created_at, updated_at
                     FROM dashboards WHERE project_id = ?`],
    ['automation', `SELECT id, name, description, enabled, trigger_type, graph, created_at, updated_at
                      FROM automations WHERE project_id = ?`],
    ['integration', `SELECT id, name, kind, enabled, created_at, updated_at
                       FROM integrations WHERE project_id = ?`],
    ['firmware', `SELECT id, version, target, size, sha256, notes, created_at
                    FROM firmware WHERE project_id = ?`],
  ];

  for (const [type, sql] of tables) {
    const rows = await env.DB.prepare(sql).bind(projectId).all<Row>();
    for (const row of rows.results) yield line(type, row);
  }

  // Already NDJSON in R2; re-tagged so the whole file reads uniformly.
  let cursor: string | undefined;
  do {
    const list = await env.R2.list({ prefix: `telemetry/${projectId}/`, ...(cursor ? { cursor } : {}) });
    for (const object of list.objects) {
      const body = await env.R2.get(object.key);
      if (!body) continue;
      const text = await body.text();
      for (const raw of text.split('\n')) {
        if (!raw.trim()) continue;
        try {
          yield line('telemetry', JSON.parse(raw) as Row);
        } catch { /* a truncated line beats aborting the export */ }
      }
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
}

export function exportProject(env: Env, projectId: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = records(env, projectId);
  return new ReadableStream({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) controller.close();
      else controller.enqueue(encoder.encode(next.value));
    },
    cancel() {
      void iterator.return(undefined);
    },
  });
}
