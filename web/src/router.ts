import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useSessionStore } from './stores/session';

const routes: RouteRecordRaw[] = [
  // Login lives outside the app shell.
  { path: '/login', name: 'login', component: () => import('./pages/Login.vue'), meta: { title: 'Sign in' } },
  // Invite acceptance — public, outside the app shell.
  { path: '/invite/:token', name: 'invite', component: () => import('./pages/Invite.vue'), meta: { title: 'Accept invite' } },
  // Back-compat redirect for any bookmarks that still point at /setup.
  { path: '/setup', redirect: '/login' },

  // Public dashboard viewer — no auth, outside the app shell. /share is a
  // standalone page; /embed is the chrome-stripped, iframe-able variant.
  { path: '/share/:token', name: 'public-share', component: () => import('./pages/public/PublicDashboard.vue'), meta: { title: 'Dashboard' } },
  { path: '/embed/:token', name: 'public-embed', component: () => import('./pages/public/PublicDashboard.vue'), meta: { title: 'Dashboard' } },

  // Everything else is wrapped in the authenticated app shell.
  {
    path: '/',
    component: () => import('./layouts/AppShell.vue'),
    children: [
      { path: '', name: 'home', component: () => import('./pages/Home.vue'), meta: { title: 'Home' } },
      { path: 'projects', name: 'projects', component: () => import('./pages/Projects.vue'), meta: { title: 'Projects' } },
      { path: 'users', name: 'users', component: () => import('./pages/account/Users.vue'), meta: { title: 'Users', roles: ['owner', 'admin'] } },
      { path: 'tokens', name: 'tokens', component: () => import('./pages/account/Tokens.vue'), meta: { title: 'Tokens', roles: ['owner', 'admin'] } },
      { path: 'audit-log', name: 'audit-log', component: () => import('./pages/account/AuditLog.vue'), meta: { title: 'Audit log', roles: ['owner'] } },
      { path: 'settings', name: 'settings', component: () => import('./pages/account/Settings.vue'), meta: { title: 'Settings' } },

      // Project-scoped routes.
      {
        path: 'p/:proj',
        children: [
          { path: '', redirect: (to) => `/p/${to.params['proj'] as string}/variables` },
          { path: 'dashboards', name: 'dashboards', component: () => import('./pages/project/Dashboards.vue'), meta: { title: 'Dashboards' } },
          { path: 'd/:dash', name: 'dashboard-view', component: () => import('./pages/project/DashboardView.vue'), meta: { title: 'Dashboard' } },
          { path: 'd/:dash/edit', name: 'dashboard-edit', component: () => import('./pages/project/DashboardEdit.vue'), meta: { title: 'Edit dashboard' } },
          // Variables + Connection tokens live under one hub with two tabs.
          {
            path: 'variables',
            component: () => import('./pages/project/variables/VariablesHub.vue'),
            children: [
              { path: '', name: 'variables', component: () => import('./pages/project/variables/VariablesList.vue'), meta: { title: 'Variables' } },
              { path: 'tokens', name: 'variable-tokens', component: () => import('./pages/project/variables/ConnectionTokens.vue'), meta: { title: 'Connection tokens' } },
            ],
          },
          // Automations + Integrations live under one hub with two tabs.
          {
            path: 'automations',
            component: () => import('./pages/project/automations/AutomationsHub.vue'),
            children: [
              { path: '', name: 'automations', component: () => import('./pages/project/automations/AutomationsList.vue'), meta: { title: 'Automations' } },
              { path: 'integrations', name: 'integrations', component: () => import('./pages/project/automations/Integrations.vue'), meta: { title: 'Integrations' } },
              // Back-compat for the old Connections tab URL.
              { path: 'connections', redirect: (to) => `/p/${to.params['proj'] as string}/automations/integrations` },
            ],
          },
          // Full-width editor, a sibling of the hub so it isn't constrained by the tab shell.
          { path: 'automations/editor/:id?', name: 'automation-editor', component: () => import('./pages/project/automations/AutomationEditor.vue'), meta: { title: 'Automation editor' } },
          // Back-compat for the old standalone Integrations route/bookmarks.
          { path: 'integrations', redirect: (to) => `/p/${to.params['proj'] as string}/automations/integrations` },
        ],
      },
    ],
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

// Role gate: routes can declare `meta.roles`. Members can't reach Users / API
// tokens; only the owner reaches the audit log. The backend enforces this too —
// this just keeps the UI honest on direct navigation. Falls through to '/' when
// the signed-in user's role isn't allowed.
router.beforeEach(async (to) => {
  const roles = to.meta['roles'] as string[] | undefined;
  if (!roles) return true;

  const session = useSessionStore();
  if (!session.user) {
    try { await session.load(); } catch { /* unauthenticated — AppShell redirects to /login */ }
  }
  const role = session.user?.role;
  if (role && !roles.includes(role)) return { path: '/' };
  return true;
});
