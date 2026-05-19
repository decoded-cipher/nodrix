import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { registerWidgets } from './widgets/register';
import { onUnauthorized } from './api';
import { progress } from './lib/progress';
import './style.css';

registerWidgets();

const app = createApp(App);
app.use(createPinia());
app.use(router);

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
router.afterEach(() => {
  progress.done();
});
router.onError(() => {
  progress.done();
});

app.mount('#app');
