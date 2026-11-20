/**
 * Screenshot capture for design review (synthetic data only).
 * Usage: node e2e/capture.mjs [baseUrl] [outDir]
 * Uses the locally installed Chrome (no browser download).
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:4173';
const out = process.argv[3] ?? '.local/screenshots';
mkdirSync(out, { recursive: true });

const shots = [
  { name: 'overview-dark-1440', path: '/', w: 1440, h: 900, theme: 'dark' },
  { name: 'subtrack-dark-1440', path: '/subtrack', w: 1440, h: 900, theme: 'dark', full: true },
  { name: 'expenses-dark-1440', path: '/expenses', w: 1440, h: 900, theme: 'dark', full: true },
  { name: 'schedule-dark-1440', path: '/subtrack/schedule', w: 1440, h: 900, theme: 'dark' },
  { name: 'overview-light-1440', path: '/', w: 1440, h: 900, theme: 'light' },
  { name: 'brand-dark-1440', path: '/brand', w: 1440, h: 900, theme: 'dark', full: true },
  { name: 'overview-dark-390', path: '/', w: 390, h: 844, theme: 'dark', full: true },
  { name: 'subtrack-light-390', path: '/subtrack', w: 390, h: 844, theme: 'light', full: true },
];

const browser = await chromium.launch({ channel: 'chrome' });
for (const s of shots) {
  const ctx = await browser.newContext({
    viewport: { width: s.w, height: s.h },
    deviceScaleFactor: 1,
    colorScheme: s.theme,
    reducedMotion: 'reduce',
  });
  await ctx.addInitScript((t) => localStorage.setItem('trackwell.theme', t), s.theme);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(base + s.path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${s.name}.png`, fullPage: Boolean(s.full) });
  console.log(`${s.name}.png${errors.length ? `  ERRORS: ${errors.join(' | ')}` : ''}`);
  await ctx.close();
}
await browser.close();
