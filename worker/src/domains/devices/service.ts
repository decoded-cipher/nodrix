import type { Env } from '../../env';
import { newId } from '../../platform/lib/ids';
import { ServiceError } from '../../platform/lib/service';
import { projectStub } from '../../platform/durable-objects/stubs';

// storageId is '' for the default device — the DO keys rows by it, so pre-devices
// rows need no backfill.
export type ResolvedDevice = { id: string; storageId: string };

export type DeviceSummary = {
  id: string;
  name: string;
  chip: string | null;
  firmware_version: string | null;
  is_default: number;
  first_seen: number | null;
  last_seen: number | null;
  desired_firmware_id: string | null;
  ota_status: string | null;
};

const MAX_DEVICES_PER_PROJECT = 100;
const MAX_DEVICE_KEY_LEN = 64;

const resolved = new Map<string, string>();

export function forgetCachedDevice(projectId: string, deviceKey?: string | null) {
  resolved.delete(cacheKey(projectId, deviceKey ?? null));
  if (deviceKey) return;
  for (const k of resolved.keys()) if (k.startsWith(`${projectId}:`)) resolved.delete(k);
}

function cacheKey(projectId: string, deviceKey: string | null): string {
  return `${projectId}:${deviceKey ?? ''}`;
}

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

// The migration only covers projects that already existed.
export function createDefaultDevice(env: Env, projectId: string, now: number) {
  return env.DB
    .prepare(
      `INSERT INTO devices (id, project_id, name, is_default, created_at)
       VALUES (?, ?, 'Default', 1, ?)`
    )
    .bind(newId('device'), projectId, now);
}

// Created on first sight; a board that names nothing lands on the default device.
export async function resolveDevice(
  env: Env,
  projectId: string,
  deviceKey: string | null,
  now: number
): Promise<ResolvedDevice | null> {
  if (!deviceKey) {
    const id = await defaultDeviceId(env, projectId);
    return id ? { id, storageId: '' } : null;
  }

  const cached = resolved.get(cacheKey(projectId, deviceKey));
  if (cached) return { id: cached, storageId: cached };

  const existing = await env.DB
    .prepare(`SELECT id FROM devices WHERE project_id = ? AND device_key = ?`)
    .bind(projectId, deviceKey)
    .first<{ id: string }>();
  if (existing) {
    resolved.set(cacheKey(projectId, deviceKey), existing.id);
    return { id: existing.id, storageId: existing.id };
  }

  const count = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM devices WHERE project_id = ?`)
    .bind(projectId)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_DEVICES_PER_PROJECT) {
    const id = await defaultDeviceId(env, projectId);
    return id ? { id, storageId: '' } : null;
  }

  const id = newId('device');
  await env.DB
    .prepare(
      `INSERT INTO devices (id, project_id, name, device_key, first_seen, last_seen, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, device_key) DO NOTHING`
    )
    .bind(id, projectId, deviceKey, deviceKey, now, now, now)
    .run();

  // A concurrent isolate may have won the insert, so read back the id that stuck.
  const settled = await env.DB
    .prepare(`SELECT id FROM devices WHERE project_id = ? AND device_key = ?`)
    .bind(projectId, deviceKey)
    .first<{ id: string }>();
  if (!settled) return null;
  resolved.set(cacheKey(projectId, deviceKey), settled.id);
  return { id: settled.id, storageId: settled.id };
}

// DO storage calls the default device '', so a D1 id passed straight through
// silently matches nothing. Everything crossing that boundary goes through here.
export async function storageIdOf(env: Env, projectId: string, deviceId: string): Promise<string> {
  const row = await env.DB
    .prepare(`SELECT is_default FROM devices WHERE id = ? AND project_id = ?`)
    .bind(deviceId, projectId)
    .first<{ is_default: number }>();
  return row?.is_default ? '' : deviceId;
}

export async function listDevices(env: Env, projectId: string): Promise<DeviceSummary[]> {
  const rows = await env.DB
    .prepare(
      `SELECT id, name, chip, firmware_version, is_default, first_seen, last_seen,
              desired_firmware_id, ota_status
         FROM devices WHERE project_id = ? ORDER BY is_default DESC, name ASC`
    )
    .bind(projectId)
    .all<DeviceSummary>();
  return rows.results;
}

const MAX_DEVICE_NAME_LEN = 60;

export async function renameDevice(
  env: Env,
  projectId: string,
  id: string,
  rawName: string
): Promise<DeviceSummary> {
  const name = rawName.trim().slice(0, MAX_DEVICE_NAME_LEN);
  if (!name) throw new ServiceError('bad_request', 'name is required', 'missing_name');
  const res = await env.DB
    .prepare(`UPDATE devices SET name = ? WHERE id = ? AND project_id = ?`)
    .bind(name, id, projectId)
    .run();
  if (res.meta.changes === 0) throw new ServiceError('not_found', 'no such device', 'unknown_device');
  const row = await env.DB
    .prepare(
      `SELECT id, name, chip, firmware_version, is_default, first_seen, last_seen,
              desired_firmware_id, ota_status
         FROM devices WHERE id = ?`
    )
    .bind(id)
    .first<DeviceSummary>();
  return row!;
}

// R2 history stays readable without the row — the device is named in each row.
export async function forgetDevice(env: Env, projectId: string, id: string): Promise<void> {
  const row = await env.DB
    .prepare(`SELECT is_default, device_key FROM devices WHERE id = ? AND project_id = ?`)
    .bind(id, projectId)
    .first<{ is_default: number; device_key: string | null }>();
  if (!row) throw new ServiceError('not_found', 'no such device', 'unknown_device');
  if (row.is_default) {
    throw new ServiceError('conflict', 'the default device cannot be forgotten', 'default_device');
  }

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM project_variables WHERE device_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM devices WHERE id = ? AND project_id = ?`).bind(id, projectId),
  ]);
  forgetCachedDevice(projectId, row.device_key);
  await projectStub(env, projectId).deleteDevice(id);
}

export async function recordDeviceSeen(
  env: Env,
  id: string,
  chip?: string,
  firmware?: string
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(
      `UPDATE devices
          SET last_seen = ?,
              first_seen = COALESCE(first_seen, ?),
              chip = COALESCE(?, chip),
              firmware_version = COALESCE(?, firmware_version)
        WHERE id = ?`
    )
    .bind(now, now, chip ?? null, firmware ?? null, id)
    .run();
}
