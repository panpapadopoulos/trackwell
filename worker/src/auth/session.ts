import { b64url, timingSafeEqual } from './password';

/**
 * Server-side sessions. The cookie carries a random 256-bit token; the server
 * stores only SHA-256(token), so a database leak can't be replayed as a cookie.
 * Expiry is enforced on the server: an idle timeout plus an absolute lifetime.
 * Logout (or "sign out everywhere") revokes rows; the cookie alone grants nothing.
 */
export const SESSION_COOKIE = '__Host-tw_session';
export const IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12 h without activity
export const ABSOLUTE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000; // 7 days max

export interface SessionRecord {
  tokenHash: string;
  csrfToken: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  revokedAt: number | null;
}

/** Storage port: an in-memory implementation for tests, D1 (`sessions` table) in production. */
export interface SessionStore {
  put(rec: SessionRecord): Promise<void>;
  get(tokenHash: string): Promise<SessionRecord | null>;
  touch(tokenHash: string, lastSeenAt: number): Promise<void>;
  revoke(tokenHash: string, at: number): Promise<void>;
  revokeAll(at: number): Promise<void>;
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return b64url(new Uint8Array(digest));
}

export async function createSession(
  store: SessionStore,
  now: number,
): Promise<{ token: string; record: SessionRecord }> {
  const token = randomToken();
  const record: SessionRecord = {
    tokenHash: await sha256(token),
    csrfToken: randomToken(),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + ABSOLUTE_LIFETIME_MS,
    revokedAt: null,
  };
  await store.put(record);
  return { token, record };
}

export type SessionCheck =
  | { ok: true; record: SessionRecord }
  | { ok: false; reason: 'missing' | 'unknown' | 'revoked' | 'expired' | 'idle' };

export async function validateSession(
  store: SessionStore,
  token: string | null,
  now: number,
): Promise<SessionCheck> {
  if (!token) return { ok: false, reason: 'missing' };
  const rec = await store.get(await sha256(token));
  if (!rec) return { ok: false, reason: 'unknown' };
  if (rec.revokedAt !== null) return { ok: false, reason: 'revoked' };
  if (now >= rec.expiresAt) return { ok: false, reason: 'expired' };
  if (now - rec.lastSeenAt >= IDLE_TIMEOUT_MS) return { ok: false, reason: 'idle' };
  await store.touch(rec.tokenHash, now);
  return { ok: true, record: { ...rec, lastSeenAt: now } };
}

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  // __Host- prefix forces Secure, Path=/, and no Domain (browsers treat http://localhost as secure).
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=') || null;
  }
  return null;
}

export function csrfMatches(expected: string, provided: string | null): boolean {
  if (!provided) return false;
  const enc = new TextEncoder();
  return timingSafeEqual(enc.encode(expected), enc.encode(provided));
}

export class MemorySessionStore implements SessionStore {
  readonly rows = new Map<string, SessionRecord>();
  async put(rec: SessionRecord) {
    this.rows.set(rec.tokenHash, { ...rec });
  }
  async get(h: string) {
    const r = this.rows.get(h);
    return r ? { ...r } : null;
  }
  async touch(h: string, t: number) {
    const r = this.rows.get(h);
    if (r) r.lastSeenAt = t;
  }
  async revoke(h: string, t: number) {
    const r = this.rows.get(h);
    if (r) r.revokedAt = t;
  }
  async revokeAll(t: number) {
    for (const r of this.rows.values()) r.revokedAt ??= t;
  }
}
