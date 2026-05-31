import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api';
import { GRID_COLUMNS } from '../builder/grid';
import type {
  Automation,
  AutomationTriggerType,
  Dashboard,
  DashboardMeta,
  Variable,
  ProjectToken,
  ProjectTokenWithSecret,
  Integration,
  IntegrationKind,
  IntegrationTestResult,
  Layout,
  ShareState,
  UserToken,
} from '../types';

export const useProjectStore = defineStore('project', () => {
  const currentProjectId = ref<string | null>(null);
  const variables = ref<Variable[]>([]);
  const projectTokens = ref<ProjectToken[]>([]);
  const dashboards = ref<DashboardMeta[]>([]);
  const tokens = ref<UserToken[]>([]);
  const automations = ref<Automation[]>([]);
  const integrations = ref<Integration[]>([]);

  async function switchTo(projectId: string): Promise<void> {
    if (currentProjectId.value === projectId && variables.value.length + dashboards.value.length > 0) {
      return;
    }
    currentProjectId.value = projectId;
    await Promise.all([loadVariables(), loadDashboards()]);
  }

  // Guard for write actions: returns the active project id, or throws. The UI
  // only exposes these from inside a project, so this is a safety net rather
  // than expected flow — the message stays graceful in case it ever surfaces.
  function requireProjectId(): string {
    const id = currentProjectId.value;
    if (!id) throw new Error('No project is selected.');
    return id;
  }

  async function loadVariables(): Promise<void> {
    if (!currentProjectId.value) return;
    const data = await api.get<{ variables: Variable[] }>(
      `/v1/admin/projects/${currentProjectId.value}/variables`
    );
    variables.value = data.variables;
  }

  async function createVariable(input: { key: string; unit?: string | null }): Promise<Variable> {
    const pid = requireProjectId();
    const v = await api.post<Variable>(
      `/v1/admin/projects/${pid}/variables`,
      input
    );
    variables.value = [...variables.value, v];
    return v;
  }

  async function updateVariable(
    id: string,
    patch: { unit?: string | null }
  ): Promise<Variable> {
    const pid = requireProjectId();
    const v = await api.patch<Variable>(
      `/v1/admin/projects/${pid}/variables/${id}`,
      patch
    );
    variables.value = variables.value.map((x) => (x.id === id ? v : x));
    return v;
  }

  async function deleteVariable(id: string): Promise<void> {
    if (!currentProjectId.value) return;
    await api.del<void>(`/v1/admin/projects/${currentProjectId.value}/variables/${id}`);
    variables.value = variables.value.filter((v) => v.id !== id);
  }

  // ─── Project tokens (hardware credentials) ───────────────────────────────────

  async function loadProjectTokens(): Promise<void> {
    if (!currentProjectId.value) return;
    const data = await api.get<{ tokens: ProjectToken[] }>(
      `/v1/admin/projects/${currentProjectId.value}/variables/tokens`
    );
    projectTokens.value = data.tokens;
  }

  async function createProjectToken(name?: string | null): Promise<ProjectTokenWithSecret> {
    const pid = requireProjectId();
    const t = await api.post<ProjectTokenWithSecret>(
      `/v1/admin/projects/${pid}/variables/tokens`,
      { name: name ?? null }
    );
    projectTokens.value = [
      { id: t.id, name: t.name, created_at: t.created_at, last_used_at: null, revoked_at: null },
      ...projectTokens.value,
    ];
    return t;
  }

  async function revokeProjectToken(id: string): Promise<void> {
    if (!currentProjectId.value) return;
    await api.post<{ id: string; revoked_at: number }>(
      `/v1/admin/projects/${currentProjectId.value}/variables/tokens/${id}/revoke`
    );
    projectTokens.value = projectTokens.value.map((t) =>
      t.id === id ? { ...t, revoked_at: Math.floor(Date.now() / 1000) } : t
    );
  }

  async function loadDashboards(): Promise<void> {
    if (!currentProjectId.value) return;
    const data = await api.get<{ dashboards: DashboardMeta[] }>(
      `/v1/admin/projects/${currentProjectId.value}/dashboards`
    );
    dashboards.value = data.dashboards;
  }

  async function createDashboard(name: string): Promise<DashboardMeta> {
    const pid = requireProjectId();
    const d = await api.post<Dashboard>(
      `/v1/admin/projects/${pid}/dashboards`,
      { name, layout: { grid: { columns: GRID_COLUMNS }, items: [] } }
    );
    const meta: DashboardMeta = {
      id: d.id,
      name: d.name,
      description: d.description ?? null,
      created_at: d.created_at,
      updated_at: d.updated_at,
    };
    dashboards.value = [...dashboards.value, meta];
    return meta;
  }

  async function updateDashboard(
    id: string,
    patch: { name?: string; description?: string | null }
  ): Promise<DashboardMeta> {
    const pid = requireProjectId();
    const d = await api.put<Dashboard>(
      `/v1/admin/projects/${pid}/dashboards/${id}`,
      patch
    );
    dashboards.value = dashboards.value.map((x) =>
      x.id === id
        ? { ...x, name: d.name, description: d.description ?? null, updated_at: d.updated_at }
        : x
    );
    return dashboards.value.find((x) => x.id === id)!;
  }

  async function fetchDashboard(id: string): Promise<Dashboard> {
    const pid = requireProjectId();
    return api.get<Dashboard>(
      `/v1/admin/projects/${pid}/dashboards/${id}`
    );
  }

  async function saveDashboard(
    id: string,
    layout: Layout,
    ifUpdatedAt: number
  ): Promise<Dashboard> {
    const pid = requireProjectId();
    return api.put<Dashboard>(
      `/v1/admin/projects/${pid}/dashboards/${id}`,
      { layout, if_updated_at: ifUpdatedAt }
    );
  }

  async function deleteDashboard(id: string): Promise<void> {
    if (!currentProjectId.value) return;
    await api.del<void>(`/v1/admin/projects/${currentProjectId.value}/dashboards/${id}`);
    dashboards.value = dashboards.value.filter((d) => d.id !== id);
  }

  // ── Public sharing ────────────────────────────────────────────────────────
  function patchShare(s: ShareState): void {
    dashboards.value = dashboards.value.map((d) =>
      d.id === s.id
        ? { ...d, visibility: s.visibility, share_token: s.share_token, updated_at: s.updated_at }
        : d
    );
  }

  // Make public (idempotent — keeps an existing link).
  async function shareDashboard(id: string): Promise<ShareState> {
    const pid = requireProjectId();
    const s = await api.post<ShareState>(`/v1/admin/projects/${pid}/dashboards/${id}/share`);
    patchShare(s);
    return s;
  }

  // Make private and kill the link.
  async function unshareDashboard(id: string): Promise<ShareState> {
    const pid = requireProjectId();
    const s = await api.del<ShareState>(`/v1/admin/projects/${pid}/dashboards/${id}/share`);
    patchShare(s);
    return s;
  }

  async function loadTokens(): Promise<void> {
    const data = await api.get<{ tokens: UserToken[] }>(`/v1/admin/tokens`);
    tokens.value = data.tokens;
  }

  async function createToken(
    scope: 'read' | 'admin',
    projectId: string | null,
    extras: { name?: string | null; expires_at?: number | null } = {}
  ): Promise<UserToken & { token: string }> {
    const body: {
      scope: 'read' | 'admin';
      project_id?: string;
      name?: string | null;
      expires_at?: number | null;
    } = { scope };
    if (projectId) body.project_id = projectId;
    if (extras.name) body.name = extras.name;
    if (extras.expires_at) body.expires_at = extras.expires_at;
    const t = await api.post<UserToken & { token: string }>('/v1/admin/tokens', body);
    tokens.value = [t, ...tokens.value];
    return t;
  }

  async function revokeToken(id: string): Promise<void> {
    await api.post<{ id: string; revoked_at: number }>(`/v1/admin/tokens/${id}/revoke`);
    tokens.value = tokens.value.map((t) =>
      t.id === id ? { ...t, revoked_at: Math.floor(Date.now() / 1000) } : t
    );
  }

  // ─── Automations ────────────────────────────────────────────────────────────

  async function loadAutomations(): Promise<void> {
    if (!currentProjectId.value) return;
    const data = await api.get<{ automations: Automation[] }>(
      `/v1/admin/projects/${currentProjectId.value}/automations`
    );
    automations.value = data.automations;
  }

  async function createAutomation(input: {
    name: string;
    trigger_type: AutomationTriggerType;
    description?: string | null;
    trigger_config?: unknown;
    actions?: unknown[];
  }): Promise<Automation> {
    const pid = requireProjectId();
    const a = await api.post<Automation>(
      `/v1/admin/projects/${pid}/automations`,
      input
    );
    automations.value = [a, ...automations.value];
    return a;
  }

  async function updateAutomation(
    id: string,
    patch: Partial<Pick<Automation, 'name' | 'description' | 'enabled' | 'trigger_config' | 'actions'>>
  ): Promise<Automation> {
    const pid = requireProjectId();
    const a = await api.patch<Automation>(
      `/v1/admin/projects/${pid}/automations/${id}`,
      patch
    );
    automations.value = automations.value.map((x) => (x.id === id ? a : x));
    return a;
  }

  async function deleteAutomation(id: string): Promise<void> {
    if (!currentProjectId.value) return;
    await api.del<void>(`/v1/admin/projects/${currentProjectId.value}/automations/${id}`);
    automations.value = automations.value.filter((a) => a.id !== id);
  }

  async function runAutomation(
    id: string
  ): Promise<{ status: 'ok' | 'error' | 'skipped'; error?: string; actionsRun: number }> {
    const pid = requireProjectId();
    const res = await api.post<{
      result: { status: 'ok' | 'error' | 'skipped'; error?: string; actionsRun: number };
      automation: Automation;
    }>(`/v1/admin/projects/${pid}/automations/${id}/run`);
    automations.value = automations.value.map((x) => (x.id === id ? res.automation : x));
    return res.result;
  }

  // ─── Integrations ───────────────────────────────────────────────────────────

  async function loadIntegrations(): Promise<void> {
    if (!currentProjectId.value) return;
    const data = await api.get<{ integrations: Integration[] }>(
      `/v1/admin/projects/${currentProjectId.value}/integrations`
    );
    integrations.value = data.integrations;
  }

  async function createIntegration(input: {
    name: string;
    kind: IntegrationKind;
    config?: unknown;
    enabled?: boolean;
  }): Promise<Integration> {
    const pid = requireProjectId();
    const i = await api.post<Integration>(
      `/v1/admin/projects/${pid}/integrations`,
      input
    );
    integrations.value = [i, ...integrations.value];
    return i;
  }

  async function updateIntegration(
    id: string,
    patch: Partial<Pick<Integration, 'name' | 'config' | 'enabled'>>
  ): Promise<Integration> {
    const pid = requireProjectId();
    const i = await api.patch<Integration>(
      `/v1/admin/projects/${pid}/integrations/${id}`,
      patch
    );
    integrations.value = integrations.value.map((x) => (x.id === id ? i : x));
    return i;
  }

  async function deleteIntegration(id: string): Promise<void> {
    if (!currentProjectId.value) return;
    await api.del<void>(`/v1/admin/projects/${currentProjectId.value}/integrations/${id}`);
    integrations.value = integrations.value.filter((i) => i.id !== id);
  }

  // Fires an integration once with a synthetic context. Returns the delivery
  // result and refreshes the row's last-run status from the response.
  async function testIntegration(id: string): Promise<IntegrationTestResult> {
    const pid = requireProjectId();
    const res = await api.post<IntegrationTestResult>(
      `/v1/admin/projects/${pid}/integrations/${id}/test`
    );
    const now = Math.floor(Date.now() / 1000);
    integrations.value = integrations.value.map((i) =>
      i.id === id
        ? { ...i, last_run_at: now, last_run_status: res.status, last_error: res.status === 'error' ? (res.detail ?? 'error') : null }
        : i
    );
    return res;
  }

  return {
    currentProjectId,
    variables,
    projectTokens,
    dashboards,
    tokens,
    automations,
    integrations,
    switchTo,
    loadVariables,
    createVariable,
    updateVariable,
    deleteVariable,
    loadProjectTokens,
    createProjectToken,
    revokeProjectToken,
    loadDashboards,
    createDashboard,
    updateDashboard,
    fetchDashboard,
    saveDashboard,
    deleteDashboard,
    shareDashboard,
    unshareDashboard,
    loadTokens,
    createToken,
    revokeToken,
    loadAutomations,
    createAutomation,
    updateAutomation,
    deleteAutomation,
    runAutomation,
    loadIntegrations,
    createIntegration,
    updateIntegration,
    deleteIntegration,
    testIntegration,
  };
});
