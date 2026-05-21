import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://nodrix.live',
  vite: {
    plugins: [tailwindcss()],
  },
});
