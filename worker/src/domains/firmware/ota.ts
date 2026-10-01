import type { Env } from '../../env';
import { newId } from '../../platform/lib/ids';
import { ServiceError } from '../../platform/lib/service';
import { projectStub } from '../../platform/durable-objects/stubs';
import { storageIdOf } from '../devices/service';
import { inspectImage } from './image';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
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

async function hexDigest(algorithm: 'SHA-256' | 'MD5', body: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest(algorithm, body);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function chipFamily(chip: string | null | undefined): string | null {
  if (!chip) return null;
  const c = chip.toLowerCase();
  const m = c.match(/^esp32-(s2|s3|c2|c3|c5|c6|h2|p4)/);
  if (m) return `esp32-${m[1]}`;
  if (c.startsWith('esp32')) return 'esp32';
  if (c.startsWith('esp8266')) return 'esp8266';
  return null;
}

// The version is the only handle the board reports back, so it has to match what
// the sketch passes to setFirmwareVersion() — see reconcile().
export async function uploadFirmware(
  env: Env,
  projectId: string,
  userId: string,
  input: { version: string; notes: string | null; body: ArrayBuffer }
): Promise<FirmwareRow> {
  const version = input.version.trim();
  if (!version) throw new ServiceError('bad_request', 'a version is required', 'missing_version');
  if (!SAFE_VERSION.test(version)) {
    throw new ServiceError(
      'bad_request',
      'a version is letters, digits, dot, underscore, plus or dash, up to 64 characters',
      'invalid_version'
    );
  }
  if (input.body.byteLength === 0) throw new ServiceError('bad_request', 'the image is empty', 'empty_image');
  if (input.body.byteLength > MAX_IMAGE_BYTES) {
    throw new ServiceError('bad_request', 'the image is too large', 'image_too_large');
  }

  const check = inspectImage(input.body);
  if (!check.ok) throw new ServiceError('bad_request', check.reason, check.code);

  const sha256 = await hexDigest('SHA-256', input.body);
  // x-MD5 is checked on every core; x-SHA256 only from arduino-esp32 3.3.12.
  const md5 = await hexDigest('MD5', input.body);

  const id = newId('firmware');
  const key = r2Key(projectId, id);
  const now = Math.floor(Date.now() / 1000);

  await env.R2.put(key, input.body, {
    httpMetadata: { contentType: 'application/octet-stream' },
    customMetadata: { md5 },
  });
  try {
    await env.DB
      .prepare(
        `INSERT INTO firmware (id, project_id, version, target, size, sha256, r2_key, notes, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, projectId, version, check.chip, input.body.byteLength, sha256, key, input.notes, userId, now)
      .run();
  } catch {
    await env.R2.delete(key).catch(() => {});
    throw new ServiceError('conflict', `version ${version} already exists`, 'duplicate_version');
  }

  await prune(env, projectId).catch(() => {});
  return {
    id,
    version,
    target: check.chip,
    size: input.body.byteLength,
    sha256,
    notes: input.notes,
    created_at: now,
  };
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
  const device = await env.DB
    .prepare(`SELECT chip, firmware_version FROM devices WHERE id = ? AND project_id = ?`)
    .bind(deviceId, projectId)
    .first<{ chip: string | null; firmware_version: string | null }>();
  if (!device) throw new ServiceError('not_found', 'no such device', 'unknown_device');

  let status: string | null = null;
  if (firmwareId) {
    const fw = await env.DB
      .prepare(`SELECT version, target FROM firmware WHERE id = ? AND project_id = ?`)
      .bind(firmwareId, projectId)
      .first<{ version: string; target: string | null }>();
    if (!fw) throw new ServiceError('not_found', 'no such firmware', 'unknown_firmware');
    const board = chipFamily(device.chip);
    if (fw.target && board && fw.target !== board) {
      throw new ServiceError(
        'bad_request',
        `that firmware is built for ${fw.target}, but this board is ${board}`,
        'wrong_chip'
      );
    }
    status = fw.version === device.firmware_version ? 'ok' : 'pending';
  }

  // Assigning is also the retry: a device parked at 'failed' starts over.
  await env.DB
    .prepare(
      `UPDATE devices SET desired_firmware_id = ?, ota_status = ?, ota_updated_at = ?, ota_attempts = 0
        WHERE id = ? AND project_id = ?`
    )
    .bind(firmwareId, status, Math.floor(Date.now() / 1000), deviceId, projectId)
    .run();

  // Best-effort — the board would find it at its next poll anyway.
  if (status === 'pending') {
    const storageId = await storageIdOf(env, projectId, deviceId);
    await projectStub(env, projectId).notifyOta(storageId).catch(() => {});
  }
}

export type UpdateOffer = { version: string; size: number; sha256: string; url: string } | null;

export const MAX_OTA_ATTEMPTS = 3;

// Reported vs desired is the whole reconciliation; there is no job to track.
// A version the board claims in this request beats the stored one, which may not
// have caught up with the update it just applied.
export async function offerFor(
  env: Env,
  projectId: string,
  deviceId: string,
  reported?: string | null
): Promise<UpdateOffer> {
  const row = await env.DB
    .prepare(
      `SELECT f.version AS version, f.size AS size, f.sha256 AS sha256,
              d.firmware_version AS current, d.ota_status AS status
         FROM devices d JOIN firmware f ON f.id = d.desired_firmware_id
        WHERE d.id = ? AND d.project_id = ?`
    )
    .bind(deviceId, projectId)
    .first<{ version: string; size: number; sha256: string; current: string | null; status: string | null }>();
  if (!row || (reported ?? row.current) === row.version) return null;
  if (row.status === 'failed') return null;
  return { version: row.version, size: row.size, sha256: row.sha256, url: '/v1/ota/image' };
}

export async function recordOtaAttempt(env: Env, deviceId: string): Promise<void> {
  await env.DB
    .prepare(`UPDATE devices SET ota_attempts = ota_attempts + 1 WHERE id = ?`)
    .bind(deviceId)
    .run();
}

export async function openImage(
  env: Env,
  projectId: string,
  deviceId: string
): Promise<{ object: R2ObjectBody; sha256: string; md5: string | null } | null> {
  const row = await env.DB
    .prepare(
      `SELECT f.r2_key AS r2_key, f.sha256 AS sha256 FROM devices d JOIN firmware f ON f.id = d.desired_firmware_id
        WHERE d.id = ? AND d.project_id = ?`
    )
    .bind(deviceId, projectId)
    .first<{ r2_key: string; sha256: string }>();
  if (!row) return null;
  const object = await env.R2.get(row.r2_key);
  if (!object) return null;
  return { object, sha256: row.sha256, md5: object.customMetadata?.md5 ?? null };
}

// HTTPUpdate errors a retry can't fix. -108 means different things on ESP32 and ESP8266.
const TERMINAL_OTA_CODES = new Set([-100, -105, -106, -107, -109, -110]);

export type OtaReport = { state: 'failed' | 'rolled_back'; version?: string; code?: number };

export function isTerminal(report: OtaReport, desiredVersion: string): boolean {
  if (report.state === 'rolled_back') return report.version === desiredVersion;
  return typeof report.code === 'number' && TERMINAL_OTA_CODES.has(report.code);
}

export async function recordOtaReport(env: Env, deviceId: string, report: OtaReport): Promise<void> {
  const row = await env.DB
    .prepare(
      `SELECT f.version AS version FROM devices d JOIN firmware f ON f.id = d.desired_firmware_id
        WHERE d.id = ? AND d.ota_status = 'pending'`
    )
    .bind(deviceId)
    .first<{ version: string }>();
  if (!row || !isTerminal(report, row.version)) return;
  await env.DB
    .prepare(`UPDATE devices SET ota_status = 'failed', ota_updated_at = ? WHERE id = ?`)
    .bind(Math.floor(Date.now() / 1000), deviceId)
    .run();
}

// Only the board knows it booted, so reporting the version is the success signal.
// Reporting something else after MAX_OTA_ATTEMPTS pulls means the update isn't
// landing — usually the sketch's version doesn't match the one on the upload.
export async function reconcile(env: Env, deviceId: string, reported: string | null): Promise<void> {
  if (!reported) return;
  await env.DB
    .prepare(
      `UPDATE devices
          SET ota_status = CASE
                WHEN desired_firmware_id IS NULL THEN NULL
                WHEN ? = (SELECT version FROM firmware WHERE id = desired_firmware_id) THEN 'ok'
                WHEN ota_attempts >= ? THEN 'failed'
                ELSE ota_status END,
              ota_attempts = CASE
                WHEN ? = (SELECT version FROM firmware WHERE id = desired_firmware_id) THEN 0
                ELSE ota_attempts END,
              ota_updated_at = ?
        WHERE id = ?`
    )
    .bind(reported, MAX_OTA_ATTEMPTS, reported, Math.floor(Date.now() / 1000), deviceId)
    .run();
}
