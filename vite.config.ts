import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.REVIEW_PORT ?? 5173),
    proxy: {
      '/api': `http://127.0.0.1:${process.env.APP_PORT ?? 4173}`,
    },
  },
});

