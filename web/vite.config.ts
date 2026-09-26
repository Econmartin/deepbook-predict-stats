import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  // GitHub Pages serves from /<repo>/; self-hosting serves from /.
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  server: { port: 5173, proxy: { '/data': 'http://localhost:8787' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
