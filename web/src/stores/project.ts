import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api';
import type {
  Automation,
  AutomationTriggerType,
  AuditLogEntry,
  Dashboard,
  DashboardMeta,
  Device,
  DeviceWithToken,
  Integration,
  IntegrationKind,
  Layout,
  UserToken,
} from '../types';

export const useProjectStore = defineStore('project', () => {
  const currentProjectId = ref<string | null>(null);
  const devices = ref<Device[]>([]);
  const dashboards = ref<DashboardMeta[]>([]);
  const tokens = ref<UserToken[]>([]);
  const automations = ref<Automation[]>([]);
  const integrations = ref<Integration[]>([]);
  const auditLog = ref<AuditLogEntry[]>([]);
  const auditLogNextBefore = ref<number | null>(null);

  async function switchTo(projectId: string): Promise<void> {
    if (currentProjectId.value === projectId && devices.value.length + dashboards.value.length > 0) {
      return;
    }
    currentProjectId.value = projectId;
    await Promise.all([loadDevices(), loadDashboards()]);
  }

  async function loadDevices(): Promise<void> {
    if (!currentProjectId.value) return;
    const data = await api.get<{ devices: Device[] }>(
      `/v1/admin/projects/${currentProjectId.value}/devices`
    );
    devices.value = data.devices;
  }

  async function createDevice(name: string): Promise<DeviceWithToken> {
    if (!currentProjectId.value) throw new Error('no project');
    const d = await api.post<DeviceWithToken>(
      `/v1/admin/projects/${currentProjectId.value}/devices`,
      { name }
    );
    devices.value = [...devices.value, { id: d.id, name: d.name, created_at: d.created_at, last_seen: null }];
    return d;
  }

  async function deleteDevice(id: string): Promise<void> {
    if (!currentProjectId.value) return;
    await api.del<void>(`/v1/admin/projects/${currentProjectId.value}/devices/${id}`);
    devices.value = devices.value.filter((d) => d.id !== id);
  }

  async function loadDashboards(): Promise<void> {
    if (!currentProjectId.value) return;
    const data = await api.get<{ dashboards: DashboardMeta[] }>(
      `/v1/admin/projects/${currentProjectId.value}/dashboards`
    );
    dashboards.value = data.dashboards;
  }

  async function createDashboard(name: string): Promise<DashboardMeta> {
    if (!currentProjectId.value) throw new Error('no project');
    const d = await api.post<Dashboard>(
      `/v1/admin/projects/${currentProjectId.value}/dashboards`,
      { name, layout: { grid: { columns: 12 }, items: [] } }
    );
    const meta: DashboardMeta = {
      id: d.id,
      name: d.name,
      created_at: d.created_at,
      updated_at: d.updated_at,
    };
    dashboards.value = [...dashboards.value, meta];
    return meta;
  }

  async function fetchDashboard(id: string): Promise<Dashboard> {
    if (!currentProjectId.value) throw new Error('no project');
    return api.get<Dashboard>(
      `/v1/admin/projects/${currentProjectId.value}/dashboards/${id}`
    );
  }

  async function saveDashboard(
    id: string,
    layout: Layout,
    ifUpdatedAt: number
  ): Promise<Dashboard> {
    if (!currentProjectId.value) throw new Error('no project');
    return api.put<Dashboard>(
      `/v1/admin/projects/${currentProjectId.value}/dashboards/${id}`,
      { layout, if_updated_at: ifUpdatedAt }
    );
  }

  async function deleteDashboard(id: string): Promise<void> {
    if (!currentProjectId.value) return;
    await api.del<void>(`/v1/admin/projects/${currentProjectId.value}/dashboards/${id}`);
    dashboards.value = dashboards.value.filter((d) => d.id !== id);
  }

  async function loadTokens(): Promise<void> {
    const data = await api.get<{ tokens: UserToken[] }>(`/v1/admin/tokens`);
    tokens.value = data.tokens;
  }

  async function createToken(
    scope: 'read' | 'admin',
    projectScoped: boolean,
    extras: { name?: string | null; expires_at?: number | null } = {}
  ): Promise<UserToken & { token: string }> {
    const body: {
      scope: 'read' | 'admin';
      project_id?: string;
      name?: string | null;
      expires_at?: number | null;
    } = { scope };
    if (projectScoped && currentProjectId.value) body.project_id = currentProjectId.value;
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
    if (!currentProjectId.value) throw new Error('no project');
    const a = await api.post<Automation>(
      `/v1/admin/projects/${currentProjectId.value}/automations`,
      input
    );
    automations.value = [a, ...automations.value];
    return a;
  }

  async function updateAutomation(
    id: string,
    patch: Partial<Pick<Automation, 'name' | 'description' | 'enabled' | 'trigger_config' | 'actions'>>
  ): Promise<Automation> {
    if (!currentProjectId.value) throw new Error('no project');
    const a = await api.patch<Automation>(
      `/v1/admin/projects/${currentProjectId.value}/automations/${id}`,
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
    if (!currentProjectId.value) throw new Error('no project');
    const i = await api.post<Integration>(
      `/v1/admin/projects/${currentProjectId.value}/integrations`,
      input
    );
    integrations.value = [i, ...integrations.value];
    return i;
  }

  async function updateIntegration(
    id: string,
    patch: Partial<Pick<Integration, 'name' | 'config' | 'enabled'>>
  ): Promise<Integration> {
    if (!currentProjectId.value) throw new Error('no project');
    const i = await api.patch<Integration>(
      `/v1/admin/projects/${currentProjectId.value}/integrations/${id}`,
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

  // ─── Audit log ──────────────────────────────────────────────────────────────

  async function loadAuditLog(reset = true): Promise<void> {
    if (!currentProjectId.value) return;
    const q = !reset && auditLogNextBefore.value !== null
      ? `?before=${auditLogNextBefore.value}`
      : '';
    const data = await api.get<{ entries: AuditLogEntry[]; next_before: number | null }>(
      `/v1/admin/projects/${currentProjectId.value}/audit-log${q}`
    );
    auditLog.value = reset ? data.entries : [...auditLog.value, ...data.entries];
    auditLogNextBefore.value = data.next_before;
  }

  // ─── Project update ─────────────────────────────────────────────────────────

  async function updateProject(patch: {
    name?: string;
    description?: string | null;
    icon?: string | null;
    color?: string | null;
  }): Promise<void> {
    if (!currentProjectId.value) return;
    await api.patch<unknown>(`/v1/admin/projects/${currentProjectId.value}`, patch);
  }

  return {
    currentProjectId,
    devices,
    dashboards,
    tokens,
    automations,
    integrations,
    auditLog,
    auditLogNextBefore,
    switchTo,
    loadDevices,
    createDevice,
    deleteDevice,
    loadDashboards,
    createDashboard,
    fetchDashboard,
    saveDashboard,
    deleteDashboard,
    loadTokens,
    createToken,
    revokeToken,
    loadAutomations,
    createAutomation,
    updateAutomation,
    deleteAutomation,
    loadIntegrations,
    createIntegration,
    updateIntegration,
    deleteIntegration,
    loadAuditLog,
    updateProject,
  };
});
