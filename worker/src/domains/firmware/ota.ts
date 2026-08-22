import type { Env } from '../../env';
import { newId } from '../../platform/lib/ids';
import { ServiceError } from '../../platform/lib/service';
import { projectStub } from '../../platform/durable-objects/stubs';
import { storageIdOf } from '../devices/service';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const KEEP_VERSIONS = 10;
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

export type FirmwareRow = {
  id: string;
  version: string;
  target: string | null;
  size: number;
  sha256: string;
  notes: string | null;
  created_at: number;
};

function r2Key(projectId: string, firmwareId: string): string {
  return `firmware/${projectId}/${firmwareId}.bin`;
}

export async function uploadFirmware(
  env: Env,
  projectId: string,
  userId: string,
  input: { version: string; target?: string | null; notes?: string | null; body: ArrayBuffer }
): Promise<FirmwareRow> {
  const version = input.version.trim();
  if (!SAFE_VERSION.test(version)) {
    throw new ServiceError('bad_request', 'version must be alphanumeric', 'invalid_version');
  }
  if (input.body.byteLength === 0) {
    throw new ServiceError('bad_request', 'image is empty', 'empty_image');
  }
  if (input.body.byteLength > MAX_IMAGE_BYTES) {
    throw new ServiceError('bad_request', 'image is too large', 'image_too_large');
  }

  const digest = await crypto.subtle.digest('SHA-256', input.body);
  const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');

  const id = newId('firmware');
  const key = r2Key(projectId, id);
  const now = Math.floor(Date.now() / 1000);

  await env.R2.put(key, input.body, { httpMetadata: { contentType: 'application/octet-stream' } });
  try {
    await env.DB
      .prepare(
        `INSERT INTO firmware (id, project_id, version, target, size, sha256, r2_key, notes, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, projectId, version, input.target ?? null, input.body.byteLength, sha256, key, input.notes ?? null, userId, now)
      .run();
  } catch {
    // Don't leave an image in R2 that no row points at.
    await env.R2.delete(key).catch(() => {});
    throw new ServiceError('conflict', 'that version already exists', 'duplicate_version');
  }

  await prune(env, projectId).catch(() => {});
  return { id, version, target: input.target ?? null, size: input.body.byteLength, sha256, notes: input.notes ?? null, created_at: now };
}

// Spares anything a device runs or is waiting to run; deleting those strands a
// pending update or loses the image a board is on.
async function prune(env: Env, projectId: string): Promise<void> {
  const stale = await env.DB
    .prepare(
      `SELECT id, r2_key FROM firmware
        WHERE project_id = ?
          AND id NOT IN (SELECT id FROM firmware WHERE project_id = ? ORDER BY created_at DESC LIMIT ?)
          AND id NOT IN (SELECT desired_firmware_id FROM devices
                          WHERE project_id = ? AND desired_firmware_id IS NOT NULL)
          AND version NOT IN (SELECT firmware_version FROM devices
                               WHERE project_id = ? AND firmware_version IS NOT NULL)`
    )
    .bind(projectId, projectId, KEEP_VERSIONS, projectId, projectId)
    .all<{ id: string; r2_key: string }>();
  if (stale.results.length === 0) return;

  await env.DB.batch(
    stale.results.map((r) => env.DB.prepare(`DELETE FROM firmware WHERE id = ?`).bind(r.id))
  );
  await env.R2.delete(stale.results.map((r) => r.r2_key)).catch(() => {});
}

export async function listFirmware(env: Env, projectId: string): Promise<FirmwareRow[]> {
  const rows = await env.DB
    .prepare(
      `SELECT id, version, target, size, sha256, notes, created_at
         FROM firmware WHERE project_id = ? ORDER BY created_at DESC`
    )
    .bind(projectId)
    .all<FirmwareRow>();
  return rows.results;
}

export async function deleteFirmware(env: Env, projectId: string, id: string): Promise<void> {
  const row = await env.DB
    .prepare(`SELECT r2_key FROM firmware WHERE id = ? AND project_id = ?`)
    .bind(id, projectId)
    .first<{ r2_key: string }>();
  if (!row) throw new ServiceError('not_found', 'no such firmware', 'unknown_firmware');
  await env.DB.prepare(`DELETE FROM firmware WHERE id = ? AND project_id = ?`).bind(id, projectId).run();
  await env.R2.delete(row.r2_key).catch(() => {});
}

// Setting desired state is the whole of starting an update.
export async function assignFirmware(
  env: Env,
  projectId: string,
  deviceId: string,
  firmwareId: string | null
): Promise<void> {
  if (firmwareId) {
    const fw = await env.DB
      .prepare(`SELECT 1 AS ok FROM firmware WHERE id = ? AND project_id = ?`)
      .bind(firmwareId, projectId)
      .first<{ ok: number }>();
    if (!fw) throw new ServiceError('not_found', 'no such firmware', 'unknown_firmware');
  }
  const res = await env.DB
    .prepare(
      `UPDATE devices SET desired_firmware_id = ?, ota_status = ?, ota_updated_at = ?
        WHERE id = ? AND project_id = ?`
    )
    .bind(firmwareId, firmwareId ? 'pending' : null, Math.floor(Date.now() / 1000), deviceId, projectId)
    .run();
  if (res.meta.changes === 0) throw new ServiceError('not_found', 'no such device', 'unknown_device');

  // Best-effort — the board would find it at its next poll anyway.
  if (firmwareId) {
    const storageId = await storageIdOf(env, projectId, deviceId);
    await projectStub(env, projectId).notifyOta(storageId).catch(() => {});
  }
}

export type UpdateOffer = { version: string; size: number; sha256: string; url: string } | null;

// Reported vs desired is the whole reconciliation; there is no job to track.
export async function offerFor(env: Env, projectId: string, deviceId: string): Promise<UpdateOffer> {
  const row = await env.DB
    .prepare(
      `SELECT f.version AS version, f.size AS size, f.sha256 AS sha256, d.firmware_version AS current
         FROM devices d JOIN firmware f ON f.id = d.desired_firmware_id
        WHERE d.id = ? AND d.project_id = ?`
    )
    .bind(deviceId, projectId)
    .first<{ version: string; size: number; sha256: string; current: string | null }>();
  if (!row || row.current === row.version) return null;
  return { version: row.version, size: row.size, sha256: row.sha256, url: '/v1/ota/image' };
}

export async function openImage(env: Env, projectId: string, deviceId: string): Promise<R2ObjectBody | null> {
  const row = await env.DB
    .prepare(
      `SELECT f.r2_key AS r2_key FROM devices d JOIN firmware f ON f.id = d.desired_firmware_id
        WHERE d.id = ? AND d.project_id = ?`
    )
    .bind(deviceId, projectId)
    .first<{ r2_key: string }>();
  if (!row) return null;
  return env.R2.get(row.r2_key);
}

// Only the board knows it booted, so reporting the version is the success signal.
export async function reconcile(env: Env, deviceId: string, reported: string | null): Promise<void> {
  if (!reported) return;
  await env.DB
    .prepare(
      `UPDATE devices
          SET ota_status = CASE
                WHEN desired_firmware_id IS NULL THEN NULL
                WHEN ? = (SELECT version FROM firmware WHERE id = desired_firmware_id) THEN 'ok'
                ELSE ota_status END,
              ota_updated_at = ?
        WHERE id = ?`
    )
    .bind(reported, Math.floor(Date.now() / 1000), deviceId)
    .run();
}
