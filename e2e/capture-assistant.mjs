/**
 * Phase 4 screenshots of the LIVE local app (Worker in MOCK assistant mode +
 * local D1 seeded with SYNTHETIC data). Signs in with .dev.password (never printed).
 * Usage: node e2e/capture-assistant.mjs [baseUrl] [outDir]
 * Leaves the local D1 as it found it: the day it saves is deleted at the end.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5173';
const out = process.argv[3] ?? '.local/screenshots/assistant';
mkdirSync(out, { recursive: true });
const password = readFileSync('.dev.password', 'utf8').trim();

const browser = await chromium.launch({ channel: 'chrome' });
const errors = [];
async function session(width, height, theme) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    colorScheme: theme,
    reducedMotion: 'reduce',
  });
  await ctx.addInitScript((t) => localStorage.setItem('trackwell.theme', t), theme);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/');
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { level: 1, name: 'Overview' }).waitFor();
  return { ctx, page };
}
const shot = async (page, name, full = true) => {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
  console.log(name);
};

/** Removes today's assistant-made day (if any) so the demo can be repeated. */
async function cleanup(page) {
  await page.evaluate(async () => {
    const s = await (await fetch('/api/auth/session')).json();
    const snap = await (await fetch('/api/v1/snapshot')).json();
    const today = snap.serverToday;
    for (const d of snap.workDays.filter(
      (w) => w.date === today && w.coverage.some((b) => b.teacherName === 'Mrs. Jones'),
    ))
      await fetch(`/api/v1/work-days/${d.id}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': s.csrfToken },
      });
  });
}

for (const [w, h, theme] of [
  [1440, 1000, 'dark'],
  [390, 844, 'light'],
]) {
  const { ctx, page } = await session(w, h, theme);
  await cleanup(page);
  const tag = `${theme}-${w}`;
  await page.goto(base + '/assistant');
  await page.getByRole('button', { name: 'Use the example' }).click();
  await shot(page, `p4-01-assistant-input-${tag}`, false);
  await page.getByRole('button', { name: 'Draft the work day' }).click();
  await page.getByRole('region', { name: 'Review before saving' }).waitFor({ timeout: 180_000 }); // genuine AI can take a while
  await shot(page, `p4-02-draft-and-trace-${tag}`);
  if (w > 1000) {
    await page.getByRole('button', { name: 'Edit before saving' }).click();
    await page.getByRole('dialog').waitFor();
    await shot(page, `p4-03-edit-draft-${tag}`, false);
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  }
  await page.getByRole('button', { name: 'Save work day' }).click();
  await page.getByRole('region', { name: 'Saved and verified' }).waitFor({ timeout: 60_000 });
  await shot(page, `p4-04-saved-verified-${tag}`);
  await page.goto(base + '/subtrack/assignments');
  await page.getByLabel('Search').fill('Mrs. Jones');
  await page.getByText('1 work day').waitFor();
  await shot(page, `p4-05-in-assignments-${tag}`, false);
  await page.goto(base + '/assistant');
  await page.getByRole('radio', { name: 'Ask about money' }).click();
  await page.getByLabel('Your question').fill('How much did I spend last month?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.getByRole('region', { name: 'Answer' }).waitFor({ timeout: 180_000 });
  await shot(page, `p4-06-finance-answer-${tag}`);
  if (w > 1000) {
    await page.goto(base + '/settings');
    await page.getByRole('region', { name: 'Employment defaults' }).waitFor();
    await shot(page, `p4-07-settings-defaults-${tag}`);
  }
  await cleanup(page);
  await ctx.close();
}
await browser.close();
if (errors.length) {
  console.error('page errors:', errors);
  process.exit(1);
}
