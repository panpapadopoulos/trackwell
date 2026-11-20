/**
 * Login throttling. Failures are counted per client key (a hash of the
 * connecting IP) AND globally, so a distributed guesser is still capped.
 * Pure decision logic; persistence is a port (D1 `login_attempts` in production).
 */
export const WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_KEY = 5;
export const MAX_FAILURES_GLOBAL = 50;
export const LOCKOUT_MS = 15 * 60 * 1000;

export interface AttemptState {
  windowStart: number;
  failures: number;
  lockedUntil: number | null;
}

export interface AttemptStore {
  get(key: string): Promise<AttemptState | null>;
  set(key: string, state: AttemptState): Promise<void>;
  clear(key: string): Promise<void>;
}

export type Gate = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export function gate(state: AttemptState | null, now: number): Gate {
  if (state?.lockedUntil && now < state.lockedUntil)
    return { allowed: false, retryAfterSeconds: Math.ceil((state.lockedUntil - now) / 1000) };
  return { allowed: true };
}

export function recordFailure(state: AttemptState | null, now: number, limit: number): AttemptState {
  const fresh =
    !state ||
    now - state.windowStart >= WINDOW_MS ||
    (state.lockedUntil !== null && now >= state.lockedUntil);
  const next: AttemptState = fresh
    ? { windowStart: now, failures: 1, lockedUntil: null }
    : { ...state, failures: state.failures + 1 };
  if (next.failures >= limit) next.lockedUntil = now + LOCKOUT_MS;
  return next;
}

export class MemoryAttemptStore implements AttemptStore {
  readonly rows = new Map<string, AttemptState>();
  async get(k: string) {
    return this.rows.get(k) ?? null;
  }
  async set(k: string, s: AttemptState) {
    this.rows.set(k, s);
  }
  async clear(k: string) {
    this.rows.delete(k);
  }
}
