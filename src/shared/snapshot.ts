import type {
  Budget,
  Category,
  Expense,
  PaymentMethod,
  RecurringPlan,
  RecurringSkip,
} from '../domain/expenses/types';
import type { WeeklyDefaults } from '../domain/work/defaults';
import type { IncomePayment, WorkDay } from '../domain/work/types';

export interface PayPeriodOverride {
  periodStart: string;
  payday: string;
  note?: string;
}

export interface ScheduleDateOverride {
  schoolName: string;
  date: string;
  scheduleId: string;
}

/** GET /api/v1/snapshot: everything the single user owns, read in one transaction. Read-only. */
export interface Snapshot {
  workDays: WorkDay[];
  payments: IncomePayment[];
  expenses: Expense[];
  categories: Category[];
  paymentMethods: PaymentMethod[];
  recurringPlans: RecurringPlan[];
  recurringSkips: RecurringSkip[];
  budgets: Budget[];
  payPeriodOverrides: PayPeriodOverride[];
  scheduleOverrides: ScheduleDateOverride[];
  /** Current weekday defaults (latest row per weekday effective on or before serverToday). */
  employmentDefaults: WeeklyDefaults;
  /** Assistant preferences (persistent context). */
  assistant: { usualLunch: 'A' | 'B' | 'C' };
  serverToday: string;
}
