import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api, ApiError } from '../api';
import type { AuditLogEntry, Project, User } from '../types';

export const useSessionStore = defineStore('session', () => {
  const user = ref<User | null>(null);
  const projects = ref<Project[]>([]);
  const loading = ref(false);
  const error = ref<{ status: number; reason?: string } | null>(null);
  const auditLog = ref<AuditLogEntry[]>([]);
  const auditLogNextBefore = ref<number | null>(null);

  async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const data = await api.get<{ user: User; projects: Project[] }>('/v1/admin/me');
      user.value = data.user;
      projects.value = data.projects;
    } catch (e) {
      if (e instanceof ApiError) {
        const body = e.body as { reason?: string } | null;
        error.value = { status: e.status, ...(body?.reason ? { reason: body.reason } : {}) };
      } else {
        error.value = { status: 0 };
      }
      user.value = null;
      projects.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function createProject(name: string): Promise<Project> {
    const p = await api.post<Project>('/v1/admin/projects', { name });
    projects.value = [...projects.value, p];
    return p;
  }

  async function deleteProject(id: string): Promise<void> {
    await api.del<void>(`/v1/admin/projects/${id}`);
    projects.value = projects.value.filter((p) => p.id !== id);
  }

  async function updateProject(
    id: string,
    patch: { name?: string; description?: string | null; icon?: string | null; color?: string | null }
  ): Promise<void> {
    const updated = await api.patch<Project>(`/v1/admin/projects/${id}`, patch);
    projects.value = projects.value.map((p) => (p.id === id ? { ...p, ...updated } : p));
  }

  async function updateMe(patch: {
    display_name?: string | null;
    avatar_url?: string | null;
  }): Promise<void> {
    const updated = await api.patch<User>('/v1/admin/me', patch);
    user.value = updated;
  }

  async function loadAuditLog(reset = true): Promise<void> {
    const q = !reset && auditLogNextBefore.value !== null
      ? `?before=${auditLogNextBefore.value}`
      : '';
    const data = await api.get<{ entries: AuditLogEntry[]; next_before: number | null }>(
      `/v1/admin/audit-log${q}`
    );
    auditLog.value = reset ? data.entries : [...auditLog.value, ...data.entries];
    auditLogNextBefore.value = data.next_before;
  }

  return {
    user, projects, loading, error,
    auditLog, auditLogNextBefore,
    load, createProject, deleteProject, updateProject, loadAuditLog, updateMe,
  };
});
