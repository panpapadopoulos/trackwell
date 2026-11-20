/** Parity of recurring-expense occurrence generation vs the verbatim legacy Expenses code. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateDueExpenses } from '../../src/domain/legacy/expenses/utils/recurring';
import type { AppData, RecurringExpense } from '../../src/domain/legacy/expenses/types';
import { generateDue, occurrenceDates } from '../../src/domain/expenses/recurring';
import type { RecurringPlan } from '../../src/domain/expenses/types';

const templates: RecurringExpense[] = [
  {
    id: 'm31',
    merchant: 'A',
    amount: 10,
    categoryId: 'c',
    accountId: 'a',
    frequency: 'monthly',
    startDate: '2025-01-31',
    active: true,
  },
  {
    id: 'm15',
    merchant: 'B',
    amount: 20,
    categoryId: 'c',
    accountId: 'a',
    frequency: 'monthly',
    startDate: '2024-06-15',
    occurrences: 4,
    active: true,
  },
  {
    id: 'y29',
    merchant: 'C',
    amount: 30,
    categoryId: 'c',
    accountId: 'a',
    frequency: 'yearly',
    startDate: '2024-02-29',
    active: true,
  },
  {
    id: 'fut',
    merchant: 'D',
    amount: 40,
    categoryId: 'c',
    accountId: 'a',
    frequency: 'monthly',
    startDate: '2027-01-01',
    active: true,
  },
  {
    id: 'off',
    merchant: 'E',
    amount: 50,
    categoryId: 'c',
    accountId: 'a',
    frequency: 'monthly',
    startDate: '2025-01-01',
    active: false,
  },
];

const toPlan = (t: RecurringExpense): RecurringPlan => ({
  id: t.id,
  merchant: t.merchant,
  amountCents: Math.round(t.amount * 100),
  categoryId: t.categoryId,
  paymentMethodId: t.accountId,
  frequency: t.frequency,
  startDate: t.startDate,
  ...(t.occurrences ? { occurrences: t.occurrences } : {}),
  active: t.active,
});

afterEach(() => vi.useRealTimers());

describe('recurring generation parity', () => {
  for (const today of ['2025-03-01', '2026-02-28', '2026-11-18', '2028-03-01']) {
    it(`generates the same occurrences as legacy on ${today}`, () => {
      vi.useFakeTimers();
      const [y, m, d] = today.split('-').map(Number) as [number, number, number];
      vi.setSystemTime(new Date(y, m - 1, d, 12));
      const legacyData: AppData = {
        expenses: [],
        categories: [],
        accounts: [],
        recurringExpenses: templates,
        subtrackSync: { targetAccountId: null, syncedPaymentIds: [] },
      };
      const out = generateDueExpenses(legacyData);
      const legacyByPlan = (id: string) =>
        out.expenses.filter((e) => e.recurringId === id).map((e) => e.date);
      const ours = generateDue(templates.map(toPlan), [], [], today, (p, dt) => `${p}:${dt}`).newExpenses;
      for (const t of templates) {
        expect(ours.filter((e) => e.recurringPlanId === t.id).map((e) => e.date)).toEqual(legacyByPlan(t.id));
      }
      // completion flag parity
      for (const t of out.recurringExpenses) {
        const completed = generateDue(
          templates.map(toPlan),
          [],
          [],
          today,
          () => 'x',
        ).completedPlanIds.includes(t.id);
        if (t.occurrences != null && templates.find((x) => x.id === t.id)!.active)
          expect(completed).toBe(!t.active);
      }
    });
  }

  it('clamps to month end and keeps the original day afterwards', () => {
    expect(occurrenceDates({ startDate: '2025-01-31', frequency: 'monthly' }, '2025-05-01')).toEqual([
      '2025-01-31',
      '2025-02-28',
      '2025-03-31',
      '2025-04-30',
    ]);
  });
});
