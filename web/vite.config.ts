import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

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
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
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
