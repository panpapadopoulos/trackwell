/** API integration tests: real handler + real migrations on SQLite. Synthetic data only. */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handle, type Deps } from '../app';
import { hashPassword } from '../auth/password';
import { SESSION_COOKIE } from '../auth/session';
import { D1AttemptStore, D1SessionStore } from '../stores';
import { migratedDb } from '../../../tests/support/sqliteD1';
import type { Snapshot } from '../../../src/shared/snapshot';

const ORIGIN = 'http://127.0.0.1:5173';
const PASSWORD = `test-only-${Math.random().toString(36).slice(2)}-pw`;
let HASH = '';
beforeAll(async () => {
  HASH = await hashPassword(PASSWORD, 10_000);
});

let deps: Deps;
let raw: ReturnType<typeof migratedDb>['raw'];
let clock: number;
let seq = 0;
let auth: { cookie: string; csrf: string };

beforeEach(async () => {
  const m = migratedDb();
  raw = m.raw;
  clock = Date.UTC(2026, 10, 18, 18);
  deps = {
    db: m.db,
    sessions: new D1SessionStore(m.db),
    attempts: new D1AttemptStore(m.db),
    adminPasswordHash: HASH,
    allowedOrigin: ORIGIN,
    now: () => clock++,
    newId: () => `id-${++seq}`,
  };
  const res = await call('POST', '/api/auth/login', { password: PASSWORD }, false);
  const token = /__Host-tw_session=([^;]*)/.exec(res.headers.get('Set-Cookie') ?? '')![1]!;
  auth = {
    cookie: `${SESSION_COOKIE}=${token}`,
    csrf: ((await res.json()) as { csrfToken: string }).csrfToken,
  };
});

async function call(method: string, path: string, body?: unknown, authed = true) {
  const headers = new Headers({ Origin: ORIGIN, 'Content-Type': 'application/json' });
  if (authed) {
    headers.set('Cookie', auth.cookie);
    headers.set('X-CSRF-Token', auth.csrf);
  }
  const withBody = body !== undefined && method !== 'GET';
  return handle(
    new Request(`${ORIGIN}${path}`, { method, headers, ...(withBody ? { body: JSON.stringify(body) } : {}) }),
    deps,
  );
}
const ok = async <T>(r: Response, status = 200) => {
  if (r.status !== status) throw new Error(`expected ${status}, got ${r.status}: ${await r.text()}`);
  return (await r.json()) as T;
};
const snap = async () => ok<Snapshot>(await call('GET', '/api/v1/snapshot'));

const permanentDay = {
  date: '2026-11-18',
  employmentType: 'permanent',
  role: 'teacher',
  format: 'multiple',
  schoolName: 'Munster High School',
  district: 'Munster',
  dayType: 1,
  startTime: '07:15',
  endTime: '14:50',
  hours: 7.58,
  scheduleId: 'mhs-2026-27-a-block',
  lunchVariant: 'B',
  coverage: [
    { periodId: 'P1', status: 'covered', teacherName: 'Teacher A', room: 'N161', subject: 'Biology' },
    { periodId: 'P3', status: 'free' },
    { periodId: 'P5a-B', status: 'covered', teacherName: 'Teacher B', room: 'N204' },
    { periodId: 'P7', status: 'planning' },
  ],
};

describe('authorization', () => {
  for (const [m, p] of [
    ['GET', '/api/v1/snapshot'],
    ['POST', '/api/v1/work-days'],
    ['PUT', '/api/v1/work-days/x'],
    ['DELETE', '/api/v1/expenses/x'],
    ['POST', '/api/v1/recurring/sync'],
    ['PUT', '/api/v1/budgets'],
  ] as const)
    it(`${m} ${p} requires a session`, async () => {
      expect((await call(m, p, {}, false)).status).toBe(401);
    });

  it('a valid session without the CSRF header cannot write', async () => {
    const headers = new Headers({ Origin: ORIGIN, Cookie: auth.cookie, 'Content-Type': 'application/json' });
    const r = await handle(
      new Request(`${ORIGIN}/api/v1/payments`, { method: 'POST', headers, body: '{}' }),
      deps,
    );
    expect(r.status).toBe(403);
  });

  it('sessions live in D1 and only as a hash', () => {
    const rows = raw.prepare('SELECT token_hash FROM sessions').all() as Array<{ token_hash: string }>;
    expect(rows).toHaveLength(1);
    expect(auth.cookie).not.toContain(rows[0]!.token_hash);
  });

  it('failed logins are rate-limited through D1', async () => {
    for (let i = 0; i < 5; i++)
      await call('POST', '/api/auth/login', { password: 'wrong-password-xyz' }, false);
    expect((await call('POST', '/api/auth/login', { password: PASSWORD }, false)).status).toBe(429);
  });
});

describe('work days and multiple coverage', () => {
  it('creates a multiple-coverage day atomically, computes pay ONCE, and returns it in the snapshot', async () => {
    const { id } = await ok<{ id: string }>(await call('POST', '/api/v1/work-days', permanentDay), 201);
    const s = await snap();
    const d = s.workDays.find((w) => w.id === id)!;
    expect(d.coverage.map((b) => b.periodId)).toEqual(['P1', 'P3', 'P5a-B', 'P7']);
    const row = raw
      .prepare('SELECT expected_net_cents, expected_gross_cents FROM work_days WHERE id = ?')
      .get(id) as Record<string, number>;
    expect(row).toEqual({ expected_net_cents: 11427, expected_gross_cents: 13000 });
  });

  it('refuses a second permanent day on the same date (409) and leaves the first intact', async () => {
    await call('POST', '/api/v1/work-days', permanentDay);
    const r = await call('POST', '/api/v1/work-days', {
      ...permanentDay,
      coverage: [{ periodId: 'P1', status: 'covered' }],
    });
    expect(r.status).toBe(409);
    expect((await snap()).workDays).toHaveLength(1);
    expect((raw.prepare('SELECT count(*) AS n FROM coverage_blocks').get() as { n: number }).n).toBe(4);
  });

  it('validates input with field-level messages (422)', async () => {
    const r = await call('POST', '/api/v1/work-days', {
      ...permanentDay,
      date: '2026-02-30',
      startTime: '25:00',
      coverage: [],
    });
    expect(r.status).toBe(422);
    const b = (await r.json()) as { fields: Record<string, string> };
    expect(Object.keys(b.fields)).toEqual(expect.arrayContaining(['date', 'startTime', 'coverage']));
  });

  it('updates with the current version; a stale version gets 409 and changes nothing', async () => {
    const { id, updatedAt } = await ok<{ id: string; updatedAt: number }>(
      await call('POST', '/api/v1/work-days', permanentDay),
      201,
    );
    const changed = {
      ...permanentDay,
      coverage: [{ periodId: 'P1', status: 'covered', teacherName: 'Teacher C' }],
      updatedAt,
    };
    const v2 = await ok<{ updatedAt: number }>(await call('PUT', `/api/v1/work-days/${id}`, changed));
    expect(v2.updatedAt).toBeGreaterThan(updatedAt);
    const stale = await call('PUT', `/api/v1/work-days/${id}`, { ...permanentDay, updatedAt });
    expect(stale.status).toBe(409);
    const d = (await snap()).workDays[0]!;
    expect(d.coverage).toHaveLength(1);
    expect(d.coverage[0]!.teacherName).toBe('Teacher C');
  });

  it('deletes softly (gone from the app, kept in the database and audit log)', async () => {
    const { id } = await ok<{ id: string }>(await call('POST', '/api/v1/work-days', permanentDay), 201);
    await ok(await call('DELETE', `/api/v1/work-days/${id}`));
    expect((await snap()).workDays).toHaveLength(0);
    expect(raw.prepare('SELECT deleted_at FROM work_days WHERE id = ?').get(id)).not.toBeNull();
    const actions = (
      raw.prepare('SELECT action FROM audit_log WHERE entity_id = ? ORDER BY id').all(id) as Array<{
        action: string;
      }>
    ).map((a) => a.action);
    expect(actions).toEqual(['create', 'delete']);
    expect((await call('DELETE', `/api/v1/work-days/${id}`)).status).toBe(404);
  });
});

describe('payments and payday overrides', () => {
  it('records payments and manual payday overrides', async () => {
    await ok(
      await call('POST', '/api/v1/payments', { date: '2026-11-20', district: 'Munster', amountCents: 50000 }),
      201,
    );
    await ok(await call('PUT', '/api/v1/pay-periods/2026-11-16', { payday: '2026-12-03', note: 'Holiday' }));
    const s = await snap();
    expect(s.payments[0]!.amountCents).toBe(50000);
    expect(s.payPeriodOverrides).toEqual([
      { periodStart: '2026-11-16', payday: '2026-12-03', note: 'Holiday' },
    ]);
    expect(
      (await call('POST', '/api/v1/payments', { date: '2026-11-20', district: 'Munster', amountCents: 12.5 }))
        .status,
    ).toBe(422);
  });
});

describe('expenses', () => {
  async function seedRefs() {
    const c = await ok<{ id: string }>(
      await call('POST', '/api/v1/categories', { name: 'Groceries', color: '#4f9d69' }),
      201,
    );
    const m = await ok<{ id: string }>(
      await call('POST', '/api/v1/payment-methods', { name: 'Debit card', type: 'Debit card' }),
      201,
    );
    return { c: c.id, m: m.id };
  }

  it('stores hostile text literally (parameterized SQL)', async () => {
    const { c, m } = await seedRefs();
    const merchant = `Bobby'); DROP TABLE expenses;--`;
    await ok(
      await call('POST', '/api/v1/expenses', {
        date: '2026-11-10',
        merchant,
        amountCents: 1234,
        categoryId: c,
        paymentMethodId: m,
      }),
      201,
    );
    expect((await snap()).expenses[0]!.merchant).toBe(merchant);
  });

  it('rejects references to categories that do not exist', async () => {
    const { m } = await seedRefs();
    const r = await call('POST', '/api/v1/expenses', {
      date: '2026-11-10',
      merchant: 'X',
      amountCents: 100,
      categoryId: 'nope',
      paymentMethodId: m,
    });
    expect(r.status).toBe(422);
  });

  it('archives categories instead of deleting (old expenses keep their category)', async () => {
    const { c, m } = await seedRefs();
    await call('POST', '/api/v1/expenses', {
      date: '2026-11-10',
      merchant: 'X',
      amountCents: 100,
      categoryId: c,
      paymentMethodId: m,
    });
    await ok(await call('DELETE', `/api/v1/categories/${c}`));
    const s = await snap();
    expect(s.categories.find((x) => x.id === c)?.archived).toBe(true);
    expect(s.expenses[0]!.categoryId).toBe(c);
  });

  it('recurring sync is idempotent and never resurrects a deleted occurrence', async () => {
    const { c, m } = await seedRefs();
    await ok(
      await call('POST', '/api/v1/recurring', {
        merchant: 'Phone',
        amountCents: 4500,
        categoryId: c,
        paymentMethodId: m,
        frequency: 'monthly',
        startDate: '2026-09-05',
      }),
      201,
    );
    const first = await ok<{ created: number }>(await call('POST', '/api/v1/recurring/sync'));
    expect(first.created).toBe(3); // Sep 5, Oct 5, Nov 5 (server today 2026-11-18)
    expect((await ok<{ created: number }>(await call('POST', '/api/v1/recurring/sync'))).created).toBe(0);
    const oct = (await snap()).expenses.find((e) => e.date === '2026-10-05')!;
    await ok(await call('DELETE', `/api/v1/expenses/${oct.id}`));
    expect((await ok<{ created: number }>(await call('POST', '/api/v1/recurring/sync'))).created).toBe(0);
    expect((await snap()).expenses.map((e) => e.date)).toEqual(['2026-09-05', '2026-11-05']);
  });

  it('budgets upsert per (month, category) and delete at $0', async () => {
    const { c } = await seedRefs();
    await ok(await call('PUT', '/api/v1/budgets', { month: '*', categoryId: null, amountCents: 140000 }));
    await ok(await call('PUT', '/api/v1/budgets', { month: '*', categoryId: null, amountCents: 150000 }));
    await ok(await call('PUT', '/api/v1/budgets', { month: '2026-11', categoryId: c, amountCents: 32000 }));
    let s = await snap();
    expect(s.budgets.map((b) => b.amountCents).sort()).toEqual([150000, 32000].sort());
    await ok(await call('PUT', '/api/v1/budgets', { month: '2026-11', categoryId: c, amountCents: 0 }));
    s = await snap();
    expect(s.budgets).toHaveLength(1);
  });
});

describe('error handling', () => {
  it('unknown routes 404, wrong methods 405, malformed JSON 400', async () => {
    expect((await call('GET', '/api/v1/nope')).status).toBe(404);
    expect((await call('PATCH', '/api/v1/snapshot')).status).toBe(405);
    const headers = new Headers({ Origin: ORIGIN, Cookie: auth.cookie, 'X-CSRF-Token': auth.csrf });
    const r = await handle(
      new Request(`${ORIGIN}/api/v1/payments`, { method: 'POST', headers, body: '{not json' }),
      deps,
    );
    expect(r.status).toBe(400);
  });
});
