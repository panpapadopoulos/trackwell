/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // /api goes to the local Worker (wrangler dev on :8787). The Origin header is preserved for the CSRF check.
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: { '/api': { target: process.env.TRACKWELL_API ?? 'http://127.0.0.1:8787', changeOrigin: false } },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'worker/**/*.test.ts', 'tests/**/*.test.{ts,tsx}'],
    // Pin the zone the user actually lives in so date logic is tested where DST matters.
    env: { TZ: 'America/Chicago' },
  },
});
