import type { D1Like } from './db';
import type { AttemptState, AttemptStore } from './auth/rateLimit';
import type { SessionRecord, SessionStore } from './auth/session';

type SessionRow = {
  token_hash: string;
  csrf_token: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  revoked_at: number | null;
};

export class D1SessionStore implements SessionStore {
  constructor(private db: D1Like) {}
  async put(r: SessionRecord) {
    await this.db
      .prepare(
        'INSERT INTO sessions (token_hash, csrf_token, created_at, last_seen_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(r.tokenHash, r.csrfToken, r.createdAt, r.lastSeenAt, r.expiresAt, r.revokedAt)
      .run();
  }
  async get(hash: string): Promise<SessionRecord | null> {
    const r = await this.db
      .prepare('SELECT * FROM sessions WHERE token_hash = ?')
      .bind(hash)
      .first<SessionRow>();
    return r
      ? {
          tokenHash: r.token_hash,
          csrfToken: r.csrf_token,
          createdAt: r.created_at,
          lastSeenAt: r.last_seen_at,
          expiresAt: r.expires_at,
          revokedAt: r.revoked_at,
        }
      : null;
  }
  async touch(hash: string, t: number) {
    await this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').bind(t, hash).run();
  }
  async revoke(hash: string, t: number) {
    await this.db
      .prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
      .bind(t, hash)
      .run();
  }
  async revokeAll(t: number) {
    await this.db.prepare('UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL').bind(t).run();
  }
}

export class D1AttemptStore implements AttemptStore {
  constructor(private db: D1Like) {}
  async get(key: string): Promise<AttemptState | null> {
    const r = await this.db
      .prepare('SELECT window_start, failures, locked_until FROM login_attempts WHERE client_key = ?')
      .bind(key)
      .first<{ window_start: number; failures: number; locked_until: number | null }>();
    return r ? { windowStart: r.window_start, failures: r.failures, lockedUntil: r.locked_until } : null;
  }
  async set(key: string, s: AttemptState) {
    await this.db
      .prepare(
        `INSERT INTO login_attempts (client_key, window_start, failures, locked_until) VALUES (?, ?, ?, ?)
         ON CONFLICT (client_key) DO UPDATE SET window_start = excluded.window_start, failures = excluded.failures, locked_until = excluded.locked_until`,
      )
      .bind(key, s.windowStart, s.failures, s.lockedUntil)
      .run();
  }
  async clear(key: string) {
    await this.db.prepare('DELETE FROM login_attempts WHERE client_key = ?').bind(key).run();
  }
}
