import { describe, expect, it } from 'vitest';
import worker, { type Env } from './index';

const env = (origin: string): Env =>
  ({
    DB: {} as Env['DB'],
    ADMIN_PASSWORD_HASH: '',
    ALLOWED_ORIGIN: origin,
    ASSETS: {
      fetch: async () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }),
    },
  }) as Env;

describe('Worker entry (production behaviour)', () => {
  const prod = env('https://trackwell.example.com');

  it('redirects plain HTTP to HTTPS before serving anything', async () => {
    const r = await worker.fetch(new Request('http://trackwell.example.com/subtrack?x=1'), prod);
    expect(r.status).toBe(301);
    expect(r.headers.get('Location')).toBe('https://trackwell.example.com/subtrack?x=1');
  });

  it('serves pages with CSP, framing, sniffing, referrer, permissions and HSTS headers', async () => {
    const r = await worker.fetch(new Request('https://trackwell.example.com/'), prod);
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Security-Policy')).toMatch(/script-src 'self' 'sha256-/);
    expect(r.headers.get('X-Frame-Options')).toBe('DENY');
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(r.headers.get('Referrer-Policy')).toBe('same-origin');
    expect(r.headers.get('Permissions-Policy')).toContain('camera=()');
    expect(r.headers.get('Strict-Transport-Security')).toBe('max-age=31536000');
  });

  it('refuses API use when the admin secret is missing (no default password)', async () => {
    const r = await worker.fetch(new Request('https://trackwell.example.com/api/auth/session'), prod);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: 'server_misconfigured' });
  });

  it('local development (http origin) gets no redirect and no HSTS', async () => {
    const r = await worker.fetch(new Request('http://127.0.0.1:8787/'), env('http://127.0.0.1:5173'));
    expect(r.status).toBe(200);
    expect(r.headers.get('Strict-Transport-Security')).toBeNull();
  });
});
