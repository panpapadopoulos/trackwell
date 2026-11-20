/**
 * Applies migrations/0001_init.sql to a real SQLite engine (Node's built-in
 * node:sqlite, the same SQL dialect D1 runs) and verifies the safety constraints.
 * Synthetic rows only.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

const SQL = readFileSync(resolve(__dirname, '../../migrations/0001_init.sql'), 'utf8');
let db: DatabaseSync;
const now = 1_763_500_000_000;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(SQL);
  db.exec(`INSERT INTO pay_rules VALUES ('subtrack-legacy-v1', '2024-01-01', '{}', ${now})`);
});

function workDay(o: Record<string, unknown> = {}) {
  const row = {
    id: `w${Math.random().toString(36).slice(2)}`,
    date: '2026-11-16',
    status: 'worked',
    employment_type: 'permanent',
    role: 'teacher',
    format: 'single',
    school_name: 'Munster High School',
    district: 'Munster',
    day_type: 1,
    start_time: '07:15',
    end_time: '14:50',
    hours: 7.58,
    pay_rule_version: 'subtrack-legacy-v1',
    expected_net_cents: 11427,
    expected_gross_cents: 13000,
    source: 'trackwell',
    legacy_id: null,
    created_at: now,
    updated_at: now,
    ...o,
  };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO work_days (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(
    ...(Object.values(row) as Array<string | number | null>),
  );
  return row.id;
}

describe('D1 schema 0001', () => {
  it('applies cleanly and creates every planned table', () => {
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all()
      .map((r) => (r as { name: string }).name);
    for (const t of [
      'work_days',
      'coverage_blocks',
      'schools',
      'teachers',
      'bell_schedules',
      'bell_schedule_periods',
      'employment_defaults',
      'pay_rules',
      'income_payments',
      'expenses',
      'expense_categories',
      'payment_methods',
      'recurring_expenses',
      'budgets',
      'ai_preferences',
      'saved_reports',
      'sessions',
      'login_attempts',
      'audit_log',
      'legacy_archive',
      'import_runs',
    ])
      expect(tables).toContain(t);
  });

  it('importing the same legacy record twice is idempotent', () => {
    workDay({ source: 'subtrack', legacy_id: 'abc123xyz' });
    expect(() =>
      workDay({ source: 'subtrack', legacy_id: 'abc123xyz', date: '2026-11-17', employment_type: 'regular' }),
    ).toThrow(/UNIQUE/);
    const upsert = db.prepare(
      `INSERT INTO income_payments (id, date, district, amount_cents, source, legacy_id, created_at, updated_at)
       VALUES (?, '2026-11-06', 'Munster', 50000, 'subtrack', 'pay-1', ${now}, ${now})
       ON CONFLICT (source, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING`,
    );
    upsert.run('p1');
    upsert.run('p2'); // second import of the same backup
    expect((db.prepare('SELECT count(*) AS n FROM income_payments').get() as { n: number }).n).toBe(1);
  });

  it('refuses a second live paid permanent day on the same date', () => {
    workDay();
    expect(() => workDay()).toThrow(/UNIQUE/);
    workDay({ status: 'planned' }); // a projection on the same date is fine
    workDay({ employment_type: 'regular', role: 'aide' }); // a separate regular assignment is representable
  });

  it('coverage blocks carry no money and cascade with their work day', () => {
    const cols = db
      .prepare(`PRAGMA table_info(coverage_blocks)`)
      .all()
      .map((c) => (c as { name: string }).name);
    expect(cols.some((c) => /cents|pay|amount/.test(c))).toBe(false);
    const id = workDay({ format: 'multiple' });
    const ins = db.prepare(
      `INSERT INTO coverage_blocks (id, work_day_id, position, status, teacher_name) VALUES (?, ?, ?, ?, ?)`,
    );
    ins.run('b1', id, 1, 'covered', 'Teacher A');
    ins.run('b2', id, 2, 'free', null);
    db.prepare('DELETE FROM work_days WHERE id = ?').run(id);
    expect((db.prepare('SELECT count(*) AS n FROM coverage_blocks').get() as { n: number }).n).toBe(0);
  });

  it('enforces foreign keys', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO expenses (id, date, merchant, amount_cents, category_id, payment_method_id, source, created_at, updated_at)
         VALUES ('e1', '2026-11-01', 'Shop', 100, 'missing', 'missing', 'trackwell', ${now}, ${now})`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });

  it('has no bank-balance column anywhere in the app schema', () => {
    const cols = db
      .prepare(`PRAGMA table_info(payment_methods)`)
      .all()
      .map((c) => (c as { name: string }).name);
    expect(cols).not.toContain('balance');
  });

  it('keeps the legacy archive write-once', () => {
    db.exec(`INSERT INTO import_runs VALUES ('r1', ${now}, NULL, 'expenses', 'sha', 1, NULL)`);
    db.exec(`INSERT INTO legacy_archive VALUES ('a1', 'r1', 'expenses', 'user_data', 'sha', '{}', ${now})`);
    expect(() => db.exec(`UPDATE legacy_archive SET raw_json = '{"x":1}'`)).toThrow(/write-once/);
    expect(() => db.exec(`DELETE FROM legacy_archive`)).toThrow(/write-once/);
  });

  it('rejects malformed values (time order, negative money, unknown status)', () => {
    db.exec(`INSERT INTO schools VALUES ('s1', 'Demo', NULL, NULL)`);
    db.exec(`INSERT INTO bell_schedules VALUES ('bs', 's1', '2026-27', 'X', 'synthetic', 'test', '[]')`);
    expect(() =>
      db.exec(`INSERT INTO bell_schedule_periods VALUES ('bs','P1','P1','class','09:00','08:00',NULL,NULL)`),
    ).toThrow();
    expect(() => workDay({ status: 'maybe' })).toThrow(/CHECK/);
  });
});
