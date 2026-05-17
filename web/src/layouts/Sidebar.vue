<script setup lang="ts">
import { computed, h, type FunctionalComponent } from 'vue';
import { RouterLink } from 'vue-router';
import { useSessionStore } from '../stores/session';
import { useUiStore } from '../stores/ui';
import ProjectSwitcher from './ProjectSwitcher.vue';

const session = useSessionStore();
const ui = useUiStore();

const projId = computed(() => ui.currentProject?.id ?? '');
const hasProject = computed(() => projId.value !== '');

type IconName =
  | 'home' | 'folder' | 'gauge' | 'cpu' | 'bolt'
  | 'webhook' | 'users' | 'key' | 'settings';

type NavItem = {
  label: string;
  to: string;
  icon: IconName;
  disabled?: boolean;
};

const globalTop = computed<NavItem[]>(() => [
  { label: 'Home', to: '/', icon: 'home' },
  { label: 'Projects', to: '/projects', icon: 'folder' },
]);

const projectScoped = computed<NavItem[]>(() => [
  { label: 'Dashboards', to: `/p/${projId.value}/dashboards`, icon: 'gauge', disabled: !hasProject.value },
  { label: 'Devices', to: `/p/${projId.value}/devices`, icon: 'cpu', disabled: !hasProject.value },
  { label: 'Automations', to: `/p/${projId.value}/automations`, icon: 'bolt', disabled: !hasProject.value },
  { label: 'Webhooks', to: `/p/${projId.value}/webhooks`, icon: 'webhook', disabled: !hasProject.value },
]);

const globalBottom = computed<NavItem[]>(() => [
  { label: 'Users', to: '/users', icon: 'users' },
  { label: 'API tokens', to: '/tokens', icon: 'key' },
  { label: 'Settings', to: '/settings', icon: 'settings' },
]);

// Heroicons-style 24x24 outline paths.
const ICON_PATHS: Record<IconName, string> = {
  home: 'M2.25 12 12 2.25 21.75 12M4.5 9.75v9.75a.75.75 0 0 0 .75.75H9.75V15h4.5v5.25h4.5a.75.75 0 0 0 .75-.75V9.75',
  folder: 'M3.75 9.75h16.5M3.75 9.75A1.5 1.5 0 0 1 5.25 8.25h3.879a1.5 1.5 0 0 1 1.06.44l1.122 1.121a1.5 1.5 0 0 0 1.06.44h6.379a1.5 1.5 0 0 1 1.5 1.5v6.75a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V9.75Z',
  gauge: 'M12 6v3m0 9a6 6 0 1 1 0-12 6 6 0 0 1 0 12Zm0 0v3m6-9h-3M9 12H6m11.485-4.485-2.121 2.121M9.636 14.364l-2.121 2.121',
  cpu: 'M9 3v3m6-3v3M3 9h3m12 0h3M3 15h3m12 0h3M9 21v-3m6 3v-3M7.5 6.75h9a.75.75 0 0 1 .75.75v9a.75.75 0 0 1-.75.75h-9a.75.75 0 0 1-.75-.75v-9a.75.75 0 0 1 .75-.75Z',
  bolt: 'M3.75 13.5 14.25 2.25v8.25h6L9.75 21.75V13.5h-6Z',
  webhook: 'M9 16.5a4.5 4.5 0 1 1 6.364-6.364l1.06-1.06a4.5 4.5 0 1 1 1.061 1.06l-7.07 7.071a4.5 4.5 0 0 1-1.415-7.778M12 12.75v6.75',
  users: 'M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M9 11.25a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  key: 'M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z',
  settings: 'M4.5 12a7.5 7.5 0 0 0 .104 1.243l-1.32 1.02a.75.75 0 0 0-.176.957l1.5 2.598a.75.75 0 0 0 .912.328l1.561-.624a7.45 7.45 0 0 0 2.155 1.244l.236 1.66a.75.75 0 0 0 .742.643h3a.75.75 0 0 0 .742-.643l.237-1.66a7.45 7.45 0 0 0 2.154-1.244l1.561.624a.75.75 0 0 0 .912-.328l1.5-2.598a.75.75 0 0 0-.176-.957l-1.32-1.02A7.51 7.51 0 0 0 19.5 12c0-.42-.035-.832-.103-1.232l1.319-1.02a.75.75 0 0 0 .176-.958l-1.5-2.598a.75.75 0 0 0-.912-.327l-1.561.624A7.46 7.46 0 0 0 14.764 5.245l-.236-1.66A.75.75 0 0 0 13.786 3h-3a.75.75 0 0 0-.742.643l-.237 1.66a7.45 7.45 0 0 0-2.154 1.244l-1.561-.624a.75.75 0 0 0-.912.327l-1.5 2.598a.75.75 0 0 0 .176.958l1.32 1.02C4.535 11.168 4.5 11.58 4.5 12Zm10.5 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
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

function initials(email?: string | null): string {
  if (!email) return '?';
  const local = email.split('@')[0] ?? '';
  return local.slice(0, 2).toUpperCase();
}
</script>

<template>
  <aside
    class="flex h-full flex-col border-r border-neutral-200 bg-white transition-[width] duration-150"
    :class="ui.sidebarCollapsed ? 'w-16' : 'w-60'"
  >
    <!-- Brand -->
    <div class="flex h-14 items-center gap-2 border-b border-neutral-200 px-4">
      <div class="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-neutral-900 text-white">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
          <path d="M4 6v12M4 6l8 12M12 6v12M12 6l8 12M20 6v12" />
        </svg>
      </div>
      <span
        v-if="!ui.sidebarCollapsed"
        class="text-sm font-semibold tracking-tight"
      >nodrix</span>
    </div>

    <!-- Project switcher -->
    <div v-if="!ui.sidebarCollapsed" class="border-b border-neutral-200 p-3">
      <ProjectSwitcher />
    </div>

    <!-- Nav -->
    <nav class="flex-1 overflow-y-auto px-2 py-3 text-sm">
      <ul class="space-y-0.5">
        <li v-for="item in globalTop" :key="item.to">
          <RouterLink
            :to="item.to"
            class="flex items-center gap-3 rounded-md px-2.5 py-2 text-neutral-700 hover:bg-neutral-100"
            active-class="bg-orange-50 text-orange-700 font-medium"
          >
            <component :is="iconFor(item.icon)" class="h-[18px] w-[18px] shrink-0" />
            <span v-if="!ui.sidebarCollapsed">{{ item.label }}</span>
          </RouterLink>
        </li>
      </ul>

      <div class="mt-5 mb-1.5 px-2.5">
        <div
          v-if="!ui.sidebarCollapsed"
          class="text-[10px] font-semibold uppercase tracking-wider text-neutral-400"
        >Project</div>
        <div v-else class="h-px bg-neutral-200" />
      </div>
      <ul class="space-y-0.5">
        <li v-for="item in projectScoped" :key="item.label">
          <RouterLink
            v-if="!item.disabled"
            :to="item.to"
            class="flex items-center gap-3 rounded-md px-2.5 py-2 text-neutral-700 hover:bg-neutral-100"
            active-class="bg-orange-50 text-orange-700 font-medium"
          >
            <component :is="iconFor(item.icon)" class="h-[18px] w-[18px] shrink-0" />
            <span v-if="!ui.sidebarCollapsed">{{ item.label }}</span>
          </RouterLink>
          <span
            v-else
            class="flex cursor-not-allowed items-center gap-3 rounded-md px-2.5 py-2 text-neutral-400"
            title="Select a project first"
          >
            <component :is="iconFor(item.icon)" class="h-[18px] w-[18px] shrink-0" />
            <span v-if="!ui.sidebarCollapsed">{{ item.label }}</span>
          </span>
        </li>
      </ul>

      <div class="mt-5 mb-1.5 px-2.5">
        <div
          v-if="!ui.sidebarCollapsed"
          class="text-[10px] font-semibold uppercase tracking-wider text-neutral-400"
        >Account</div>
        <div v-else class="h-px bg-neutral-200" />
      </div>
      <ul class="space-y-0.5">
        <li v-for="item in globalBottom" :key="item.to">
          <RouterLink
            :to="item.to"
            class="flex items-center gap-3 rounded-md px-2.5 py-2 text-neutral-700 hover:bg-neutral-100"
            active-class="bg-orange-50 text-orange-700 font-medium"
          >
            <component :is="iconFor(item.icon)" class="h-[18px] w-[18px] shrink-0" />
            <span v-if="!ui.sidebarCollapsed">{{ item.label }}</span>
          </RouterLink>
        </li>
      </ul>
    </nav>

    <!-- Footer: user + collapse toggle -->
    <div class="border-t border-neutral-200 p-3">
      <div v-if="!ui.sidebarCollapsed" class="mb-2 flex items-center gap-2 px-1">
        <div class="grid h-7 w-7 place-items-center rounded-full bg-orange-100 text-xs font-semibold text-orange-700">
          {{ initials(session.user?.email) }}
        </div>
        <div class="min-w-0 flex-1">
          <div class="truncate text-xs font-medium">{{ session.user?.email ?? '...' }}</div>
          <div class="text-[10px] uppercase tracking-wide text-neutral-500">{{ session.user?.role ?? '' }}</div>
        </div>
      </div>
      <button
        type="button"
        class="flex w-full items-center justify-center gap-2 rounded-md border border-neutral-200 px-2 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
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
