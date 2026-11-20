import { daysInMonth, type ISODate } from '../dates';
import type { Expense, RecurringPlan, RecurringSkip } from './types';

/**
 * All occurrence dates of a plan up to and including `until`, stepping monthly
 * or yearly from the start day, clamped to month end (Jan 31 → Feb 28), capped
 * at `occurrences`. Same semantics as legacy `expenses/utils/recurring.ts`,
 * including its safety caps for ongoing plans.
 */
export function occurrenceDates(
  plan: Pick<RecurringPlan, 'startDate' | 'frequency' | 'occurrences'>,
  until: ISODate,
): ISODate[] {
  const [sy, sm, sd] = plan.startDate.split('-').map(Number) as [number, number, number];
  const step = plan.frequency === 'yearly' ? 12 : 1;
  const max = plan.occurrences ?? (plan.frequency === 'yearly' ? 50 : 240);
  const out: ISODate[] = [];
  for (let i = 0; i < max; i++) {
    const total = sm - 1 + i * step;
    const y = sy + Math.floor(total / 12);
    const m = (total % 12) + 1;
    const d = Math.min(sd, daysInMonth(y, m));
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (iso > until) break;
    out.push(iso);
  }
  return out;
}

export interface GenerationResult {
  newExpenses: Expense[];
  /** Plans that completed their fixed number of occurrences in this run. */
  completedPlanIds: string[];
}

/**
 * Idempotent generation of due occurrences. Never mutates or deletes existing
 * records: it returns only NEW expenses to insert. Occurrences the user deleted
 * (recorded as skips) are never re-created, which fixes legacy defect D5.
 */
export function generateDue(
  plans: readonly RecurringPlan[],
  existing: readonly Expense[],
  skips: readonly RecurringSkip[],
  today: ISODate,
  newId: (planId: string, date: ISODate) => string,
): GenerationResult {
  const newExpenses: Expense[] = [];
  const completedPlanIds: string[] = [];
  for (const plan of plans) {
    if (!plan.active) continue;
    const taken = new Set(existing.filter((e) => e.recurringPlanId === plan.id).map((e) => e.date));
    for (const s of skips) if (s.planId === plan.id) taken.add(s.date);
    let generated = existing.filter((e) => e.recurringPlanId === plan.id).length;
    for (const date of occurrenceDates(plan, today)) {
      if (taken.has(date)) continue;
      newExpenses.push({
        id: newId(plan.id, date),
        date,
        merchant: plan.merchant,
        amountCents: plan.amountCents,
        categoryId: plan.categoryId,
        paymentMethodId: plan.paymentMethodId,
        ...(plan.notes ? { notes: plan.notes } : {}),
        recurringPlanId: plan.id,
      });
      generated++;
    }
    if (plan.occurrences != null && generated >= plan.occurrences) completedPlanIds.push(plan.id);
  }
  return { newExpenses, completedPlanIds };
}

export interface UpcomingCharge {
  plan: RecurringPlan;
  date: ISODate;
}

/** PROJECTION ONLY: occurrences of active plans strictly after `from` through `to`. Nothing is saved. */
export function upcomingCharges(
  plans: readonly RecurringPlan[],
  from: ISODate,
  to: ISODate,
): UpcomingCharge[] {
  const out: UpcomingCharge[] = [];
  for (const plan of plans) {
    if (!plan.active) continue;
    for (const date of occurrenceDates(plan, to)) if (date > from) out.push({ plan, date });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.plan.merchant.localeCompare(b.plan.merchant));
}

export function monthlyEquivalentCents(plan: Pick<RecurringPlan, 'frequency' | 'amountCents'>): number {
  return plan.frequency === 'yearly' ? Math.round(plan.amountCents / 12) : plan.amountCents;
}
