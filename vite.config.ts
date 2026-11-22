import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// One build, three pages: the welcome page is tiny; the game and the builder load only when they are opened.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2600,
    rollupOptions: {
      input: {
        welcome: fileURLToPath(new URL('./index.html', import.meta.url)),
        play: fileURLToPath(new URL('./play/index.html', import.meta.url)),
        build: fileURLToPath(new URL('./build/index.html', import.meta.url)),
      },
    },
  },
});
