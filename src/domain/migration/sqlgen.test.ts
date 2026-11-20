import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { expenseDataSql, lit, paymentSql, workDaySql } from './sqlgen';
import { syntheticDataset } from '../../demo/synthetic';

function db() {
  const d = new DatabaseSync(':memory:');
  d.exec('PRAGMA foreign_keys = ON');
  const dir = resolve(__dirname, '../../../migrations');
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith('.sql'))
    .sort())
    d.exec(readFileSync(resolve(dir, f), 'utf8'));
  return d;
}

describe('sql literal escaping', () => {
  it('neutralizes quotes and statement terminators', () => {
    const d = db();
    const evil = `x'); DROP TABLE work_days; --`;
    d.exec(`INSERT INTO pay_period_overrides VALUES ('2026-11-02', '2026-11-27', ${lit(evil)}, 0);`);
    expect((d.prepare('SELECT note FROM pay_period_overrides').get() as { note: string }).note).toBe(evil);
    expect(d.prepare(`SELECT name FROM sqlite_master WHERE name = 'work_days'`).get()).toBeTruthy();
  });
  it('rejects values that cannot be represented safely', () => {
    expect(() => lit(NaN)).toThrow();
    expect(() => lit('a\u0000b')).toThrow();
    expect(() => lit({})).toThrow();
    expect(lit(null)).toBe('NULL');
  });
});

describe('seed SQL from the synthetic dataset', () => {
  const ds = syntheticDataset('2026-11-18');
  const o = { source: 'trackwell' as const, now: 1 };
  const sql = [
    ...ds.work.days.flatMap((w) => workDaySql(w, o)),
    ...ds.work.payments.map((p) => paymentSql(p, o)),
    ...expenseDataSql(ds.expenses, o),
  ].join('\n');

  it('applies cleanly and loads every record', () => {
    const d = db();
    d.exec(sql);
    const n = (t: string) => (d.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
    expect(n('work_days')).toBe(ds.work.days.length);
    expect(n('income_payments')).toBe(ds.work.payments.length);
    expect(n('expenses')).toBe(ds.expenses.expenses.length);
    expect(n('coverage_blocks')).toBe(ds.work.days.reduce((s, w) => s + w.coverage.length, 0));
  });
  it('is idempotent: applying it twice adds nothing', () => {
    const d = db();
    d.exec(sql);
    d.exec(sql);
    expect((d.prepare('SELECT count(*) AS n FROM work_days').get() as { n: number }).n).toBe(
      ds.work.days.length,
    );
  });
});
