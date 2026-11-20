import { v1 } from './api/v1';
import type { D1Like } from './db';
import type { AiDeps } from './ai/deps';
import { verifyPassword } from './auth/password';
import {
  ABSOLUTE_LIFETIME_MS,
  clearedSessionCookie,
  createSession,
  csrfMatches,
  readCookie,
  SESSION_COOKIE,
  sha256,
  validateSession,
  type SessionStore,
} from './auth/session';
import {
  gate,
  MAX_FAILURES_GLOBAL,
  MAX_FAILURES_PER_KEY,
  recordFailure,
  type AttemptStore,
} from './auth/rateLimit';

/**
 * Request handling for the Trackwell API, written against storage ports so it
 * runs identically in unit tests (in-memory) and in the Worker (D1).
 * Phase 2 implements the auth boundary; data routes are stubs that prove the
 * boundary (authorization is enforced HERE, never by hiding UI routes).
 */
export interface Deps {
  sessions: SessionStore;
  attempts: AttemptStore;
  /** Worker secret: PBKDF2 hash of the single administrator password. */
  adminPasswordHash: string;
  /** Exact origin allowed to make state-changing requests, e.g. https://trackwell.panagiotispapadopoulos.com */
  allowedOrigin: string;
  now: () => number;
  /** D1 binding. Absent only in auth-only unit tests (data routes then answer 501). */
  db?: D1Like;
  newId?: () => string;
  /** Assistant (model + limits). Absent ⇒ assistant routes answer 503. */
  ai?: AiDeps;
}

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...SECURITY_HEADERS, ...extra } });
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** CSRF layer 1: state-changing requests must come from our own origin. */
function sameOrigin(req: Request, allowed: string): boolean {
  const origin = req.headers.get('Origin');
  if (origin) return origin === allowed;
  // Some same-origin requests omit Origin; fall back to Fetch Metadata.
  return req.headers.get('Sec-Fetch-Site') === 'same-origin';
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const url = new URL(req.url);
  const now = deps.now();
  if (!url.pathname.startsWith('/api/')) return json(404, { error: 'not_found' });

  if (UNSAFE.has(req.method) && !sameOrigin(req, deps.allowedOrigin))
    return json(403, { error: 'bad_origin' });

  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    const clientKey = await sha256(req.headers.get('CF-Connecting-IP') ?? 'unknown');
    const [perKey, global] = await Promise.all([deps.attempts.get(clientKey), deps.attempts.get('global')]);
    for (const g of [gate(perKey, now), gate(global, now)])
      if (!g.allowed)
        return json(429, { error: 'too_many_attempts' }, { 'Retry-After': String(g.retryAfterSeconds) });

    let body: { password?: unknown };
    try {
      body = (await req.json()) as { password?: unknown };
    } catch {
      return json(400, { error: 'bad_request' });
    }
    const password = typeof body.password === 'string' ? body.password : '';
    if (!password || !(await verifyPassword(password, deps.adminPasswordHash))) {
      await deps.attempts.set(clientKey, recordFailure(perKey, now, MAX_FAILURES_PER_KEY));
      await deps.attempts.set('global', recordFailure(global, now, MAX_FAILURES_GLOBAL));
      return json(401, { error: 'invalid_credentials' }); // same message for every failure
    }
    await deps.attempts.clear(clientKey);
    const { token, record } = await createSession(deps.sessions, now);
    return json(
      200,
      { csrfToken: record.csrfToken, expiresAt: record.expiresAt },
      {
        'Set-Cookie': `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ABSOLUTE_LIFETIME_MS / 1000}`,
      },
    );
  }

  // Everything below requires a valid server-side session.
  const token = readCookie(req.headers.get('Cookie'), SESSION_COOKIE);
  const session = await validateSession(deps.sessions, token, now);
  if (!session.ok) return json(401, { error: 'unauthenticated' }, { 'Set-Cookie': clearedSessionCookie() });

  // CSRF layer 2: per-session token in a custom header (can't be set cross-site without CORS).
  if (UNSAFE.has(req.method) && !csrfMatches(session.record.csrfToken, req.headers.get('X-CSRF-Token')))
    return json(403, { error: 'bad_csrf' });

  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    await deps.sessions.revoke(session.record.tokenHash, now);
    return json(200, { ok: true }, { 'Set-Cookie': clearedSessionCookie() });
  }
  if (url.pathname === '/api/auth/session' && req.method === 'GET') {
    return json(200, {
      authenticated: true,
      csrfToken: session.record.csrfToken,
      expiresAt: session.record.expiresAt,
    });
  }
  if (url.pathname.startsWith('/api/v1/')) {
    if (!deps.db) return json(501, { error: 'not_implemented' });
    return v1(
      {
        db: deps.db,
        now: deps.now,
        newId: deps.newId ?? (() => crypto.randomUUID()),
        ...(deps.ai ? { ai: deps.ai } : {}),
      },
      req,
    );
  }
  return json(404, { error: 'not_found' });
}
