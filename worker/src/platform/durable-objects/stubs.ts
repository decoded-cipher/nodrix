// Typed accessors for the per-entity Durable Object stubs. The `as unknown as`
// cast is how the Workers runtime exposes RPC methods on a stub; centralizing it
// keeps that cast (and the binding name) in one place.

import type { Env } from '../../env';
import type { ProjectDO } from './project-do';
import type { DashboardDO } from './dashboard-do';

export function projectStub(env: Env, projectId: string): ProjectDO {
  return env.PROJECT_DO.get(env.PROJECT_DO.idFromName(projectId)) as unknown as ProjectDO;
}

export function dashboardStub(env: Env, dashboardId: string): DashboardDO {
  return env.DASHBOARD_DO.get(env.DASHBOARD_DO.idFromName(dashboardId)) as unknown as DashboardDO;
}
