// Scheduling math for the SchedulerDO: compute the next fire time for schedule +
// sunset/sunrise automations, and run a planned set when due.
//
// The DO alarm fires at `computeNextScheduled().fireAt`, then runs exactly the
// `due` (automation, node) pairs planned for that instant — so it's robust to
// wake-up drift (we fire what was due at the planned time, not the clock).

import type { Env } from '../../env';
import type {
  AutomationContext,
  AutomationRow,
  ScheduleTriggerConfig,
  SolarTriggerConfig,
} from './types';
import { sunTimes } from './solar';
import { runAutomation } from './run';
import { toGraph, triggerNodes, nodesById } from './graph';

// A due fire is a specific schedule/solar trigger node within an automation.
export type ScheduleDue = { id: string; nodeId: string };
export type SchedulePlan = { fireAt: number | null; due: ScheduleDue[] };

// Soonest upcoming fire across every schedule/solar trigger node of all enabled
// automations, plus the (automation, node) pairs that share that instant.
export async function computeNextScheduled(env: Env): Promise<SchedulePlan> {
  const rows = await env.DB
    .prepare(
      `SELECT id, project_id, name, enabled, trigger_type, trigger_config, actions, last_run_at
         FROM automations
        WHERE enabled = 1 AND (trigger_kinds LIKE '%,schedule,%' OR trigger_kinds LIKE '%,sunset_sunrise,%')`
    )
    .all<AutomationRow>();

  const now = Date.now();
  let best: number | null = null;
  const entries: { id: string; nodeId: string; fireAt: number }[] = [];

  for (const a of rows.results) {
    for (const node of triggerNodes(toGraph(a))) {
      let next: number | null = null;
      try {
        if (node.kind === 'schedule') next = nextScheduleFireAt(node.config as ScheduleTriggerConfig, now);
        else if (node.kind === 'sunset_sunrise') next = nextSolarFireAt(node.config as SolarTriggerConfig, now);
      } catch {
        next = null;
      }
      if (next == null) continue;
      entries.push({ id: a.id, nodeId: node.id, fireAt: next });
      if (best == null || next < best) best = next;
    }
  }

  if (best == null) return { fireAt: null, due: [] };
  const due = entries.filter((e) => e.fireAt - best! < 1000).map(({ id, nodeId }) => ({ id, nodeId }));
  return { fireAt: best, due };
}

// Run the planned fires. `fireAtSec` dedups against last_run_at so a duplicate
// scheduler instance (or replay) can't double-fire the same instant.
export async function runScheduledDue(env: Env, due: ScheduleDue[], fireAtSec: number): Promise<number> {
  let ran = 0;
  for (const { id, nodeId } of due) {
    const a = await env.DB
      .prepare(
        `SELECT id, project_id, name, enabled, trigger_type, trigger_config, actions, last_run_at
           FROM automations WHERE id = ? AND enabled = 1`
      )
      .bind(id)
      .first<AutomationRow>();
    if (!a) continue;
    if (a.last_run_at != null && a.last_run_at >= fireAtSec) continue; // already fired this instant

    const node = nodesById(toGraph(a)).get(nodeId);
    const ctx: AutomationContext = {
      source: node?.kind === 'sunset_sunrise' ? 'sunset_sunrise' : 'schedule',
      projectId: a.project_id,
      ts: Math.floor(Date.now() / 1000),
      depth: 0,
      entryNodeId: nodeId,
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
