/**
 * break-ui run: every dashboard × data state × width. Captures screenshots and
 * measures overflow (page-level horizontal scroll, and elements whose content
 * overflows their own box without being an intentional scroller/truncation).
 * Usage: node e2e/break.mjs [baseUrl]
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:4173';
const out = '.local/screenshots/break';
mkdirSync(out, { recursive: true });

const pages = ['/', '/subtrack', '/expenses', '/subtrack/schedule'];
const states = ['worst-case', 'one', 'empty', 'error', 'loading'];
const widths = [360, 720, 1920];

const browser = await chromium.launch({ channel: 'chrome' });
const findings = [];
for (const state of states)
  for (const w of widths) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: 900 },
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const p of pages) {
      await page.goto(`${base}${p}?data=${state}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(150);
      const m = await page.evaluate(() => {
        const doc = document.documentElement;
        const pageOverflow = doc.scrollWidth - window.innerWidth;
        const bad = [];
        for (const el of document.querySelectorAll('main *')) {
          const cs = getComputedStyle(el);
          if (['auto', 'scroll', 'hidden', 'clip'].includes(cs.overflowX) || cs.textOverflow === 'ellipsis')
            continue;
          if (el.closest('svg') || el.closest('.recharts-wrapper')) continue;
          const parent = el.parentElement;
          if (!parent) continue;
          const pr = parent.getBoundingClientRect();
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.right > pr.right + 2 && getComputedStyle(parent).overflowX === 'visible') {
            const text = (el.textContent || '').trim().slice(0, 40);
            bad.push(`${el.tagName.toLowerCase()} "${text}" +${Math.round(r.right - pr.right)}px`);
          }
        }
        return { pageOverflow, bad: [...new Set(bad)].slice(0, 6) };
      });
      const name = `${state}-${w}${p.replaceAll('/', '_') || '_'}`;
      await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
      if (m.pageOverflow > 0 || m.bad.length || errors.length)
        findings.push(`${name}: pageOverflow=${m.pageOverflow}px ${m.bad.join(' | ')} ${errors.join(' | ')}`);
    }
    await ctx.close();
  }
await browser.close();
console.log(findings.length ? findings.join('\n') : 'no overflow or runtime errors measured');
