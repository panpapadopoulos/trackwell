import { beforeAll, describe, expect, it } from 'vitest';
import { handle, type Deps } from './app';
import { hashPassword, verifyPassword } from './auth/password';
import { IDLE_TIMEOUT_MS, MemorySessionStore, SESSION_COOKIE, validateSession } from './auth/session';
import { MAX_FAILURES_PER_KEY, MemoryAttemptStore } from './auth/rateLimit';

// Synthetic test-only credential, generated at runtime; not a real password.
const PASSWORD = `test-only-${Math.random().toString(36).slice(2)}-pw`;
const ORIGIN = 'https://trackwell.example.test';
let hash = '';
beforeAll(async () => {
  hash = await hashPassword(PASSWORD, 20_000); // fewer iterations keeps the suite fast; prod uses 100k
});

function deps(over: Partial<Deps> = {}): Deps & { clock: { t: number } } {
  const clock = { t: Date.UTC(2026, 10, 18, 15) };
  return {
    sessions: new MemorySessionStore(),
    attempts: new MemoryAttemptStore(),
    adminPasswordHash: hash,
    allowedOrigin: ORIGIN,
    now: () => clock.t,
    clock,
    ...over,
  };
}

const req = (
  path: string,
  init: RequestInit & { cookie?: string; csrf?: string; origin?: string | null } = {},
) => {
  const headers = new Headers(init.headers);
  if (init.origin !== null) headers.set('Origin', init.origin ?? ORIGIN);
  if (init.cookie) headers.set('Cookie', init.cookie);
  if (init.csrf) headers.set('X-CSRF-Token', init.csrf);
  headers.set('CF-Connecting-IP', '203.0.113.7');
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
};

async function login(d: Deps, password = PASSWORD) {
  const res = await handle(req('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }), d);
  const setCookie = res.headers.get('Set-Cookie') ?? '';
  const token = /__Host-tw_session=([^;]*)/.exec(setCookie)?.[1] ?? '';
  const body = (await res.json()) as { csrfToken?: string; error?: string };
  return { res, body, setCookie, cookie: `${SESSION_COOKIE}=${token}`, token, csrf: body.csrfToken ?? '' };
}

describe('password hashing', () => {
  it('verifies the right password, rejects others, and never stores plaintext', async () => {
    expect(hash.startsWith('pbkdf2-sha256$20000$')).toBe(true);
    expect(hash).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword(`${PASSWORD}x`, hash)).toBe(false);
    expect(await verifyPassword(PASSWORD, 'garbage')).toBe(false);
  });
  it('salts every hash', async () => {
    expect(await hashPassword(PASSWORD, 10_000)).not.toBe(await hashPassword(PASSWORD, 10_000));
  });
  it('rejects short passwords', async () => {
    await expect(hashPassword('short')).rejects.toThrow();
  });
});

describe('login + session cookie', () => {
  it('issues an opaque, HttpOnly, Secure, SameSite=Strict __Host- cookie that is not password-derived', async () => {
    const d = deps();
    const { res, setCookie, token } = await login(d);
    expect(res.status).toBe(200);
    expect(setCookie).toMatch(/^__Host-tw_session=/);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Strict');
    expect(token).not.toContain(btoa(PASSWORD).replace(/=+$/, ''));
    expect(token.length).toBeGreaterThanOrEqual(43);
    // the store holds only a hash of the token
    const stored = [...(d.sessions as MemorySessionStore).rows.keys()];
    expect(stored).not.toContain(token);
  });

  it('wrong password ⇒ 401 with a generic error', async () => {
    const { res, body } = await login(deps(), 'nope-nope-nope');
    expect(res.status).toBe(401);
    expect(body).toEqual({ error: 'invalid_credentials' });
  });

  it('locks out after repeated failures (429 + Retry-After), even with the right password', async () => {
    const d = deps();
    for (let i = 0; i < MAX_FAILURES_PER_KEY; i++) await login(d, 'wrong-password-123');
    const { res } = await login(d);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    d.clock.t += 16 * 60 * 1000; // after the lockout window
    expect((await login(d)).res.status).toBe(200);
  });
});

describe('API authorization is enforced by the backend', () => {
  it('rejects data requests without a session', async () => {
    const res = await handle(req('/api/v1/work-days', { method: 'GET' }), deps());
    expect(res.status).toBe(401);
  });
  it('rejects a forged / unknown session token', async () => {
    const res = await handle(req('/api/auth/session', { cookie: `${SESSION_COOKIE}=forged` }), deps());
    expect(res.status).toBe(401);
  });
  it('accepts a valid session', async () => {
    const d = deps();
    const { cookie } = await login(d);
    const res = await handle(req('/api/auth/session', { cookie }), d);
    expect(res.status).toBe(200);
  });
  it('expires idle sessions server-side', async () => {
    const d = deps();
    const { cookie, token } = await login(d);
    d.clock.t += IDLE_TIMEOUT_MS + 1;
    expect((await handle(req('/api/auth/session', { cookie }), d)).status).toBe(401);
    expect((await validateSession(d.sessions, token, d.clock.t)).ok).toBe(false);
  });
  it('logout revokes the session so the old cookie stops working', async () => {
    const d = deps();
    const { cookie, csrf } = await login(d);
    expect((await handle(req('/api/auth/logout', { method: 'POST', cookie, csrf }), d)).status).toBe(200);
    expect((await handle(req('/api/auth/session', { cookie }), d)).status).toBe(401);
  });
});

describe('CSRF protection', () => {
  it('rejects state-changing requests from another origin', async () => {
    const d = deps();
    const { cookie, csrf } = await login(d);
    const res = await handle(
      req('/api/auth/logout', { method: 'POST', cookie, csrf, origin: 'https://evil.example' }),
      d,
    );
    expect(res.status).toBe(403);
  });
  it('rejects state-changing requests without the per-session CSRF token', async () => {
    const d = deps();
    const { cookie } = await login(d);
    expect((await handle(req('/api/auth/logout', { method: 'POST', cookie }), d)).status).toBe(403);
  });
  it('rejects a login POST from another origin', async () => {
    const res = await handle(
      req('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password: PASSWORD }),
        origin: 'https://evil.example',
      }),
      deps(),
    );
    expect(res.status).toBe(403);
  });
});
