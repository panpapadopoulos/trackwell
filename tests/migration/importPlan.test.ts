/**
 * End-to-end migration rehearsal on SYNTHETIC legacy-shaped documents, applied
 * to a real SQLite engine with the real migrations. No private data.
 */
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { planImport, verificationQueries } from '../../src/domain/migration/importPlan';

function db() {
  const d = new DatabaseSync(':memory:');
  d.exec('PRAGMA foreign_keys = ON');
  const dir = resolve(__dirname, '../../migrations');
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith('.sql'))
    .sort())
    d.exec(readFileSync(resolve(dir, f), 'utf8'));
  return d;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Synthetic legacy SubTrack + Expenses documents mirroring the profiled shapes (no real values). */
function legacyDocs(seed = 42) {
  const r = rng(seed);
  const jobs: Record<string, unknown>[] = [];
  const payments: Record<string, unknown>[] = [];
  let line = 3;
  for (let i = 0; i < 160; i++) {
    const month = 1 + (i % 12);
    const day = 1 + (i % 27);
    const year = i < 60 ? 2025 : 2026;
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const csv = r() < 0.5;
    const everyday = year === 2026 && month >= 9 && i % 2 === 0;
    jobs.push({
      id: csv
        ? `job-${line++}-0.${Math.floor(r() * 1e15)}`
        : Math.floor(r() * 36 ** 9)
            .toString(36)
            .padStart(9, 'x'),
      date,
      ...(r() < 0.66 ? {} : { role: r() < 0.9 ? 'teacher' : 'aide' }),
      ...(everyday ? { employmentType: 'everyday' } : {}),
      className: `Class ${i % 9} "honors"`,
      teacher: `Teacher O'Brien-${i % 23}`,
      school: i % 3 ? 'Synthetic Elementary' : 'Munster High School',
      town: i % 7 ? 'Munster' : 'Highland',
      dayType: r() < 0.15 ? 0.5 : 1,
      fromTime: csv ? '7:45 AM' : '08:00',
      toTime: csv ? '2:45 PM' : '15:00',
      hours: Math.round(r() * 800) / 100,
      ...(r() < 0.33 ? { payRate: 105.48 } : {}),
    });
  }
  // avoid two permanent days on one date (legacy data has none)
  const seen = new Set<string>();
  for (const j of jobs) {
    if (j.employmentType !== 'everyday') continue;
    if (seen.has(j.date as string)) delete j.employmentType;
    else seen.add(j.date as string);
  }
  for (let i = 0; i < 45; i++)
    payments.push({
      id: i % 2 ? `pay-${i}-0.${i}123` : `p${i}aaaaaaa`,
      date: `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(5 + (i % 20)).padStart(2, '0')}`,
      town: 'Munster',
      amount: Math.round(r() * 120000) / 100 + 1,
    });
  const categories = [
    { id: 'c1', name: 'Groceries', color: '#4f9d69' },
    { id: 'c2', name: 'Café & “Dining”', color: '#c9733a' },
  ];
  const accounts = [
    { id: 'a1', name: 'Debit', type: 'Debit card', balance: 4321.09 },
    { id: 'a2', name: 'Cash', type: 'Cash', balance: 0 },
  ];
  const recurringExpenses = [
    {
      id: 'r1',
      merchant: 'Phone',
      amount: 45,
      categoryId: 'c2',
      accountId: 'a1',
      frequency: 'monthly',
      startDate: '2026-01-05',
      active: true,
    },
  ];
  const expenses = Array.from({ length: 70 }, (_, i) => ({
    id: `e${i}${Math.floor(r() * 1e6)}`,
    date: `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
    merchant: i % 5 ? `Store #${i}` : `Bob's "Market"; DROP TABLE x;--`,
    amount: Math.round(r() * 20000) / 100 + 0.01,
    categoryId: i % 2 ? 'c1' : 'c2',
    accountId: i % 3 ? 'a1' : 'a2',
    ...(i % 9 === 0 ? { notes: 'ünïcødé ✓' } : {}),
    ...(i < 10 ? { recurringId: 'r1' } : {}),
  }));
  return {
    subtrack: { jobs, payments },
    expenses: {
      expenses,
      categories,
      accounts,
      recurringExpenses,
      subtrackSync: { targetAccountId: 'a1', syncedPaymentIds: ['p0aaaaaaa'] },
    },
  };
}

const META = {
  runId: 'run-synthetic-1',
  now: 1_763_500_000_000,
  subtrackSha256: 'a'.repeat(64),
  expensesSha256: 'b'.repeat(64),
};
const verify = (d: DatabaseSync, runId: string) =>
  Object.fromEntries(
    Object.entries(verificationQueries(runId)).map(([k, q]) => [k, (d.prepare(q).get() as { v: number }).v]),
  );

describe('legacy import plan (synthetic rehearsal)', () => {
  const { subtrack, expenses } = legacyDocs();
  const plan = planImport(subtrack, expenses, META);

  it('validates cleanly and preserves every record', () => {
    expect(plan.issues).toEqual([]);
    expect(plan.ok).toBe(true);
    expect(plan.controls).toMatchObject({
      jobs: 160,
      payments: 45,
      expenses: 70,
      categories: 2,
      paymentMethods: 2,
      recurring: 1,
    });
  });

  it('imported counts and totals equal the legacy control totals to the cent', () => {
    const d = db();
    d.exec(plan.sql.join('\n'));
    expect(verify(d, META.runId)).toEqual(plan.controls);
  });

  it('is idempotent: applying the same plan twice changes nothing', () => {
    const d = db();
    d.exec(plan.sql.join('\n'));
    d.exec(plan.sql.join('\n'));
    expect(verify(d, META.runId)).toEqual(plan.controls);
    expect((d.prepare('SELECT count(*) AS n FROM legacy_archive').get() as { n: number }).n).toBe(2);
  });

  it('archives retired data write-once and keeps it out of the app tables', () => {
    const d = db();
    d.exec(plan.sql.join('\n'));
    const raw = (
      d.prepare(`SELECT raw_json FROM legacy_archive WHERE source = 'expenses'`).get() as { raw_json: string }
    ).raw_json;
    expect(JSON.parse(raw).accounts[0].balance).toBe(4321.09);
    expect(JSON.parse(raw).subtrackSync.syncedPaymentIds).toEqual(['p0aaaaaaa']);
    expect(
      d
        .prepare(`PRAGMA table_info(payment_methods)`)
        .all()
        .map((c) => (c as { name: string }).name),
    ).not.toContain('balance');
  });

  it('keeps hostile and unicode text byte-for-byte', () => {
    const d = db();
    d.exec(plan.sql.join('\n'));
    const merchants = d.prepare(`SELECT merchant FROM expenses WHERE merchant LIKE 'Bob%'`).all() as Array<{
      merchant: string;
    }>;
    expect(merchants[0]!.merchant).toBe(`Bob's "Market"; DROP TABLE x;--`);
    expect(d.prepare(`SELECT name FROM expense_categories WHERE legacy_id = 'c2'`).get()).toEqual({
      name: 'Café & “Dining”',
    });
  });

  it('rolls back exactly this run, and can be re-imported afterwards', () => {
    const d = db();
    d.exec(plan.sql.join('\n'));
    d.exec(plan.rollbackSql.join('\n'));
    const after = verify(d, META.runId);
    expect(Object.values(after).every((v) => v === 0)).toBe(true);
    expect((d.prepare('SELECT count(*) AS n FROM legacy_archive').get() as { n: number }).n).toBe(2); // archive is kept
    d.exec(plan.sql.join('\n'));
    expect(verify(d, META.runId)).toEqual(plan.controls);
  });

  it('refuses to produce SQL when validation fails (and reports where, not what)', () => {
    const bad = legacyDocs(7);
    (bad.expenses.expenses[0] as Record<string, unknown>).categoryId = 'missing';
    (bad.expenses.expenses[1] as Record<string, unknown>).merchant = 'x'.repeat(200);
    const p = planImport(bad.subtrack, bad.expenses, META);
    expect(p.ok).toBe(false);
    expect(p.sql).toEqual([]);
    expect(p.issues).toEqual(
      expect.arrayContaining([
        { kind: 'reference', where: 'expenses.category', count: 1 },
        { kind: 'limit', where: 'expenses.merchant', count: 1 },
      ]),
    );
    expect(JSON.stringify(p.issues)).not.toContain('xxxx');
  });

  it('rejects a malformed document at the schema boundary', () => {
    const p = planImport({ jobs: [{ id: 'x' }], payments: [] }, expenses, META);
    expect(p.ok).toBe(false);
    expect(p.issues[0]!.kind).toBe('schema');
  });
});
