import type { ISODate, MonthKey } from '../dates';
import type { Cents } from '../money';

export interface Expense {
  id: string;
  date: ISODate;
  merchant: string;
  amountCents: Cents;
  categoryId: string;
  paymentMethodId: string;
  notes?: string;
  recurringPlanId?: string;
  source?: { system: 'expenses' | 'trackwell' | 'synthetic'; legacyId?: string };
  /** Server version (epoch ms) for optimistic concurrency; absent for unsaved/synthetic records. */
  updatedAt?: number;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  archived?: boolean;
  /** Server version (epoch ms) for optimistic concurrency; absent for unsaved/synthetic records. */
  updatedAt?: number;
}

/**
 * Formerly "Account". Bank balances are RETIRED: there's deliberately no
 * balance field here. Legacy balances are preserved only in the private
 * migration archive (legacy_archive table), never in the app model.
 */
export interface PaymentMethod {
  id: string;
  name: string;
  type: string;
  archived?: boolean;
  /** Server version (epoch ms) for optimistic concurrency; absent for unsaved/synthetic records. */
  updatedAt?: number;
}

export interface RecurringPlan {
  id: string;
  merchant: string;
  amountCents: Cents;
  categoryId: string;
  paymentMethodId: string;
  notes?: string;
  frequency: 'monthly' | 'yearly';
  startDate: ISODate;
  /** undefined ⇒ ongoing; N ⇒ ends after N occurrences. */
  occurrences?: number;
  active: boolean;
  showMonthlyEquivalent?: boolean;
  /** Server version (epoch ms) for optimistic concurrency; absent for unsaved/synthetic records. */
  updatedAt?: number;
}

/** An occurrence the user deleted. Prevents the legacy "resurrection" on next load. */
export interface RecurringSkip {
  planId: string;
  date: ISODate;
}

export interface Budget {
  id: string;
  /** A specific month, or '*' for every month. Specific beats '*'. */
  month: MonthKey | '*';
  /** null ⇒ overall monthly budget. */
  categoryId: string | null;
  amountCents: Cents;
  /** Server version (epoch ms) for optimistic concurrency; absent for unsaved/synthetic records. */
  updatedAt?: number;
}

export interface ExpenseData {
  expenses: Expense[];
  categories: Category[];
  paymentMethods: PaymentMethod[];
  recurringPlans: RecurringPlan[];
  recurringSkips: RecurringSkip[];
  budgets: Budget[];
}
