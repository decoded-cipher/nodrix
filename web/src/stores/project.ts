import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api';
import type {
  Dashboard,
  DashboardMeta,
  Device,
  DeviceWithToken,
  Layout,
  UserToken,
} from '../types';

export const useProjectStore = defineStore('project', () => {
  const currentProjectId = ref<string | null>(null);
  const devices = ref<Device[]>([]);
  const dashboards = ref<DashboardMeta[]>([]);
  const tokens = ref<UserToken[]>([]);

  async function switchTo(projectId: string): Promise<void> {
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
    projectScoped: boolean
  ): Promise<UserToken & { token: string }> {
    const body: { scope: 'read' | 'admin'; project_id?: string } = { scope };
    if (projectScoped && currentProjectId.value) body.project_id = currentProjectId.value;
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

  return {
    currentProjectId,
    devices,
    dashboards,
    tokens,
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
  };
});
