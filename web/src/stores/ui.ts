import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { useSessionStore } from './session';

const LAST_PROJECT_KEY = 'nodrix:last-project';
const SIDEBAR_COLLAPSED_KEY = 'nodrix:sidebar-collapsed';

export const useUiStore = defineStore('ui', () => {
  const session = useSessionStore();

  const currentProjectId = ref<string | null>(localStorage.getItem(LAST_PROJECT_KEY));
  const sidebarCollapsed = ref<boolean>(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1');

  const currentProject = computed(() => {
    const id = currentProjectId.value;
    if (!id) return session.projects[0] ?? null;
    return session.projects.find((p) => p.id === id) ?? session.projects[0] ?? null;
  });

  function setCurrentProject(id: string): void {
    currentProjectId.value = id;
    localStorage.setItem(LAST_PROJECT_KEY, id);
  }

  function ensureValidProject(): void {
    if (session.projects.length === 0) return;
    const exists = session.projects.some((p) => p.id === currentProjectId.value);
    if (!exists) setCurrentProject(session.projects[0]!.id);
  }

  function toggleSidebar(): void {
    sidebarCollapsed.value = !sidebarCollapsed.value;
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed.value ? '1' : '0');
  }

  return {
    currentProjectId,
    currentProject,
    sidebarCollapsed,
    setCurrentProject,
    ensureValidProject,
    toggleSidebar,
  };
});
