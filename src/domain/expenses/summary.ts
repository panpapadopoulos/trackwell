import { addDays, addMonths, monthKey, type ISODate, type MonthKey } from '../dates';
import { inRange, type DateRange } from '../filters';
import { sumCents, type Cents } from '../money';
import { monthlyEquivalentCents, upcomingCharges, type UpcomingCharge } from './recurring';
import type { Budget, Category, Expense, ExpenseData } from './types';

export interface CategoryTotal {
  category: Category | null;
  categoryId: string;
  name: string;
  color: string;
  totalCents: Cents;
  count: number;
}

export interface BudgetLine {
  categoryId: string | null;
  name: string;
  budgetCents: Cents;
  spentCents: Cents;
  remainingCents: Cents;
  /** spent / budget, uncapped (1.2 = 20% over). */
  ratio: number;
}

export interface ExpenseSummary {
  totalCents: Cents;
  count: number;
  thisMonthCents: Cents;
  month: MonthKey;
  /** Overall budget for `month`; null when none is set. */
  monthlyBudgetCents: Cents | null;
  remainingBudgetCents: Cents | null;
  largestCategory: CategoryTotal | null;
  byCategory: CategoryTotal[];
  /** Last 12 months ending at `month`, zero-filled. */
  trend: { month: MonthKey; totalCents: Cents }[];
  recent: Expense[];
  budgetLines: BudgetLine[];
  recurring: { activeCount: number; monthlyCostCents: Cents; next30: UpcomingCharge[]; next30Cents: Cents };
  averageMonthCents: Cents;
}

const UNCATEGORIZED = { name: 'Uncategorized', color: '#7d7a75' };

export function budgetFor(
  budgets: readonly Budget[],
  month: MonthKey,
  categoryId: string | null,
): Budget | null {
  return (
    budgets.find((b) => b.month === month && b.categoryId === categoryId) ??
    budgets.find((b) => b.month === '*' && b.categoryId === categoryId) ??
    null
  );
}

export function categoryTotals(
  expenses: readonly Expense[],
  categories: readonly Category[],
): CategoryTotal[] {
  const map = new Map<string, CategoryTotal>();
  for (const e of expenses) {
    let t = map.get(e.categoryId);
    if (!t) {
      const c = categories.find((x) => x.id === e.categoryId) ?? null;
      t = {
        category: c,
        categoryId: e.categoryId,
        name: c?.name ?? UNCATEGORIZED.name,
        color: c?.color ?? UNCATEGORIZED.color,
        totalCents: 0,
        count: 0,
      };
      map.set(e.categoryId, t);
    }
    t.totalCents += e.amountCents;
    t.count += 1;
  }
  return [...map.values()].sort((a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name));
}

/**
 * @param range the dashboard's selected period (totals, categories, recent)
 * @param month the month used for budget-vs-actual and "this month" (normally today's)
 */
export function summarizeExpenses(
  data: ExpenseData,
  range: DateRange,
  month: MonthKey,
  today: ISODate,
  filter: { categoryId?: string; paymentMethodId?: string } = {},
): ExpenseSummary {
  const matches = (e: Expense) =>
    (!filter.categoryId || e.categoryId === filter.categoryId) &&
    (!filter.paymentMethodId || e.paymentMethodId === filter.paymentMethodId);
  const all = data.expenses.filter(matches);
  const scoped = all.filter((e) => inRange(e.date, range));
  const monthExpenses = all.filter((e) => monthKey(e.date) === month);
  const byCategory = categoryTotals(scoped, data.categories);
  const monthByCategory = categoryTotals(monthExpenses, data.categories);

  const thisMonthCents = sumCents(monthExpenses.map((e) => e.amountCents));
  const overall = budgetFor(data.budgets, month, null);
  const budgetLines: BudgetLine[] = data.categories
    .filter((c) => !c.archived)
    .map((c): BudgetLine | null => {
      const b = budgetFor(data.budgets, month, c.id);
      if (!b) return null;
      const spent = monthByCategory.find((t) => t.categoryId === c.id)?.totalCents ?? 0;
      return {
        categoryId: c.id,
        name: c.name,
        budgetCents: b.amountCents,
        spentCents: spent,
        remainingCents: b.amountCents - spent,
        ratio: b.amountCents > 0 ? spent / b.amountCents : 0,
      };
    })
    .filter((x): x is BudgetLine => x !== null)
    .sort((a, b) => b.ratio - a.ratio);

  const trend: ExpenseSummary['trend'] = [];
  for (let i = 11; i >= 0; i--) {
    const m = addMonths(month, -i);
    trend.push({
      month: m,
      totalCents: sumCents(all.filter((e) => monthKey(e.date) === m).map((e) => e.amountCents)),
    });
  }

  const months = new Set(scoped.map((e) => monthKey(e.date)));
  const total = sumCents(scoped.map((e) => e.amountCents));
  const active = data.recurringPlans.filter((p) => p.active);
  const next30 = upcomingCharges(active, today, addDays(today, 30));

  return {
    totalCents: total,
    count: scoped.length,
    thisMonthCents,
    month,
    monthlyBudgetCents: overall?.amountCents ?? null,
    remainingBudgetCents: overall ? overall.amountCents - thisMonthCents : null,
    largestCategory: byCategory[0] ?? null,
    byCategory,
    trend,
    recent: [...scoped].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, 8),
    budgetLines,
    recurring: {
      activeCount: active.length,
      monthlyCostCents: sumCents(active.map(monthlyEquivalentCents)),
      next30,
      next30Cents: sumCents(next30.map((c) => c.plan.amountCents)),
    },
    averageMonthCents: months.size ? Math.round(total / months.size) : 0,
  };
}
