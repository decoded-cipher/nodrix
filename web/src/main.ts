import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { registerWidgets } from './widgets/register';
import './style.css';

registerWidgets();

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
