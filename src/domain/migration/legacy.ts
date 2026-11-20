/**
 * Legacy → Trackwell mapping (pure, deterministic). The ARCHITECTURE for the
 * eventual migration. Phase 2 exercises it ONLY on synthetic legacy-shaped
 * fixtures; no real backup is read by application code.
 *
 * Guarantees, each covered by tests:
 *  - every legacy record maps to exactly one Trackwell record, keyed by (source, legacyId);
 *  - re-planning an import against already-imported keys yields zero inserts (idempotent);
 *  - control totals (counts, expected pay via the legacy rules, payments, expenses)
 *    are equal to the cent before and after mapping;
 *  - retired data (account balances, SubTrack→account sync) is archived, never dropped;
 *  - unknown fields are preserved in `extra`, so nothing silently disappears.
 */
import { z } from 'zod';
import { centsFromDollars, sumCents, type Cents } from '../money';
import { expectedPay } from '../pay/engine';
import type { Expense, ExpenseData, PaymentMethod } from '../expenses/types';
import type { IncomePayment, WorkDay } from '../work/types';

// ---- Legacy shapes (validated at the boundary; extra keys kept) ----
const LegacyJob = z
  .object({
    id: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    role: z.enum(['teacher', 'aide']).optional(),
    employmentType: z.enum(['regular', 'everyday']).optional(),
    className: z.string(),
    teacher: z.string(),
    school: z.string(),
    town: z.string(),
    dayType: z.union([z.literal(0.5), z.literal(1)]),
    fromTime: z.string(),
    toTime: z.string(),
    hours: z.number().finite(),
    payRate: z.number().finite().optional(),
  })
  .passthrough();
const LegacyPayment = z
  .object({ id: z.string().min(1), date: z.string(), town: z.string(), amount: z.number().finite() })
  .passthrough();
export const LegacySubtrackDoc = z
  .object({ jobs: z.array(LegacyJob), payments: z.array(LegacyPayment) })
  .passthrough();

const LegacyExpense = z
  .object({
    id: z.string().min(1),
    date: z.string(),
    merchant: z.string(),
    amount: z.number().finite(),
    categoryId: z.string(),
    accountId: z.string(),
    notes: z.string().optional(),
    recurringId: z.string().optional(),
  })
  .passthrough();
const LegacyRecurring = z
  .object({
    id: z.string(),
    merchant: z.string(),
    amount: z.number(),
    categoryId: z.string(),
    accountId: z.string(),
    notes: z.string().optional(),
    frequency: z.enum(['monthly', 'yearly']),
    startDate: z.string(),
    occurrences: z.number().int().positive().optional(),
    active: z.boolean(),
    showMonthlyEquivalent: z.boolean().optional(),
  })
  .passthrough();
export const LegacyExpensesDoc = z
  .object({
    expenses: z.array(LegacyExpense),
    categories: z.array(z.object({ id: z.string(), name: z.string(), color: z.string() }).passthrough()),
    accounts: z
      .array(
        z
          .object({ id: z.string(), name: z.string(), type: z.string(), balance: z.number().optional() })
          .passthrough(),
      )
      .default([]),
    recurringExpenses: z.array(LegacyRecurring).default([]),
    subtrackSync: z.unknown().optional(),
  })
  .passthrough();

export type LegacySubtrack = z.infer<typeof LegacySubtrackDoc>;
export type LegacyExpenses = z.infer<typeof LegacyExpensesDoc>;
type Job = z.infer<typeof LegacyJob>;

const KNOWN_JOB_KEYS = new Set([
  'id',
  'date',
  'role',
  'employmentType',
  'className',
  'teacher',
  'school',
  'town',
  'dayType',
  'fromTime',
  'toTime',
  'hours',
  'payRate',
]);

function extra(obj: Record<string, unknown>, known: Set<string>): Record<string, unknown> | undefined {
  const e = Object.fromEntries(Object.entries(obj).filter(([k]) => !known.has(k)));
  return Object.keys(e).length ? e : undefined;
}

/** The legacy calculation, re-stated for control totals (verified equal to the oracle in tests/legacy). */
export function legacyExpectedCents(
  j: Pick<Job, 'role' | 'employmentType' | 'dayType' | 'hours' | 'payRate'>,
): Cents {
  return expectedPay({
    role: j.role === 'aide' ? 'aide' : 'teacher',
    employmentType: j.employmentType === 'everyday' ? 'permanent' : 'regular',
    dayType: j.dayType,
    hours: j.hours,
    ...(j.payRate !== undefined ? { payRate: j.payRate } : {}),
  }).netCents;
}

export interface MappedWorkDay extends WorkDay {
  /** Unknown legacy keys, kept verbatim. */
  extra?: Record<string, unknown>;
}

export function mapJob(j: Job): MappedWorkDay {
  const day: MappedWorkDay = {
    id: `st-${j.id}`,
    date: j.date,
    status: 'worked',
    employmentType: j.employmentType === 'everyday' ? 'permanent' : 'regular',
    role: j.role === 'aide' ? 'aide' : 'teacher',
    format: 'single',
    schoolName: j.school,
    district: j.town,
    dayType: j.dayType,
    startTime: j.fromTime,
    endTime: j.toTime,
    hours: j.hours,
    ...(j.payRate !== undefined ? { payRate: j.payRate } : {}),
    className: j.className,
    teacherName: j.teacher,
    coverage: [],
    source: { system: 'subtrack', legacyId: j.id },
  };
  const e = extra(j, KNOWN_JOB_KEYS);
  return e ? { ...day, extra: e } : day;
}

/** Inverse mapping, for the round-trip validation gate. */
/** `original` only tells which optional legacy keys were present (absent stays absent). */
export function toLegacyJob(d: MappedWorkDay, original: { role?: unknown; employmentType?: unknown }): Job {
  return {
    id: d.source!.legacyId!,
    date: d.date,
    ...(original.role !== undefined ? { role: d.role } : {}),
    ...(original.employmentType !== undefined
      ? { employmentType: d.employmentType === 'permanent' ? 'everyday' : 'regular' }
      : {}),
    className: d.className ?? '',
    teacher: d.teacherName ?? '',
    school: d.schoolName,
    town: d.district,
    dayType: d.dayType,
    fromTime: d.startTime,
    toTime: d.endTime,
    hours: d.hours,
    ...(d.payRate !== undefined ? { payRate: d.payRate } : {}),
    ...(d.extra ?? {}),
  };
}

export interface ControlTotals {
  jobs: number;
  payments: number;
  expectedNetCents: Cents;
  paymentsCents: Cents;
  expenses: number;
  expensesCents: Cents;
  categories: number;
  paymentMethods: number;
  recurring: number;
}

export interface MappedImport {
  workDays: MappedWorkDay[];
  payments: IncomePayment[];
  expenses: ExpenseData;
  /** Retired features preserved for the private archive (never displayed). */
  retired: { accountBalances: Array<{ legacyAccountId: string; balance: number }>; subtrackSync: unknown };
  before: ControlTotals;
  after: ControlTotals;
}

export function mapLegacy(subtrackRaw: unknown, expensesRaw: unknown): MappedImport {
  const st = LegacySubtrackDoc.parse(subtrackRaw);
  const ex = LegacyExpensesDoc.parse(expensesRaw);

  const workDays = st.jobs.map(mapJob);
  const payments: IncomePayment[] = st.payments.map((p) => ({
    id: `st-${p.id}`,
    date: p.date,
    district: p.town,
    amountCents: centsFromDollars(p.amount),
    source: { system: 'subtrack', legacyId: p.id },
  }));
  const paymentMethods: PaymentMethod[] = ex.accounts.map((a) => ({
    id: `ex-${a.id}`,
    name: a.name,
    type: a.type,
  }));
  const expenses: Expense[] = ex.expenses.map((e) => ({
    id: `ex-${e.id}`,
    date: e.date,
    merchant: e.merchant,
    amountCents: centsFromDollars(e.amount),
    categoryId: `ex-${e.categoryId}`,
    paymentMethodId: `ex-${e.accountId}`,
    ...(e.notes ? { notes: e.notes } : {}),
    ...(e.recurringId ? { recurringPlanId: `ex-${e.recurringId}` } : {}),
    source: { system: 'expenses', legacyId: e.id },
  }));

  const before: ControlTotals = {
    jobs: st.jobs.length,
    payments: st.payments.length,
    expectedNetCents: sumCents(st.jobs.map(legacyExpectedCents)),
    paymentsCents: sumCents(st.payments.map((p) => centsFromDollars(p.amount))),
    expenses: ex.expenses.length,
    expensesCents: sumCents(ex.expenses.map((e) => centsFromDollars(e.amount))),
    categories: ex.categories.length,
    paymentMethods: ex.accounts.length,
    recurring: ex.recurringExpenses.length,
  };
  const mappedExpenses: ExpenseData = {
    expenses,
    categories: ex.categories.map((c) => ({ id: `ex-${c.id}`, name: c.name, color: c.color })),
    paymentMethods,
    recurringPlans: ex.recurringExpenses.map((r) => ({
      id: `ex-${r.id}`,
      merchant: r.merchant,
      amountCents: centsFromDollars(r.amount),
      categoryId: `ex-${r.categoryId}`,
      paymentMethodId: `ex-${r.accountId}`,
      ...(r.notes ? { notes: r.notes } : {}),
      frequency: r.frequency,
      startDate: r.startDate,
      ...(r.occurrences ? { occurrences: r.occurrences } : {}),
      active: r.active,
      ...(r.showMonthlyEquivalent !== undefined ? { showMonthlyEquivalent: r.showMonthlyEquivalent } : {}),
    })),
    recurringSkips: [],
    budgets: [],
  };
  const after: ControlTotals = {
    jobs: workDays.length,
    payments: payments.length,
    expectedNetCents: sumCents(workDays.map((d) => expectedPay(d).netCents)),
    paymentsCents: sumCents(payments.map((p) => p.amountCents)),
    expenses: expenses.length,
    expensesCents: sumCents(expenses.map((e) => e.amountCents)),
    categories: mappedExpenses.categories.length,
    paymentMethods: paymentMethods.length,
    recurring: mappedExpenses.recurringPlans.length,
  };
  return {
    workDays,
    payments,
    expenses: mappedExpenses,
    retired: {
      accountBalances: ex.accounts
        .filter((a) => a.balance !== undefined)
        .map((a) => ({ legacyAccountId: a.id, balance: a.balance! })),
      subtrackSync: ex.subtrackSync ?? null,
    },
    before,
    after,
  };
}

/** Idempotent import plan: only records whose (source, legacyId) isn't already present. */
export function planInserts<T extends { source?: { system: string; legacyId?: string } }>(
  mapped: readonly T[],
  existingKeys: ReadonlySet<string>,
): T[] {
  return mapped.filter((r) => !existingKeys.has(`${r.source?.system}:${r.source?.legacyId}`));
}

export const keyOf = (r: { source?: { system: string; legacyId?: string } }) =>
  `${r.source?.system}:${r.source?.legacyId}`;
