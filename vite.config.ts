import { defineConfig } from 'vite';

export default defineConfig({
  // relative asset paths: the build works from any sub-path (GitHub Pages serves it at /<repo>/)
  base: './',
  server: { port: 5173, open: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 6000 },
});
