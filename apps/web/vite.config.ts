import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const rawBase = process.env.CLIENT_BASE_PATH ?? '';
const base = rawBase ? (rawBase.endsWith('/') ? rawBase : `${rawBase}/`) : '/';

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
