import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { registerWidgets } from './widgets/register';
import { onUnauthorized } from './api';
import { progress } from './lib/progress';
import { useThemeStore } from './stores/theme';
import { useAccentStore } from './stores/accent';
import './style.css';

registerWidgets();

const app = createApp(App);
app.use(createPinia());
app.use(router);

useThemeStore().init();
useAccentStore().init();

// On any 401, bounce to /login (unless we're already there).
onUnauthorized(() => {
  if (router.currentRoute.value.name !== 'login') {
    router.replace('/login');
  }
});

router.beforeEach((_to, _from, next) => {
  progress.start();
  next();
});
router.afterEach((to) => {
  progress.done();
  const title = to.meta['title'] as string | undefined;
  document.title = title ? `${title} · nodrix` : 'nodrix — your own IoT cloud, on Cloudflare';
});
router.onError(() => {
  progress.done();
});

app.mount('#app');
