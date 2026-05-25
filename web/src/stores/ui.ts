import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { useSessionStore } from './session';

const LAST_PROJECT_KEY = 'nodrix:last-project';
const SIDEBAR_COLLAPSED_KEY = 'nodrix:sidebar-collapsed';

// Below this width the sidebar becomes an off-canvas drawer instead of a static
// column. Matches Tailwind's `lg` breakpoint (1024px).
const MOBILE_QUERY = '(max-width: 1023px)';

export const useUiStore = defineStore('ui', () => {
  const session = useSessionStore();

  const currentProjectId = ref<string | null>(localStorage.getItem(LAST_PROJECT_KEY));
  const sidebarCollapsed = ref<boolean>(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1');

  // Viewport tracking for the responsive shell. `isMobile` drives whether the
  // sidebar renders as a drawer; `mobileSidebarOpen` is its open/closed state.
  const mql = typeof window !== 'undefined' ? window.matchMedia(MOBILE_QUERY) : null;
  const isMobile = ref<boolean>(mql?.matches ?? false);
  const mobileSidebarOpen = ref<boolean>(false);
  mql?.addEventListener('change', (e) => {
    isMobile.value = e.matches;
    // Leaving mobile width should never leave a stray drawer open.
    if (!e.matches) mobileSidebarOpen.value = false;
  });

  // On desktop the sidebar can be collapsed to an icon rail; on mobile the drawer
  // always shows full content, so the collapsed rail only applies off-mobile.
  const sidebarRailed = computed(() => sidebarCollapsed.value && !isMobile.value);

  function openMobileSidebar(): void {
    mobileSidebarOpen.value = true;
  }
  function closeMobileSidebar(): void {
    mobileSidebarOpen.value = false;
  }
  function toggleMobileSidebar(): void {
    mobileSidebarOpen.value = !mobileSidebarOpen.value;
  }

  // Pre-edit state stash. When the dashboard editor opens we collapse the sidebar
  // for screen space; when it closes we restore whatever the user had before.
  // Stays null when no auto-collapse is active, so manual toggles inside the
  // editor cleanly take over (we don't override the user's choice on exit).
  const sidebarRestoreOnExit = ref<boolean | null>(null);

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
    // User took over: drop any pending auto-restore.
    sidebarRestoreOnExit.value = null;
  }

  function autoCollapseForEditor(): void {
    if (sidebarRestoreOnExit.value !== null) return; // already auto-collapsed
    sidebarRestoreOnExit.value = sidebarCollapsed.value;
    sidebarCollapsed.value = true;
  }

  function restoreSidebarFromEditor(): void {
    if (sidebarRestoreOnExit.value === null) return;
    sidebarCollapsed.value = sidebarRestoreOnExit.value;
    sidebarRestoreOnExit.value = null;
  }

  return {
    currentProjectId,
    currentProject,
    sidebarCollapsed,
    isMobile,
    mobileSidebarOpen,
    sidebarRailed,
    openMobileSidebar,
    closeMobileSidebar,
    toggleMobileSidebar,
    setCurrentProject,
    ensureValidProject,
    toggleSidebar,
    autoCollapseForEditor,
    restoreSidebarFromEditor,
  };
});
