import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api, ApiError } from '../api';
import { authClient } from '../lib/auth-client';
import { toast } from '../lib/toast';
import type {
  AuditLogEntry,
  Invite,
  InviteCreated,
  InstanceUser,
  Project,
  User,
} from '../types';

export type ActiveSession = {
  id: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  current: boolean;
};

export const useSessionStore = defineStore('session', () => {
  const user = ref<User | null>(null);
  const projects = ref<Project[]>([]);
  const loading = ref(false);
  const error = ref<{ status: number; reason?: string } | null>(null);
  const auditLog = ref<AuditLogEntry[]>([]);
  const auditLogPage = ref(1);
  const auditLogPageSize = ref(15);
  const auditLogPageCount = ref(1);
  const auditLogTotal = ref(0);
  const activeSessions = ref<ActiveSession[]>([]);
  const oauthProviders = ref<('google' | 'github')[]>([]);
  const instanceUsers = ref<InstanceUser[]>([]);
  const invites = ref<Invite[]>([]);

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
    toast.success(`Project “${p.name}” created`);
    return p;
  }

  async function deleteProject(id: string): Promise<void> {
    const name = projects.value.find((p) => p.id === id)?.name;
    await api.del<void>(`/v1/admin/projects/${id}`);
    projects.value = projects.value.filter((p) => p.id !== id);
    toast.success(name ? `Project “${name}” deleted` : 'Project deleted');
  }

  async function updateProject(
    id: string,
    patch: { name?: string; description?: string | null }
  ): Promise<void> {
    const updated = await api.patch<Project>(`/v1/admin/projects/${id}`, patch);
    projects.value = projects.value.map((p) => (p.id === id ? { ...p, ...updated } : p));
    toast.success('Project updated');
  }

  async function updateMe(patch: {
    first_name?: string | null;
    last_name?: string | null;
  }): Promise<void> {
    const updated = await api.patch<User>('/v1/admin/me', patch);
    user.value = updated;
    toast.success('Profile updated');
  }

  async function signOut(): Promise<void> {
    try { await authClient.signOut(); } catch { /* ignore */ }
    user.value = null;
    projects.value = [];
    activeSessions.value = [];
  }

  async function loadSessions(): Promise<void> {
    const data = await api.get<{ sessions: ActiveSession[] }>('/v1/admin/sessions');
    activeSessions.value = data.sessions;
  }

  async function revokeSession(id: string): Promise<void> {
    await api.del<void>(`/v1/admin/sessions/${id}`);
    activeSessions.value = activeSessions.value.filter((s) => s.id !== id);
    toast.success('Device signed out');
  }

  async function loadProviders(): Promise<void> {
    const data = await api.get<{ providers: ('google' | 'github')[] }>(
      '/v1/public/auth-providers'
    );
    oauthProviders.value = data.providers;
  }

  async function loadAuditLog(page = 1): Promise<void> {
    const data = await api.get<{
      entries: AuditLogEntry[];
      total: number;
      page: number;
      page_size: number;
      page_count: number;
    }>(`/v1/admin/audit-log?page=${page}&limit=${auditLogPageSize.value}`);
    auditLog.value = data.entries;
    auditLogPage.value = data.page;
    auditLogPageSize.value = data.page_size;
    auditLogPageCount.value = data.page_count;
    auditLogTotal.value = data.total;
  }

  // ─── Instance users (owner/admin) ────────────────────────────────────────────

  async function loadUsers(): Promise<void> {
    const data = await api.get<{ users: InstanceUser[] }>('/v1/admin/users');
    instanceUsers.value = data.users;
  }

  async function setUserRole(id: string, role: 'admin' | 'member'): Promise<void> {
    await api.patch<{ id: string; role: string }>(`/v1/admin/users/${id}`, { role });
    // Promoting to admin clears explicit project rows server-side (admins reach
    // all projects); mirror that locally.
    instanceUsers.value = instanceUsers.value.map((u) =>
      u.id === id ? { ...u, role, projects: role === 'admin' ? [] : u.projects } : u
    );
    toast.success(`Role changed to ${role}`);
  }

  // Replace a member's project assignments. Returns the stored set.
  async function setUserProjects(id: string, projectIds: string[]): Promise<void> {
    const res = await api.put<{ id: string; project_ids: string[] }>(
      `/v1/admin/users/${id}/projects`,
      { project_ids: projectIds }
    );
    const stored = new Set(res.project_ids);
    instanceUsers.value = instanceUsers.value.map((u) =>
      u.id === id ? { ...u, projects: projects.value.filter((p) => stored.has(p.id)) } : u
    );
    toast.success('Project access updated');
  }

  async function removeUser(id: string): Promise<void> {
    const email = instanceUsers.value.find((u) => u.id === id)?.email;
    await api.del<void>(`/v1/admin/users/${id}`);
    instanceUsers.value = instanceUsers.value.filter((u) => u.id !== id);
    toast.success(email ? `${email} removed` : 'User removed');
  }

  async function transferOwnership(id: string): Promise<void> {
    await api.post<{ id: string; role: string }>(`/v1/admin/users/${id}/transfer-ownership`);
    await loadUsers();
    await load();
    toast.success('Ownership transferred');
  }

  // ─── Invites (owner/admin) ────────────────────────────────────────────────────

  async function loadInvites(): Promise<void> {
    const data = await api.get<{ invites: Invite[] }>('/v1/admin/invites');
    invites.value = data.invites;
  }

  async function createInvite(input: {
    email: string;
    instance_role: 'admin' | 'member';
    mode: 'link' | 'direct';
    expires_in_days?: number | null;
    name?: string | null;
  }): Promise<InviteCreated> {
    const created = await api.post<InviteCreated>('/v1/admin/invites', input);
    await loadInvites();
    return created;
  }

  async function revokeInvite(id: string): Promise<void> {
    await api.del<void>(`/v1/admin/invites/${id}`);
    invites.value = invites.value.filter((i) => i.id !== id);
    toast.success('Invite revoked');
  }

  return {
    user, projects, loading, error,
    auditLog, auditLogPage, auditLogPageSize, auditLogPageCount, auditLogTotal,
    activeSessions, oauthProviders, instanceUsers, invites,
    load, createProject, deleteProject, updateProject, loadAuditLog, updateMe,
    signOut, loadSessions, revokeSession, loadProviders,
    loadUsers, setUserRole, setUserProjects, removeUser, transferOwnership,
    loadInvites, createInvite, revokeInvite,
  };
});
