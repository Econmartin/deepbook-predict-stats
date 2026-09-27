import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  // GitHub Pages serves from /<repo>/; self-hosting serves from /.
  base: process.env.BASE_PATH || '/',
  plugins: [
    react(),
    {
      // Share tags need an absolute URL: SITE_URL at build time (e.g. the Pages URL or a custom domain).
      name: 'site-url',
      transformIndexHtml: (html) =>
        html
          .replaceAll('__SITE_URL__', (process.env.SITE_URL || '').replace(/\/?$/, '/'))
          .replaceAll('__BUILD__', String(Date.now())),
    },
  ],
  server: { port: 5173, proxy: { '/data': 'http://localhost:8787' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
