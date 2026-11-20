/**
 * Screenshots of the LIVE local app (Worker + local D1 seeded with SYNTHETIC data).
 * Signs in with the local dev password from .dev.password (never printed).
 * Usage: node e2e/capture-live.mjs [baseUrl] [outDir]
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5173';
const out = process.argv[3] ?? '.local/screenshots/live';
mkdirSync(out, { recursive: true });
const password = readFileSync('.dev.password', 'utf8').trim();

const browser = await chromium.launch({ channel: 'chrome' });
async function session(width, height, theme) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    colorScheme: theme,
    reducedMotion: 'reduce',
  });
  await ctx.addInitScript((t) => localStorage.setItem('trackwell.theme', t), theme);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/');
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { level: 1, name: 'Overview' }).waitFor();
  return { ctx, page, errors };
}
const shot = async (page, name, full = false) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
  console.log(name);
};

{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto(base + '/');
  await page.getByLabel('Password').waitFor();
  await shot(page, 'login-dark-1440');
  await ctx.close();
}
const { ctx, page, errors } = await session(1600, 1000, 'dark');
await shot(page, 'overview-dark-1600');
for (const [path, name] of [
  ['/subtrack/assignments', 'assignments-dark-1600'],
  ['/subtrack/payments', 'payments-dark-1600'],
  ['/subtrack/calendar', 'calendar-dark-1600'],
  ['/expenses/transactions', 'transactions-dark-1600'],
  ['/expenses/budgets', 'budgets-dark-1600'],
  ['/subtrack/analytics', 'work-analytics-dark-1600'],
]) {
  await page.goto(base + path);
  await page.getByRole('heading', { level: 1 }).waitFor();
  await shot(page, name);
}
await page.goto(base + '/subtrack/assignments?new=1');
await page.getByRole('dialog').waitFor();
await page.getByRole('radio', { name: 'Multiple coverage' }).click();
await shot(page, 'editor-multiple-dark-1600');
await ctx.close();

const phone = await session(390, 844, 'light');
await phone.page.goto(base + '/subtrack/assignments?new=1');
await phone.page.getByRole('dialog').waitFor();
await phone.page.getByRole('radio', { name: 'Multiple coverage' }).click();
await shot(phone.page, 'editor-multiple-light-390', true);
await phone.ctx.close();
await browser.close();
if (errors.length) console.log('PAGE ERRORS:', errors.join(' | '));
