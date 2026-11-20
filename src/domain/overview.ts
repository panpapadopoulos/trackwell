import { earningsFromPeriods } from './earnings';
import { addDays, addMonths, monthKey, type ISODate, type MonthKey } from './dates';
import { inRange, type DateRange } from './filters';
import { sumCents, type Cents } from './money';
import { upcomingCharges, type UpcomingCharge } from './expenses/recurring';
import type { ExpenseData } from './expenses/types';
import { PAY_RULES_V1, PAY_SCHEDULE_V1, type PayRules, type PayScheduleConfig } from './pay/rules';
import { reconcilePeriods, type PeriodRow } from './work/summary';
import type { IncomePayment, WorkDay } from './work/types';

/**
 * Five kinds of money, never mixed:
 *  - received: income_payments (actual money in), the ONLY income source
 *  - expenses: recorded expense transactions
 *  - net cash flow: received − expenses (NOT a bank balance)
 *  - expected (earned, unpaid): worked days whose pay period has no payment yet
 *  - upcoming recurring: projection of active plans, not saved
 * Expense transactions are never interpreted as income, and legacy SubTrack→account
 * balance syncs are retired, so income can't be double-recognized.
 */
export interface OverviewMonth {
  month: MonthKey;
  receivedCents: Cents;
  expensesCents: Cents;
  netCents: Cents;
  /** Expected pay for periods whose payday lands in this month and that aren't paid yet. */
  expectedUnpaidCents: Cents;
}

export interface OverviewSummary {
  receivedCents: Cents;
  expensesCents: Cents;
  netCashFlowCents: Cents;
  paymentCount: number;
  expenseCount: number;
  /** All earned-but-unpaid periods (upcoming + awaiting), independent of the range. */
  expectedUnpaidCents: Cents;
  upcomingPaychecks: PeriodRow[];
  overduePaychecks: PeriodRow[];
  upcomingRecurring: UpcomingCharge[];
  upcomingRecurringCents: Cents;
  monthly: OverviewMonth[];
}

export function summarizeOverview(
  work: { days: readonly WorkDay[]; payments: readonly IncomePayment[] },
  expenses: ExpenseData,
  range: DateRange,
  today: ISODate,
  rules: PayRules = PAY_RULES_V1,
  cfg: PayScheduleConfig = PAY_SCHEDULE_V1,
): OverviewSummary {
  const payments = work.payments.filter((p) => inRange(p.date, range));
  const spent = expenses.expenses.filter((e) => inRange(e.date, range));
  const receivedCents = sumCents(payments.map((p) => p.amountCents));
  const expensesCents = sumCents(spent.map((e) => e.amountCents));

  const periods = [...reconcilePeriods(work.days, work.payments, today, rules, cfg).values()];
  const unpaid = periods.filter((p) => p.status === 'upcoming' || p.status === 'awaiting');
  const upcomingPaychecks = unpaid
    .filter((p) => p.status === 'upcoming')
    .sort((a, b) => a.period.expectedPayday.localeCompare(b.period.expectedPayday));
  const overduePaychecks = unpaid.filter((p) => p.status === 'awaiting');

  const next30 = upcomingCharges(
    expenses.recurringPlans.filter((p) => p.active),
    today,
    addDays(today, 30),
  );

  // Monthly series: last 12 months of the range (or ending today for open ranges).
  const end = monthKey(range.to && range.to < today ? range.to : today);
  const startBound = range.from ? monthKey(range.from) : null;
  const monthly: OverviewMonth[] = [];
  for (let i = 11; i >= 0; i--) {
    const m = addMonths(end, -i);
    if (startBound && m < startBound) continue;
    const r = sumCents(work.payments.filter((p) => monthKey(p.date) === m).map((p) => p.amountCents));
    const x = sumCents(expenses.expenses.filter((e) => monthKey(e.date) === m).map((e) => e.amountCents));
    const exp = sumCents(
      unpaid.filter((p) => monthKey(p.period.expectedPayday) === m).map((p) => p.expectedNetCents),
    );
    monthly.push({ month: m, receivedCents: r, expensesCents: x, netCents: r - x, expectedUnpaidCents: exp });
  }

  return {
    receivedCents,
    expensesCents,
    netCashFlowCents: receivedCents - expensesCents,
    paymentCount: payments.length,
    expenseCount: spent.length,
    expectedUnpaidCents: earningsFromPeriods(periods).outstandingCents,
    upcomingPaychecks,
    overduePaychecks,
    upcomingRecurring: next30,
    upcomingRecurringCents: sumCents(next30.map((c) => c.plan.amountCents)),
    monthly,
  };
}
