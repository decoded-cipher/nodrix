import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../../env';
import { computeNextScheduled, runScheduledDue, runDueDelays, nextDelayFireAt, type SchedulePlan } from '../engine/schedule';

// Singleton scheduler. Holds ONE alarm set to the next schedule/sunset fire time
// OR the next pending delay resume, whichever is sooner; on wake it runs whatever
// is due and re-arms. Same alarm primitive the ProjectDO uses for its flush. Zero
// compute while idle; nothing scheduled => no alarm.
//
// Addressed by a fixed name ("scheduler") so every caller reaches one instance.
export class SchedulerDO extends DurableObject<Env> {
  // Recompute the soonest fire across schedule/sunset triggers and pending delay
  // resumes, and (re)arm the alarm — disarming when nothing is pending. Called on
  // automation create/update/delete, on each new delay, and after the alarm fires.
  async reschedule(): Promise<void> {
    const plan = await computeNextScheduled(this.env);
    const delayAt = await nextDelayFireAt(this.env);
    await this.ctx.storage.put('plan', plan);

    const fireAt = soonest(plan.fireAt, delayAt);
    if (fireAt == null) {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.delete('plan');
      return;
    }
    await this.ctx.storage.setAlarm(fireAt);
  }

  // Lazy self-heal: arm only if nothing is currently scheduled (cheap — no D1
  // read when an alarm already exists).
  async ensure(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) != null) return;
    await this.reschedule();
  }

  override async alarm(): Promise<void> {
    const now = Date.now();
    // The alarm may have fired for a schedule or a delay (or both at once). Run
    // schedule fires only when their planned instant has actually arrived.
    const plan = await this.ctx.storage.get<SchedulePlan>('plan');
    if (plan?.fireAt != null && plan.fireAt <= now) {
      try {
        await runScheduledDue(this.env, plan.due, Math.floor(plan.fireAt / 1000));
      } catch (e) {
        console.error('[scheduler] run failed', e);
      }
    }
    try {
      await runDueDelays(this.env, now);
    } catch (e) {
      console.error('[scheduler] delay resume failed', e);
    }
    await this.reschedule();
  }
}

// Smaller of two optional epochs.
function soonest(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.min(a, b);
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
