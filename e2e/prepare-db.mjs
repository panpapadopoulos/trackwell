// Fresh LOCAL D1 for browser tests: migrations + SYNTHETIC seed in .local/e2e-d1 (gitignored).
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
const run = (c) =>
  execSync(c, { stdio: 'inherit', env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } });
if (!existsSync('.dev.password')) run('node tools/dev-setup.mjs');
rmSync('.local/e2e-d1', { recursive: true, force: true });
run('npx wrangler d1 migrations apply trackwell --local --persist-to .local/e2e-d1');
run('npx tsx tools/seed-synthetic.ts');
run('npx wrangler d1 execute trackwell --local --persist-to .local/e2e-d1 --file .local/seed.sql');
