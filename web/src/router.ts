import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: () => import('./pages/Home.vue') },
  { path: '/setup', name: 'setup', component: () => import('./pages/Setup.vue') },
  {
    path: '/p/:proj',
    component: () => import('./pages/ProjectShell.vue'),
    children: [
      { path: '', redirect: (to) => `/p/${to.params['proj'] as string}/dashboards` },
      {
        path: 'dashboards',
        name: 'dashboard-list',
        component: () => import('./pages/DashboardList.vue'),
      },
      {
        path: 'd/:dash',
        name: 'dashboard-view',
        component: () => import('./pages/DashboardView.vue'),
      },
      {
        path: 'd/:dash/edit',
        name: 'dashboard-edit',
        component: () => import('./pages/DashboardEdit.vue'),
      },
      {
        path: 'admin/devices',
        name: 'admin-devices',
        component: () => import('./pages/admin/Devices.vue'),
      },
      {
        path: 'admin/tokens',
        name: 'admin-tokens',
        component: () => import('./pages/admin/Tokens.vue'),
      },
      {
        path: 'admin/settings',
        name: 'admin-settings',
        component: () => import('./pages/admin/ProjectSettings.vue'),
      },
    ],
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
