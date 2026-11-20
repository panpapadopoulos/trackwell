import { describe, expect, it } from 'vitest';
import { centsFromDollars, formatMoney } from './money';
import { addMonths, formatRange, todayISO, weekday } from './dates';
import { rangeFor } from './filters';
import { summarizeOverview } from './overview';
import { summarizeExpenses } from './expenses/summary';
import { generateDue, upcomingCharges } from './expenses/recurring';
import type { ExpenseData } from './expenses/types';
import type { IncomePayment, WorkDay } from './work/types';

describe('money', () => {
  it('converts like legacy toFixed(2) and sums exactly in cents', () => {
    expect(centsFromDollars(114.27)).toBe(11427);
    expect(centsFromDollars(0.1 + 0.2)).toBe(30);
    expect(formatMoney(-123456)).toBe('−$1,234.56');
    expect(formatMoney(5000, { signed: true })).toBe('+$50.00');
    expect(formatMoney(99999999999)).toBe('$999,999,999.99');
  });
});

describe('dates', () => {
  it('civil arithmetic', () => {
    expect(weekday('2026-11-18')).toBe(3);
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(formatRange('2026-10-19', '2026-11-01')).toBe('Oct 19 – Nov 1');
  });
  it("today is the user's civil date, not UTC (evening in Chicago is still today)", () => {
    expect(todayISO(new Date('2026-11-19T03:30:00Z'))).toBe('2026-11-18');
  });
  it('presets', () => {
    expect(rangeFor({ kind: 'last30' }, '2026-11-18')).toEqual({ from: '2026-10-20', to: '2026-11-18' });
    expect(rangeFor({ kind: 'schoolYear', key: '2026-27' }, '2026-11-18')).toEqual({
      from: '2026-08-01',
      to: '2027-07-31',
    });
    expect(rangeFor({ kind: 'month', key: '2027-02' }, '2026-11-18')).toEqual({
      from: '2027-02-01',
      to: '2027-02-28',
    });
  });
});

const expenses: ExpenseData = {
  categories: [
    { id: 'g', name: 'Groceries', color: '#000' },
    { id: 'd', name: 'Dining', color: '#000' },
  ],
  paymentMethods: [{ id: 'card', name: 'Card', type: 'Credit card' }],
  recurringPlans: [
    {
      id: 'phone',
      merchant: 'Phone',
      amountCents: 4500,
      categoryId: 'd',
      paymentMethodId: 'card',
      frequency: 'monthly',
      startDate: '2026-01-25',
      active: true,
    },
    {
      id: 'ins',
      merchant: 'Insurance',
      amountCents: 120000,
      categoryId: 'd',
      paymentMethodId: 'card',
      frequency: 'yearly',
      startDate: '2025-12-01',
      active: true,
    },
  ],
  recurringSkips: [],
  budgets: [
    { id: 'all', month: '*', categoryId: null, amountCents: 200000 },
    { id: 'gro', month: '*', categoryId: 'g', amountCents: 50000 },
    { id: 'gro-nov', month: '2026-11', categoryId: 'g', amountCents: 40000 },
  ],
  expenses: [
    {
      id: 'e1',
      date: '2026-11-02',
      merchant: 'Market',
      amountCents: 30000,
      categoryId: 'g',
      paymentMethodId: 'card',
    },
    {
      id: 'e2',
      date: '2026-11-10',
      merchant: 'Market',
      amountCents: 15000,
      categoryId: 'g',
      paymentMethodId: 'card',
    },
    {
      id: 'e3',
      date: '2026-10-05',
      merchant: 'Cafe',
      amountCents: 2500,
      categoryId: 'd',
      paymentMethodId: 'card',
    },
  ],
};

describe('expenses summary', () => {
  const s = summarizeExpenses(expenses, {}, '2026-11', '2026-11-18');
  it('totals, budget, remaining, largest category', () => {
    expect(s.totalCents).toBe(47500);
    expect(s.thisMonthCents).toBe(45000);
    expect(s.monthlyBudgetCents).toBe(200000);
    expect(s.remainingBudgetCents).toBe(155000);
    expect(s.largestCategory?.name).toBe('Groceries');
  });
  it('a month-specific budget beats the every-month budget; over-budget ratio is uncapped', () => {
    const g = s.budgetLines.find((b) => b.categoryId === 'g')!;
    expect(g.budgetCents).toBe(40000);
    expect(g.remainingCents).toBe(-5000);
    expect(g.ratio).toBeCloseTo(1.125);
  });
  it('recurring: monthly-equivalent cost and next-30-day projection', () => {
    expect(s.recurring.monthlyCostCents).toBe(4500 + 10000);
    expect(s.recurring.next30.map((c) => [c.plan.id, c.date])).toEqual([
      ['phone', '2026-11-25'],
      ['ins', '2026-12-01'],
    ]);
  });
  it('deleted occurrences (skips) are never regenerated', () => {
    const plan = expenses.recurringPlans[0]!;
    const once = generateDue(
      [plan],
      [],
      [{ planId: 'phone', date: '2026-10-25' }],
      '2026-11-18',
      (p, d) => `${p}:${d}`,
    );
    expect(once.newExpenses.map((e) => e.date)).not.toContain('2026-10-25');
    const twice = generateDue(
      [plan],
      once.newExpenses,
      [{ planId: 'phone', date: '2026-10-25' }],
      '2026-11-18',
      () => 'x',
    );
    expect(twice.newExpenses).toEqual([]); // idempotent
  });
  it('upcoming charges are strictly after today', () => {
    expect(upcomingCharges(expenses.recurringPlans, '2026-11-25', '2026-11-30')).toEqual([]);
  });
});

describe('overview keeps money kinds separate', () => {
  const w: WorkDay = {
    id: 'w',
    date: '2026-11-17',
    status: 'worked',
    employmentType: 'regular',
    role: 'teacher',
    format: 'single',
    schoolName: 'X',
    district: 'Munster',
    dayType: 1,
    startTime: '08:00',
    endTime: '15:00',
    hours: 7,
    coverage: [],
  };
  const planned: WorkDay = { ...w, id: 'p', date: '2026-11-18', status: 'planned' };
  const payments: IncomePayment[] = [
    { id: 'p1', date: '2026-11-06', district: 'Munster', amountCents: 50000 },
  ];
  const o = summarizeOverview({ days: [w, planned], payments }, expenses, {}, '2026-11-18');

  it('net cash flow = received − expenses, and expected money is not received', () => {
    expect(o.receivedCents).toBe(50000);
    expect(o.expensesCents).toBe(47500);
    expect(o.netCashFlowCents).toBe(2500);
    expect(o.expectedUnpaidCents).toBe(10548); // the worked day only; planned day excluded
    expect(o.upcomingPaychecks[0]?.period.expectedPayday).toBe('2026-12-04');
  });
  it('an expense is never treated as income', () => {
    const withIncomeLikeExpense: ExpenseData = {
      ...expenses,
      expenses: [
        ...expenses.expenses,
        {
          id: 'x',
          date: '2026-11-06',
          merchant: 'Paycheck deposit',
          amountCents: 50000,
          categoryId: 'g',
          paymentMethodId: 'card',
        },
      ],
    };
    const o2 = summarizeOverview({ days: [w], payments }, withIncomeLikeExpense, {}, '2026-11-18');
    expect(o2.receivedCents).toBe(50000);
    expect(o2.expensesCents).toBe(97500);
  });
});
