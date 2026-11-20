/** Import architecture on SYNTHETIC legacy-shaped fixtures (never the private backups). */
import { describe, expect, it } from 'vitest';
import { keyOf, mapLegacy, planInserts, toLegacyJob } from './legacy';

// Shapes mirror the profiled backups (field presence, legacy CSV id style, absent role/type/payRate, 12h times).
const subtrack = {
  jobs: [
    {
      id: 'k3j9x0a1b',
      date: '2024-09-12',
      className: 'Grade 3',
      teacher: 'Teacher A',
      school: 'School X',
      town: 'Highland',
      dayType: 1,
      fromTime: '7:45 AM',
      toTime: '2:45 PM',
      hours: 7,
    },
    {
      id: 'job-4-0.123',
      date: '2025-01-15',
      role: 'teacher',
      className: 'Math',
      teacher: 'Teacher B',
      school: 'School Y',
      town: 'Munster',
      dayType: 0.5,
      fromTime: '08:00',
      toTime: '11:30',
      hours: 3.5,
      payRate: 105.48,
    },
    {
      id: 'a1b2c3d4e',
      date: '2025-03-03',
      role: 'aide',
      className: 'Resource',
      teacher: 'Teacher C',
      school: 'School Y',
      town: 'Munster',
      dayType: 1,
      fromTime: '08:00',
      toTime: '14:00',
      hours: 6,
      payRate: 12.71,
      legacyNote: 'kept',
    },
    {
      id: 'z9y8x7w6v',
      date: '2026-09-02',
      role: 'teacher',
      employmentType: 'everyday',
      className: 'Biology',
      teacher: 'Teacher D',
      school: 'Munster High School',
      town: 'Munster',
      dayType: 1,
      fromTime: '07:15',
      toTime: '14:50',
      hours: 7.58,
      payRate: 105.48,
    },
  ],
  payments: [
    { id: 'pay-7-0.55', date: '2024-09-27', town: 'Highland', amount: 105.48 },
    { id: 'p0q9r8s7t', date: '2026-09-11', town: 'Munster', amount: 114.27 },
  ],
};
const expenses = {
  expenses: [
    {
      id: 'e1',
      date: '2026-09-01',
      merchant: 'Rent',
      amount: 550,
      categoryId: 'c1',
      accountId: 'a1',
      recurringId: 'r1',
    },
    {
      id: 'e2',
      date: '2026-09-03',
      merchant: 'Market',
      amount: 41.37,
      categoryId: 'c2',
      accountId: 'a2',
      notes: 'weekly',
    },
  ],
  categories: [
    { id: 'c1', name: 'Housing', color: '#8a6fb5' },
    { id: 'c2', name: 'Groceries', color: '#4f9d69' },
  ],
  accounts: [
    { id: 'a1', name: 'Debit', type: 'Debit card', balance: 1234.56 },
    { id: 'a2', name: 'Cash', type: 'Cash', balance: 0 },
  ],
  recurringExpenses: [
    {
      id: 'r1',
      merchant: 'Rent',
      amount: 550,
      categoryId: 'c1',
      accountId: 'a1',
      frequency: 'monthly',
      startDate: '2026-09-01',
      active: true,
    },
  ],
  subtrackSync: { targetAccountId: 'a1', syncedPaymentIds: ['p0q9r8s7t'] },
};

describe('legacy mapping', () => {
  const m = mapLegacy(subtrack, expenses);

  it('control totals are identical to the cent before and after', () => {
    expect(m.after).toEqual(m.before);
    expect(m.before.expectedNetCents).toBe(10548 + 5274 + 7626 + 11427);
  });

  it('preserves every legacy id as (source, legacyId)', () => {
    expect(m.workDays.map((d) => d.source?.legacyId)).toEqual(subtrack.jobs.map((j) => j.id));
    expect(m.payments.map((p) => p.source?.legacyId)).toEqual(subtrack.payments.map((p) => p.id));
    expect(new Set([...m.workDays, ...m.payments].map(keyOf)).size).toBe(6);
  });

  it('round-trips every job exactly (incl. absent role/type/payRate and unknown keys)', () => {
    m.workDays.forEach((d, i) => expect(toLegacyJob(d, subtrack.jobs[i]!)).toEqual(subtrack.jobs[i]));
  });

  it('archives retired features instead of dropping them, and keeps them out of the app model', () => {
    expect(m.retired.accountBalances).toEqual([
      { legacyAccountId: 'a1', balance: 1234.56 },
      { legacyAccountId: 'a2', balance: 0 },
    ]);
    expect(m.retired.subtrackSync).toEqual(expenses.subtrackSync);
    expect(JSON.stringify(m.expenses.paymentMethods)).not.toContain('balance');
  });

  it('keeps referential links (category, method, recurring) under the new ids', () => {
    expect(m.expenses.expenses[0]).toMatchObject({
      categoryId: 'ex-c1',
      paymentMethodId: 'ex-a1',
      recurringPlanId: 'ex-r1',
    });
  });

  it('is idempotent: re-importing the same backup plans zero inserts', () => {
    const first = planInserts(m.workDays, new Set());
    expect(first).toHaveLength(4);
    const existing = new Set(first.map(keyOf));
    expect(planInserts(mapLegacy(subtrack, expenses).workDays, existing)).toEqual([]);
  });

  it('rejects malformed documents at the boundary instead of importing partial data', () => {
    expect(() => mapLegacy({ jobs: [{ id: 'x' }], payments: [] }, expenses)).toThrow();
  });
});
