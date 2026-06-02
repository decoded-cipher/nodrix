// Domain 2 (engine/scheduler): next-fire math across DST + weekday filters, solar
// bounds, and the scheduler's "one fire per automation per instant" dedup over the
// batched read. Pure logic with a stubbed env. Run with `bun test worker/test/schedule.test.ts`.

import { test, expect } from 'bun:test';
import {
  nextScheduleFireAt,
  nextSolarFireAt,
  runScheduledDue,
  type ScheduleDue,
} from '../src/platform/engine/schedule';
import type { AutomationRow, AutomationGraph } from '../src/platform/engine/types';

function wallTime(ms: number, tz: string): string {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(ms));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('hour')}:${g('minute')}`;
}

// ── nextScheduleFireAt ────────────────────────────────────────────────────────

test('schedule fires at the next occurrence of the wall time (same/next day)', () => {
  const from = Date.UTC(2025, 5, 1, 8, 0); // 2025-06-01 08:00Z
  const later = nextScheduleFireAt({ time: '23:30', tz: 'UTC' }, from)!;
  expect(wallTime(later, 'UTC')).toBe('23:30');
  expect(later).toBeGreaterThan(from);

  // A wall time already past today rolls to tomorrow.
  const next = nextScheduleFireAt({ time: '06:00', tz: 'UTC' }, from)!;
  expect(wallTime(next, 'UTC')).toBe('06:00');
  expect(new Date(next).getUTCDate()).toBe(2);
});

test('schedule honours the weekday filter (0=Sun..6=Sat)', () => {
  const sunday = Date.UTC(2025, 5, 1, 0, 0); // 2025-06-01 is a Sunday
  const inst = nextScheduleFireAt({ time: '12:00', tz: 'UTC', days: [1] }, sunday)!; // Mondays only
  expect(new Date(inst).getUTCDay()).toBe(1);
  expect(new Date(inst).getUTCDate()).toBe(2); // the following Monday
  expect(wallTime(inst, 'UTC')).toBe('12:00');
});

test('schedule keeps the wall time across DST (summer EDT and winter EST)', () => {
  const tz = 'America/New_York';
  const summer = nextScheduleFireAt({ time: '09:00', tz }, Date.UTC(2025, 6, 1, 0, 0))!; // July
  const winter = nextScheduleFireAt({ time: '09:00', tz }, Date.UTC(2025, 0, 1, 0, 0))!; // January
  expect(wallTime(summer, tz)).toBe('09:00');
  expect(wallTime(winter, tz)).toBe('09:00');
  // Same wall time, different UTC offset proves the DST correction.
  expect(wallTime(summer, 'UTC')).toBe('13:00'); // EDT = UTC-4
  expect(wallTime(winter, 'UTC')).toBe('14:00'); // EST = UTC-5
});

test('schedule rejects malformed time config', () => {
  expect(nextScheduleFireAt({ time: 'nope', tz: 'UTC' } as any, Date.now())).toBeNull();
});

// ── nextSolarFireAt ───────────────────────────────────────────────────────────

test('solar fire is finite, in the future, and within a few days', () => {
  const from = Date.UTC(2025, 5, 1, 0, 0);
  const sunrise = nextSolarFireAt({ event: 'sunrise', lat: 51.5, lng: -0.12 }, from)!; // London
  expect(sunrise).toBeGreaterThan(from);
  expect(sunrise - from).toBeLessThan(2 * 86_400_000);

  const offset = nextSolarFireAt({ event: 'sunset', lat: 51.5, lng: -0.12, offset_minutes: 30 }, from)!;
  const noOffset = nextSolarFireAt({ event: 'sunset', lat: 51.5, lng: -0.12 }, from)!;
  expect(Math.abs((offset - noOffset) - 30 * 60_000)).toBeLessThan(1000);
});

// ── runScheduledDue dedup over the batched read ───────────────────────────────

function dueEnv(automation: AutomationRow): any {
  const stmt = (sql: string) => {
    const s: any = {
      bind: () => s,
      run: async () => ({ meta: { changes: 1 } }),
      first: async () => null,                                   // getSetting/audit -> disabled
      all: async () => (/FROM automations/i.test(sql) ? { results: [automation] } : { results: [] }),
    };
    return s;
  };
  return { DB: { prepare: stmt }, KV: { get: async () => null } };
}

test('runScheduledDue fires an automation once even with two due trigger nodes', async () => {
  const graph: AutomationGraph = {
    nodes: [
      { id: 't1', kind: 'schedule', config: { time: '09:00' } },
      { id: 't2', kind: 'schedule', config: { time: '09:00' } },
    ],
    edges: [],
  };
  const automation: AutomationRow = {
    id: 'a1', project_id: 'p1', name: 's', enabled: 1,
    trigger_type: 'schedule', graph: JSON.stringify(graph), last_run_at: null,
  };
  const due: ScheduleDue[] = [
    { id: 'a1', nodeId: 't1' },
    { id: 'a1', nodeId: 't2' },
  ];
  const ran = await runScheduledDue(dueEnv(automation), due, Math.floor(Date.now() / 1000));
  expect(ran).toBe(1);
});
