import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  // Setup lives outside the app shell.
  { path: '/setup', name: 'setup', component: () => import('./pages/Setup.vue') },

  // Everything else is wrapped in the authenticated app shell.
  {
    path: '/',
    component: () => import('./layouts/AppShell.vue'),
    children: [
      { path: '', name: 'home', component: () => import('./pages/Home.vue') },
      { path: 'projects', name: 'projects', component: () => import('./pages/Projects.vue') },
      { path: 'users', name: 'users', component: () => import('./pages/account/Users.vue') },
      { path: 'tokens', name: 'tokens', component: () => import('./pages/account/Tokens.vue') },
      { path: 'audit-log', name: 'audit-log', component: () => import('./pages/account/AuditLog.vue') },
      { path: 'settings', name: 'settings', component: () => import('./pages/account/Settings.vue') },

      // Project-scoped routes.
      {
        path: 'p/:proj',
        children: [
          { path: '', redirect: (to) => `/p/${to.params['proj'] as string}/dashboards` },
          { path: 'dashboards', name: 'dashboards', component: () => import('./pages/project/Dashboards.vue') },
          { path: 'd/:dash', name: 'dashboard-view', component: () => import('./pages/project/DashboardView.vue') },
          { path: 'd/:dash/edit', name: 'dashboard-edit', component: () => import('./pages/project/DashboardEdit.vue') },
          { path: 'devices', name: 'devices', component: () => import('./pages/project/Devices.vue') },
          { path: 'automations', name: 'automations', component: () => import('./pages/project/Automations.vue') },
          { path: 'integrations', name: 'integrations', component: () => import('./pages/project/Integrations.vue') },
        ],
      },
    ],
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
