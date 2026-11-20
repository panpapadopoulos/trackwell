import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CSP, THEME_SCRIPT_HASH } from './csp';

describe('Content-Security-Policy', () => {
  it('allows exactly the inline theme script in index.html (no unsafe-inline scripts)', () => {
    const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    expect(scripts).toHaveLength(1);
    const hash = `sha256-${createHash('sha256').update(scripts[0]!).digest('base64')}`;
    expect(hash).toBe(THEME_SCRIPT_HASH);
    expect(CSP).toContain(`'${hash}'`);
    expect(CSP).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(CSP).toContain("frame-ancestors 'none'");
  });
});
