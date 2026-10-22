/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server can proxy /api to the Python backend so the browser talks to
// one origin. Set VITE_DEV_PROXY_TARGET (e.g. http://127.0.0.1:8010) to enable it.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const proxyTarget = env.VITE_DEV_PROXY_TARGET;
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: proxyTarget ? { '/api': { target: proxyTarget, changeOrigin: true } } : undefined,
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  };
});
