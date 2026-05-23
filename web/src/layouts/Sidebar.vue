<script setup lang="ts">
import { computed, h, type FunctionalComponent } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useSessionStore } from '../stores/session';
import { useUiStore } from '../stores/ui';
import ProjectSwitcher from './ProjectSwitcher.vue';

const session = useSessionStore();
const ui = useUiStore();
const router = useRouter();
const route = useRoute();

async function signOut() {
  await session.signOut();
  router.replace('/login');
}

const projId = computed(() => ui.currentProject?.id ?? '');
const hasProject = computed(() => projId.value !== '');

type IconName =
  | 'home' | 'folder' | 'dashboards' | 'variable' | 'bolt'
  | 'integrations' | 'users' | 'key' | 'settings' | 'audit';

type NavItem = {
  label: string;
  to: string;
  icon: IconName;
  disabled?: boolean;
  // Override the default exact-path active check. The Dashboards item uses
  // this to stay highlighted on the view and edit routes too.
  matchPath?: (path: string) => boolean;
};

const globalTop = computed<NavItem[]>(() => [
  { label: 'Home', to: '/', icon: 'home' },
  { label: 'Projects', to: '/projects', icon: 'folder' },
]);

const projectScoped = computed<NavItem[]>(() => {
  const id = projId.value;
  return [
    { label: 'Variables', to: `/p/${id}/variables`, icon: 'variable', disabled: !hasProject.value },
    {
      label: 'Dashboards',
      to: `/p/${id}/dashboards`,
      icon: 'dashboards',
      disabled: !hasProject.value,
      matchPath: (path) =>
        path === `/p/${id}/dashboards` || path.startsWith(`/p/${id}/d/`),
    },
    {
      label: 'Automations',
      to: `/p/${id}/automations`,
      icon: 'bolt',
      disabled: !hasProject.value,
      // Stay highlighted across the Connections tab and the editor too.
      matchPath: (path) => path.startsWith(`/p/${id}/automations`),
    },
  ];
});

const globalBottom = computed<NavItem[]>(() => [
  { label: 'Users', to: '/users', icon: 'users' },
  { label: 'API tokens', to: '/tokens', icon: 'key' },
  { label: 'Audit log', to: '/audit-log', icon: 'audit' },
  { label: 'Settings', to: '/settings', icon: 'settings' },
]);

const ACTIVE_CLASSES =
  'bg-accent-50 text-accent-700 font-medium hover:bg-accent-100 dark:bg-accent-500/15 dark:text-accent-400 dark:hover:bg-accent-500/20';

function isActive(item: NavItem): boolean {
  if (item.matchPath) return item.matchPath(route.path);
  return route.path === item.to;
}

// Heroicons-style 24x24 outline paths.
const ICON_PATHS: Record<IconName, string> = {
  home: 'M2.25 12 12 2.25 21.75 12M4.5 9.75v9.75a.75.75 0 0 0 .75.75H9.75V15h4.5v5.25h4.5a.75.75 0 0 0 .75-.75V9.75',
  folder: 'M3.75 9.75h16.5M3.75 9.75A1.5 1.5 0 0 1 5.25 8.25h3.879a1.5 1.5 0 0 1 1.06.44l1.122 1.121a1.5 1.5 0 0 0 1.06.44h6.379a1.5 1.5 0 0 1 1.5 1.5v6.75a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V9.75Z',
  dashboards: 'M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z',
  variable: 'M4.745 3A23.933 23.933 0 0 0 3 12c0 3.183.62 6.22 1.745 9M19.5 3c.967 2.78 1.5 5.817 1.5 9s-.533 6.22-1.5 9M8.25 8.885l1.444-.89a.75.75 0 0 1 1.105.402l2.402 7.206a.75.75 0 0 0 1.104.401l1.445-.889m-8.25.75.213.09a1.687 1.687 0 0 0 2.062-.617l4.45-6.676a1.688 1.688 0 0 1 2.062-.618l.213.09',
  bolt: 'M3.75 13.5 14.25 2.25v8.25h6L9.75 21.75V13.5h-6Z',
  integrations: 'M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959a.64.64 0 0 1-.657.643 48.39 48.39 0 0 1-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 0 1-.658.663c-.355 0-.676-.186-.959-.401a1.647 1.647 0 0 0-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401.31 0 .555.26.532.57a48.039 48.039 0 0 1-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 0 0 .657-.643c0-.355-.186-.676-.401-.959a1.647 1.647 0 0 1-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959 0 .333.277.599.61.58a48.1 48.1 0 0 0 5.427-.63 48.05 48.05 0 0 0 .582-4.717.532.532 0 0 0-.533-.57c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.96.401a.656.656 0 0 0 .658-.663 48.422 48.422 0 0 0-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 0 1-.61-.58Z',
  users: 'M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M21 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  key: 'M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z',
  settings: 'M4.5 12a7.5 7.5 0 0 0 .104 1.243l-1.32 1.02a.75.75 0 0 0-.176.957l1.5 2.598a.75.75 0 0 0 .912.328l1.561-.624a7.45 7.45 0 0 0 2.155 1.244l.236 1.66a.75.75 0 0 0 .742.643h3a.75.75 0 0 0 .742-.643l.237-1.66a7.45 7.45 0 0 0 2.154-1.244l1.561.624a.75.75 0 0 0 .912-.328l1.5-2.598a.75.75 0 0 0-.176-.957l-1.32-1.02A7.51 7.51 0 0 0 19.5 12c0-.42-.035-.832-.103-1.232l1.319-1.02a.75.75 0 0 0 .176-.958l-1.5-2.598a.75.75 0 0 0-.912-.327l-1.561.624A7.46 7.46 0 0 0 14.764 5.245l-.236-1.66A.75.75 0 0 0 13.786 3h-3a.75.75 0 0 0-.742.643l-.237 1.66a7.45 7.45 0 0 0-2.154 1.244l-1.561-.624a.75.75 0 0 0-.912.327l-1.5 2.598a.75.75 0 0 0 .176.958l1.32 1.02C4.535 11.168 4.5 11.58 4.5 12Zm10.5 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  audit: 'M9 5h6m-6 0H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 1 1 6 0M9 12h6m-6 4h4',
};

function iconFor(name: IconName): FunctionalComponent {
  return (_props, { attrs }) =>
    h(
      'svg',
      {
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.6',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        ...attrs,
      },
      [h('path', { d: ICON_PATHS[name] })]
    );
}

const displayName = computed(() => {
  const u = session.user;
  if (!u) return '...';
  const parts = [u.first_name, u.last_name].filter((s): s is string => !!s && !!s.trim());
  if (parts.length > 0) return parts.join(' ');
  return u.email;
});

const initials = computed(() => {
  const u = session.user;
  if (!u) return '?';
  const f = (u.first_name ?? '').trim();
  const l = (u.last_name ?? '').trim();
  if (f && l) return (f.charAt(0) + l.charAt(0)).toUpperCase();
  if (f) return f.slice(0, 2).toUpperCase();
  const local = u.email.split('@')[0] ?? '';
  return local.slice(0, 2).toUpperCase();
});
</script>

<template>
  <aside
    class="flex h-full flex-col border-r border-neutral-200 bg-white transition-[width] duration-150 dark:border-neutral-800 dark:bg-neutral-900"
    :class="ui.sidebarCollapsed ? 'w-16' : 'w-60'"
  >
    <!-- Brand -->
    <div
      class="flex h-14 items-center border-b border-neutral-200 dark:border-neutral-800"
      :class="ui.sidebarCollapsed ? 'justify-center px-0' : 'px-4'"
    >
      <!-- Collapsed: white logo on a dark square -->
      <div
        v-if="ui.sidebarCollapsed"
        class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-neutral-900 dark:bg-neutral-800"
      >
        <img src="/white_logo.png" alt="nodrix" class="h-6 w-6 object-contain" />
      </div>
      <!-- Expanded: dark logo in light mode, white logo in dark mode -->
      <template v-else>
        <img src="/dark_logo.png" alt="nodrix" class="h-7 w-auto dark:hidden" />
        <img src="/white_logo.png" alt="nodrix" class="hidden h-7 w-auto dark:block" />
      </template>
    </div>

    <!-- Project switcher -->
    <div v-if="!ui.sidebarCollapsed" class="border-b border-neutral-200 p-3 dark:border-neutral-800">
      <ProjectSwitcher />
    </div>

    <!-- Nav -->
    <nav class="flex-1 overflow-y-auto px-2 py-3 text-sm">
      <ul class="space-y-0.5">
        <li v-for="item in globalTop" :key="item.to">
          <RouterLink
            :to="item.to"
            class="flex items-center rounded-md py-2 text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            :class="[
              ui.sidebarCollapsed ? 'justify-center px-0' : 'gap-3 px-2.5',
              isActive(item) ? ACTIVE_CLASSES : '',
            ]"
            :title="ui.sidebarCollapsed ? item.label : undefined"
          >
            <component :is="iconFor(item.icon)" class="h-[18px] w-[18px] shrink-0" />
            <span v-if="!ui.sidebarCollapsed">{{ item.label }}</span>
          </RouterLink>
        </li>
      </ul>

      <div class="mt-5 mb-1.5 px-2.5">
        <div
          v-if="!ui.sidebarCollapsed"
          class="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500"
        >Project</div>
        <div v-else class="h-px bg-neutral-200 dark:bg-neutral-800" />
      </div>
      <ul class="space-y-0.5">
        <li v-for="item in projectScoped" :key="item.label">
          <RouterLink
            v-if="!item.disabled"
            :to="item.to"
            class="flex items-center rounded-md py-2 text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            :class="[
              ui.sidebarCollapsed ? 'justify-center px-0' : 'gap-3 px-2.5',
              isActive(item) ? ACTIVE_CLASSES : '',
            ]"
            :title="ui.sidebarCollapsed ? item.label : undefined"
          >
            <component :is="iconFor(item.icon)" class="h-[18px] w-[18px] shrink-0" />
            <span v-if="!ui.sidebarCollapsed">{{ item.label }}</span>
          </RouterLink>
          <span
            v-else
            class="flex cursor-not-allowed items-center rounded-md py-2 text-neutral-400 dark:text-neutral-600"
            :class="ui.sidebarCollapsed ? 'justify-center px-0' : 'gap-3 px-2.5'"
            :title="ui.sidebarCollapsed ? `${item.label} — select a project first` : 'Select a project first'"
          >
            <component :is="iconFor(item.icon)" class="h-[18px] w-[18px] shrink-0" />
            <span v-if="!ui.sidebarCollapsed">{{ item.label }}</span>
          </span>
        </li>
      </ul>

      <div class="mt-5 mb-1.5 px-2.5">
        <div
          v-if="!ui.sidebarCollapsed"
          class="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500"
        >Account</div>
        <div v-else class="h-px bg-neutral-200 dark:bg-neutral-800" />
      </div>
      <ul class="space-y-0.5">
        <li v-for="item in globalBottom" :key="item.to">
          <RouterLink
            :to="item.to"
            class="flex items-center rounded-md py-2 text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            :class="[
              ui.sidebarCollapsed ? 'justify-center px-0' : 'gap-3 px-2.5',
              isActive(item) ? ACTIVE_CLASSES : '',
            ]"
            :title="ui.sidebarCollapsed ? item.label : undefined"
          >
            <component :is="iconFor(item.icon)" class="h-[18px] w-[18px] shrink-0" />
            <span v-if="!ui.sidebarCollapsed">{{ item.label }}</span>
          </RouterLink>
        </li>
      </ul>
    </nav>

    <!-- Footer: user + sign out + collapse toggle -->
    <div class="border-t border-neutral-200 p-3 dark:border-neutral-800">
      <div v-if="!ui.sidebarCollapsed" class="mb-2 flex items-center gap-2 px-1">
        <div class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-100 text-xs font-semibold text-accent-700 dark:bg-accent-900/40 dark:text-accent-300">
          {{ initials }}
        </div>
        <div class="min-w-0 flex-1">
          <div class="truncate text-xs font-medium">{{ displayName }}</div>
          <div class="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{{ session.user?.role ?? '' }}</div>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          title="Sign out"
          aria-label="Sign out"
          @click="signOut"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
          </svg>
        </button>
      </div>

      <!-- Collapsed state: stacked icon buttons -->
      <div v-else class="mb-2 flex flex-col items-center gap-1">
        <button
          type="button"
          class="grid h-7 w-7 place-items-center rounded-full bg-accent-100 text-xs font-semibold text-accent-700 hover:ring-2 hover:ring-accent-200 dark:bg-accent-900/40 dark:text-accent-300 dark:hover:ring-accent-700"
          title="Sign out"
          aria-label="Sign out"
          @click="signOut"
        >{{ initials }}</button>
        <button
          type="button"
          class="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          title="Sign out"
          aria-label="Sign out"
          @click="signOut"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
          </svg>
        </button>
      </div>

      <button
        type="button"
        class="flex w-full items-center justify-center gap-2 rounded-md border border-neutral-200 px-2 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800"
        @click="ui.toggleSidebar()"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"
          class="h-3.5 w-3.5"
          :class="ui.sidebarCollapsed ? 'rotate-180' : ''"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
        </svg>
        <span v-if="!ui.sidebarCollapsed">Collapse</span>
      </button>
    </div>
  </aside>
</template>
