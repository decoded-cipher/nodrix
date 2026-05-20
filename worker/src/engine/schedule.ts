// Scheduling math for the SchedulerDO: compute the next fire time for schedule +
// sunset/sunrise automations, and run a planned set when due.
//
// The DO alarm fires at `computeNextScheduled().fireAt`, then runs exactly the
// `dueIds` planned for that instant — so it's robust to wake-up drift (we fire
// the ids that were due at the planned time, not whatever the clock says).

import type { Env } from '../env';
import type {
  AutomationContext,
  AutomationRow,
  ScheduleTriggerConfig,
  SolarTriggerConfig,
} from './types';
import { sunTimes } from './solar';
import { runAutomation } from './run';

export type SchedulePlan = { fireAt: number | null; dueIds: string[] };

// Soonest upcoming fire across all enabled schedule/solar automations, plus the
// ids that share that instant.
export async function computeNextScheduled(env: Env): Promise<SchedulePlan> {
  const rows = await env.DB
    .prepare(
      `SELECT id, project_id, name, enabled, trigger_type, trigger_config, actions, last_run_at
         FROM automations
        WHERE enabled = 1 AND trigger_type IN ('schedule', 'sunset_sunrise')`
    )
    .all<AutomationRow>();

  const now = Date.now();
  let best: number | null = null;
  const fireAtById = new Map<string, number>();

  for (const a of rows.results) {
    let next: number | null = null;
    try {
      next = a.trigger_type === 'schedule'
        ? nextScheduleFireAt(JSON.parse(a.trigger_config) as ScheduleTriggerConfig, now)
        : nextSolarFireAt(JSON.parse(a.trigger_config) as SolarTriggerConfig, now);
    } catch {
      next = null;
    }
    if (next == null) continue;
    fireAtById.set(a.id, next);
    if (best == null || next < best) best = next;
  }

  if (best == null) return { fireAt: null, dueIds: [] };
  const dueIds: string[] = [];
  for (const [id, t] of fireAtById) if (t - best < 1000) dueIds.push(id);
  return { fireAt: best, dueIds };
}

// Run the planned automations. `fireAtSec` dedups against last_run_at so a
// duplicate scheduler instance (or replay) can't double-fire the same instant.
export async function runScheduledByIds(env: Env, ids: string[], fireAtSec: number): Promise<number> {
  let ran = 0;
  for (const id of ids) {
    const a = await env.DB
      .prepare(
        `SELECT id, project_id, name, enabled, trigger_type, trigger_config, actions, last_run_at
           FROM automations WHERE id = ? AND enabled = 1`
      )
      .bind(id)
      .first<AutomationRow>();
    if (!a) continue;
    if (a.last_run_at != null && a.last_run_at >= fireAtSec) continue; // already fired this instant

    const ctx: AutomationContext = {
      source: a.trigger_type === 'schedule' ? 'schedule' : 'sunset_sunrise',
      projectId: a.project_id,
      ts: Math.floor(Date.now() / 1000),
      depth: 0,
    };
    try {
      await runAutomation(env, a, ctx);
      ran++;
    } catch (e) {
      console.error('[scheduler] run failed', id, e);
    }
  }
  return ran;
}

// Next 'HH:MM' (tz-local, optional weekdays) strictly after `from` (ms epoch).
export function nextScheduleFireAt(cfg: ScheduleTriggerConfig, from: number): number | null {
  if (!cfg || typeof cfg.time !== 'string' || !/^\d{1,2}:\d{2}$/.test(cfg.time)) return null;
  const parts = cfg.time.split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  const tz = cfg.tz || 'UTC';
  const days = Array.isArray(cfg.days) && cfg.days.length > 0 ? cfg.days : null;

  const base = ymdInTz(from, tz);
  for (let off = 0; off <= 14; off++) {
    const d = addDays(base, off);
    if (days && !days.includes(weekdayOf(d))) continue;
    const inst = zonedWallToUtc(d.y, d.mo, d.d, h, m, tz);
    if (inst > from) return inst;
  }
  return null;
}

// Next sunrise/sunset (+offset) strictly after `from` (ms epoch).
export function nextSolarFireAt(cfg: SolarTriggerConfig, from: number): number | null {
  if (!cfg || typeof cfg.lat !== 'number' || typeof cfg.lng !== 'number') return null;
  const offMs = (cfg.offset_minutes || 0) * 60000;
  for (let off = 0; off <= 4; off++) {
    const t = sunTimes(new Date(from + off * 86400000), cfg.lat, cfg.lng);
    const target = cfg.event === 'sunset' ? t.sunset : t.sunrise;
    if (!target) continue;
    const inst = target.getTime() + offMs;
    if (inst > from) return inst;
  }
  return null;
}

// ── timezone helpers (no external deps) ──────────────────────────────────────

type Ymd = { y: number; mo: number; d: number };

function ymdInTz(ms: number, tz: string): Ymd {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return { y: get('year'), mo: get('month'), d: get('day') };
}

function addDays(b: Ymd, n: number): Ymd {
  const dt = new Date(Date.UTC(b.y, b.mo - 1, b.d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function weekdayOf(d: Ymd): number {
  return new Date(Date.UTC(d.y, d.mo - 1, d.d)).getUTCDay(); // 0=Sun..6=Sat
}

// Wall-clock time in `tz` -> UTC epoch ms. Two passes settle the DST offset.
function zonedWallToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const wallUtc = Date.UTC(y, mo - 1, d, h, mi);
  let guess = wallUtc;
  for (let k = 0; k < 2; k++) {
    const corrected = wallUtc - tzOffsetMs(guess, tz);
    if (corrected === guess) break;
    guess = corrected;
  }
  return guess;
}

function tzOffsetMs(utcMs: number, tz: string): number {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - utcMs;
}
