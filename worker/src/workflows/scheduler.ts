// Event-driven scheduler for schedule + sunset/sunrise automations. Replaces the
// every-minute cron poll: the workflow sleeps until the next fire time and wakes
// early on a 'reschedule' event when automations change. Zero compute while idle;
// if there are no scheduled automations, no instance runs at all.
//
// Each cycle: plan the soonest fire -> waitForEvent (acts as sleep-until, but a
// 'reschedule' event short-circuits it so newly added/edited automations are
// picked up immediately) -> on timeout, fire the planned ids. After MAX_CYCLES
// it rolls over to a fresh instance to keep step history bounded.

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { Env } from '../env';
import { computeNextScheduled, runScheduledByIds } from '../engine/schedule';

const SCHED_KEY = 'scheduler_workflow_id';
const MAX_CYCLES = 200;
const ALIVE = new Set(['queued', 'running', 'waiting', 'paused']);

type SchedulerParams = Record<string, never>;

export class SchedulerWorkflow extends WorkflowEntrypoint<Env, SchedulerParams> {
  override async run(_event: WorkflowEvent<SchedulerParams>, step: WorkflowStep): Promise<void> {
    for (let i = 0; i < MAX_CYCLES; i++) {
      const plan = await step.do(`plan-${i}`, async () => computeNextScheduled(this.env));
      if (plan.fireAt == null) return; // nothing scheduled — let the instance complete

      const fireAt = plan.fireAt;
      const secs = Math.max(1, Math.ceil((fireAt - Date.now()) / 1000));

      let timedOut = false;
      try {
        // Resolves on a 'reschedule' event; throws on timeout (= time to fire).
        await step.waitForEvent(`wake-${i}`, { type: 'reschedule', timeout: `${secs} seconds` });
      } catch {
        timedOut = true;
      }

      if (timedOut) {
        await step.do(`fire-${i}`, async () => {
          const fired = await runScheduledByIds(this.env, plan.dueIds, Math.floor(fireAt / 1000));
          return { fired };
        });
      }
      // Either way, loop and recompute the next fire.
    }

    // Cap reached: roll over to a fresh instance so step history stays bounded.
    await step.do('rollover', async () => {
      const inst = await this.env.SCHEDULER.create();
      await writeSchedulerId(this.env, inst.id);
      return { id: inst.id };
    });
  }
}

// Wake the scheduler to recompute (automation created/edited/deleted). Falls back
// to starting a fresh instance if none is alive — self-heals after rollover.
export async function pokeScheduler(env: Env): Promise<void> {
  const id = await readSchedulerId(env);
  if (id && (await isAlive(env, id))) {
    try {
      const inst = await env.SCHEDULER.get(id);
      await inst.sendEvent({ type: 'reschedule', payload: {} });
      return;
    } catch {
      // fall through to (re)start
    }
  }
  await startScheduler(env);
}

// Ensure a scheduler instance exists (lazy self-heal, e.g. on the Automations page).
export async function ensureScheduler(env: Env): Promise<void> {
  const id = await readSchedulerId(env);
  if (id && (await isAlive(env, id))) return;
  await startScheduler(env);
}

async function startScheduler(env: Env): Promise<void> {
  const inst = await env.SCHEDULER.create();
  await writeSchedulerId(env, inst.id);
}

async function isAlive(env: Env, id: string): Promise<boolean> {
  try {
    const inst = await env.SCHEDULER.get(id);
    const { status } = await inst.status();
    return ALIVE.has(status);
  } catch {
    return false;
  }
}

// Instance id is stored in deployment_settings (read/written directly to avoid
// the settings KV cache returning a stale id during rollover races).
async function readSchedulerId(env: Env): Promise<string | null> {
  try {
    const row = await env.DB
      .prepare(`SELECT value FROM deployment_settings WHERE key = ?`)
      .bind(SCHED_KEY)
      .first<{ value: string }>();
    return row?.value ?? null;
  } catch {
    return null;
  }
}

async function writeSchedulerId(env: Env, id: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(
      `INSERT INTO deployment_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(SCHED_KEY, id, now)
    .run();
}
