import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          // Treat <iot-*> tags as native custom elements, not Vue components.
          isCustomElement: (tag) => tag.startsWith('iot-'),
        },
      },
    }),
    tailwindcss(),
    // Installable PWA — generates + auto-registers the service worker; the
    // manifest stays in public/site.webmanifest, so the plugin only owns the SW.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // og.png is only for social scrapers — no need to precache it offline.
        globIgnores: ['**/og.png'],
        navigateFallback: '/index.html',
        // Never hijack worker-rendered routes with the SPA fallback.
        navigateFallbackDenylist: [/^\/v1/, /^\/ws/, /^\/authorize/, /^\/\.well-known\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Don't ship full source maps to production (smaller deploy, no source
    // exposure). Flip to true locally when you need to debug a prod build.
    sourcemap: false,
    rollupOptions: {
      output: {
        // Split the stable framework deps into their own long-cached chunks so
        // an app-code change doesn't bust them. apexcharts/leaflet are NOT listed
        // here on purpose — they're dynamically imported and must stay lazy.
        manualChunks: {
          vendor: ['vue', 'vue-router', 'pinia'],
          ui: ['reka-ui'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // During dev, proxy API + WS to the local wrangler dev server.
      '/v1': 'http://localhost:8787',
      '/ws': {
        target: 'ws://localhost:8787',
        ws: true,
      },
    },
  },
});
