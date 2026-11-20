import { defineConfig } from '@playwright/test';

/**
 * Browser tests against the REAL local stack: the production build (vite preview)
 * proxying /api to wrangler dev with a fresh local D1 seeded with SYNTHETIC data.
 * Uses the installed Chrome. Serial: tests share one database and clean up after themselves.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: /.*\.spec\.ts/,
  reporter: [['list']],
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:4174', channel: 'chrome', reducedMotion: 'reduce' },
  webServer: [
    {
      command:
        'node e2e/prepare-db.mjs && npx wrangler dev --local --port 8788 --ip 127.0.0.1 --persist-to .local/e2e-d1 --var ALLOWED_ORIGIN:http://127.0.0.1:4174',
      url: 'http://127.0.0.1:8788/api/auth/session',
      reuseExistingServer: false,
      timeout: 240_000,
      env: { CI: '1', WRANGLER_SEND_METRICS: 'false' },
    },
    {
      command: 'npx vite preview --port 4174 --strictPort --host 127.0.0.1',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: false,
      env: { TRACKWELL_API: 'http://127.0.0.1:8788' },
    },
  ],
});
