import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../../env';
import { computeNextScheduled, runScheduledDue, type SchedulePlan } from '../engine/schedule';

// Singleton scheduler. Holds ONE alarm set to the next schedule/sunset fire time;
// on wake it runs the planned automations and re-arms. Replaces the every-minute
// cron poll — same alarm primitive the ProjectDO uses for its flush. Zero compute
// while idle; no scheduled automations => no alarm.
//
// Addressed by a fixed name ("scheduler") so every caller reaches one instance.
export class SchedulerDO extends DurableObject<Env> {
  // Recompute the soonest fire across all enabled schedule/sunset automations and
  // (re)arm the alarm — disarming when nothing is scheduled. Called on automation
  // create/update/delete and after the alarm fires. Re-arming to an earlier time
  // is trivial, which is the whole point of using an alarm.
  async reschedule(): Promise<void> {
    const plan = await computeNextScheduled(this.env);
    if (plan.fireAt == null) {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.delete('plan');
      return;
    }
    await this.ctx.storage.put('plan', plan);
    await this.ctx.storage.setAlarm(plan.fireAt);
  }

  // Lazy self-heal: arm only if nothing is currently scheduled (cheap — no D1
  // read when an alarm already exists).
  async ensure(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) != null) return;
    await this.reschedule();
  }

  override async alarm(): Promise<void> {
    const plan = await this.ctx.storage.get<SchedulePlan>('plan');
    if (plan?.fireAt != null) {
      try {
        await runScheduledDue(this.env, plan.due, Math.floor(plan.fireAt / 1000));
      } catch (e) {
        console.error('[scheduler] run failed', e);
      }
    }
    await this.reschedule();
  }
}

const NAME = 'scheduler';

type SchedulerStub = { reschedule(): Promise<void>; ensure(): Promise<void> };

function stub(env: Env): SchedulerStub {
  return env.SCHEDULER_DO.get(env.SCHEDULER_DO.idFromName(NAME)) as unknown as SchedulerStub;
}

// Best-effort helpers for route handlers (wrap in waitUntil).
export async function rescheduleScheduler(env: Env): Promise<void> {
  try { await stub(env).reschedule(); } catch (e) { console.error('reschedule scheduler failed', e); }
}

export async function ensureScheduler(env: Env): Promise<void> {
  try { await stub(env).ensure(); } catch (e) { console.error('ensure scheduler failed', e); }
}
