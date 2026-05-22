import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  // Login lives outside the app shell.
  { path: '/login', name: 'login', component: () => import('./pages/Login.vue'), meta: { title: 'Sign in' } },
  // Back-compat redirect for any bookmarks that still point at /setup.
  { path: '/setup', redirect: '/login' },

  // Everything else is wrapped in the authenticated app shell.
  {
    path: '/',
    component: () => import('./layouts/AppShell.vue'),
    children: [
      { path: '', name: 'home', component: () => import('./pages/Home.vue'), meta: { title: 'Home' } },
      { path: 'projects', name: 'projects', component: () => import('./pages/Projects.vue'), meta: { title: 'Projects' } },
      { path: 'users', name: 'users', component: () => import('./pages/account/Users.vue'), meta: { title: 'Users' } },
      { path: 'tokens', name: 'tokens', component: () => import('./pages/account/Tokens.vue'), meta: { title: 'Tokens' } },
      { path: 'audit-log', name: 'audit-log', component: () => import('./pages/account/AuditLog.vue'), meta: { title: 'Audit log' } },
      { path: 'settings', name: 'settings', component: () => import('./pages/account/Settings.vue'), meta: { title: 'Settings' } },

      // Project-scoped routes.
      {
        path: 'p/:proj',
        children: [
          { path: '', redirect: (to) => `/p/${to.params['proj'] as string}/variables` },
          { path: 'dashboards', name: 'dashboards', component: () => import('./pages/project/Dashboards.vue'), meta: { title: 'Dashboards' } },
          { path: 'd/:dash', name: 'dashboard-view', component: () => import('./pages/project/DashboardView.vue'), meta: { title: 'Dashboard' } },
          { path: 'd/:dash/edit', name: 'dashboard-edit', component: () => import('./pages/project/DashboardEdit.vue'), meta: { title: 'Edit dashboard' } },
          { path: 'variables', name: 'variables', component: () => import('./pages/project/Variables.vue'), meta: { title: 'Variables' } },
          // Automations + Connections live under one hub with two tabs.
          {
            path: 'automations',
            component: () => import('./pages/project/automations/AutomationsHub.vue'),
            children: [
              { path: '', name: 'automations', component: () => import('./pages/project/automations/AutomationsList.vue'), meta: { title: 'Automations' } },
              { path: 'connections', name: 'connections', component: () => import('./pages/project/automations/Connections.vue'), meta: { title: 'Connections' } },
            ],
          },
          // Full-width editor, a sibling of the hub so it isn't constrained by the tab shell.
          { path: 'automations/editor/:id?', name: 'automation-editor', component: () => import('./pages/project/automations/AutomationEditor.vue'), meta: { title: 'Automation editor' } },
          // Back-compat for the old standalone Integrations route/bookmarks.
          { path: 'integrations', redirect: (to) => `/p/${to.params['proj'] as string}/automations/connections` },
        ],
      },
    ],
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
