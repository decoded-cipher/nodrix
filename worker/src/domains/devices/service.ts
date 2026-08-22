import type { Env } from '../../env';
import { newId } from '../../platform/lib/ids';

export type DeviceSummary = {
  id: string;
  name: string;
  chip: string | null;
  firmware_version: string | null;
  is_default: number;
  first_seen: number | null;
  last_seen: number | null;
};

// Bounds device growth from a board that reports a fresh key every boot.
const MAX_DEVICES_PER_PROJECT = 100;
const MAX_DEVICE_KEY_LEN = 64;

// Device ids change only when a device is forgotten, so an isolate can hold the
// project -> device mapping for as long as it lives.
const resolved = new Map<string, string>();

export function forgetCachedDevice(projectId: string, deviceKey?: string | null) {
  resolved.delete(cacheKey(projectId, deviceKey ?? null));
  if (deviceKey) return;
  for (const k of resolved.keys()) if (k.startsWith(`${projectId}:`)) resolved.delete(k);
}

function cacheKey(projectId: string, deviceKey: string | null): string {
  return `${projectId}:${deviceKey ?? ''}`;
}

// A board picks its own key, so it has to be treated as untrusted input.
export function normaliseDeviceKey(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_DEVICE_KEY_LEN) return null;
  return /^[A-Za-z0-9:._-]+$/.test(trimmed) ? trimmed : null;
}

export async function defaultDeviceId(env: Env, projectId: string): Promise<string | null> {
  const cached = resolved.get(cacheKey(projectId, null));
  if (cached) return cached;
  const row = await env.DB
    .prepare(`SELECT id FROM devices WHERE project_id = ? AND is_default = 1`)
    .bind(projectId)
    .first<{ id: string }>();
  if (row) resolved.set(cacheKey(projectId, null), row.id);
  return row?.id ?? null;
}

// Every project needs one, including projects created after the upgrade — a
// migration alone would only cover the ones that already existed.
export function createDefaultDevice(env: Env, projectId: string, now: number) {
  return env.DB
    .prepare(
      `INSERT INTO devices (id, project_id, name, is_default, created_at)
       VALUES (?, ?, 'Default', 1, ?)`
    )
    .bind(newId('device'), projectId, now);
}

// Maps what a board calls itself to a device row, creating it on first sight.
// An unnamed board lands on the default device.
export async function resolveDevice(
  env: Env,
  projectId: string,
  deviceKey: string | null,
  now: number
): Promise<string | null> {
  if (!deviceKey) return defaultDeviceId(env, projectId);

  const cached = resolved.get(cacheKey(projectId, deviceKey));
  if (cached) return cached;

  const existing = await env.DB
    .prepare(`SELECT id FROM devices WHERE project_id = ? AND device_key = ?`)
    .bind(projectId, deviceKey)
    .first<{ id: string }>();
  if (existing) {
    resolved.set(cacheKey(projectId, deviceKey), existing.id);
    return existing.id;
  }

  const count = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM devices WHERE project_id = ?`)
    .bind(projectId)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_DEVICES_PER_PROJECT) return defaultDeviceId(env, projectId);

  const id = newId('device');
  await env.DB
    .prepare(
      `INSERT INTO devices (id, project_id, name, device_key, first_seen, last_seen, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, device_key) DO NOTHING`
    )
    .bind(id, projectId, deviceKey, deviceKey, now, now, now)
    .run();

  // A concurrent isolate may have won the insert, so read back rather than
  // assuming the id we generated is the one that stuck.
  const settled = await env.DB
    .prepare(`SELECT id FROM devices WHERE project_id = ? AND device_key = ?`)
    .bind(projectId, deviceKey)
    .first<{ id: string }>();
  if (settled) resolved.set(cacheKey(projectId, deviceKey), settled.id);
  return settled?.id ?? null;
}

export async function listDevices(env: Env, projectId: string): Promise<DeviceSummary[]> {
  const rows = await env.DB
    .prepare(
      `SELECT id, name, chip, firmware_version, is_default, first_seen, last_seen
         FROM devices WHERE project_id = ? ORDER BY is_default DESC, name ASC`
    )
    .bind(projectId)
    .all<DeviceSummary>();
  return rows.results;
}
