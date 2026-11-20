import { count } from '@/domain/plural';
import { useId, useMemo, useState } from 'react';
import {
  addDays,
  formatLong,
  formatMonthKey,
  formatShort,
  monthKey,
  weekday,
  type ISODate,
} from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { presetLabel } from '@/domain/filters';
import { summarizeExpenses, type ExpenseSummary } from '@/domain/expenses/summary';
import { upcomingCharges } from '@/domain/expenses/recurring';
import type { ExpenseData } from '@/domain/expenses/types';
import { useData, useDatasetOrThrow } from '../providers/data';
import { EmptyNote, Legend, Money, Panel, Pill, SkeletonLines, useChartOrTable } from '../ui/primitives';
import { MoneyStrip } from '../components/finance';
import { BarList } from '../charts/BarList';
import { DataTable, TimeBars } from '../charts/TimeBars';

const selectCls =
  'h-9 rounded-ctl border border-rule-strong bg-surface px-2.5 text-[0.8125rem] text-ink hover:border-faint';

function Strip({ s, scope }: { s: ExpenseSummary; scope: string }) {
  const over = s.remainingBudgetCents !== null && s.remainingBudgetCents < 0;
  return (
    <MoneyStrip
      label="Spending summary"
      items={[
        {
          label: `Spent in ${formatMonthKey(s.month, 'long').split(' ')[0]}`,
          value: <Money cents={s.thisMonthCents} />,
          caption:
            s.monthlyBudgetCents !== null ? (
              <>
                of <Money cents={s.monthlyBudgetCents} /> budget
              </>
            ) : (
              'No monthly budget set'
            ),
          lead: true,
        },
        {
          label: over ? 'Over budget' : 'Remaining budget',
          value:
            s.remainingBudgetCents === null ? (
              <span className="text-faint">&mdash;</span>
            ) : (
              <span className={over ? 'text-danger' : ''}>
                <Money cents={Math.abs(s.remainingBudgetCents)} />
              </span>
            ),
          caption:
            s.remainingBudgetCents === null
              ? 'Set a budget to track this'
              : over
                ? 'Spending is above this month’s budget'
                : 'Left to spend this month',
        },
        {
          label: 'Total expenses',
          value: <Money cents={s.totalCents} />,
          caption: `${count(s.count, 'transaction')} · ${scope}`,
        },
        {
          label: 'Largest category',
          value: s.largestCategory ? (
            <span className="block truncate text-[1.125rem] md:text-[1.25rem]" title={s.largestCategory.name}>
              {s.largestCategory.name}
            </span>
          ) : (
            <span className="text-faint">&mdash;</span>
          ),
          caption: s.largestCategory ? <Money cents={s.largestCategory.totalCents} /> : 'No expenses yet',
        },
        {
          label: 'Recurring',
          value: <Money cents={s.recurring.monthlyCostCents} />,
          caption: `${count(s.recurring.activeCount, 'active plan')} · per month`,
        },
      ]}
    />
  );
}

function ByCategory({ s }: { s: ExpenseSummary }) {
  const total = s.totalCents || 1;
  return (
    <Panel title="Spending by category" subtitle="Share of expenses in the selected period" id="by-cat">
      {s.byCategory.length === 0 ? (
        <EmptyNote>No expenses in this period.</EmptyNote>
      ) : (
        <BarList
          ariaLabel="Spending by category"
          color="var(--brass)"
          items={s.byCategory.slice(0, 8).map((c) => ({
            id: c.categoryId,
            label: c.name,
            dot: c.color,
            value: c.totalCents,
            display: formatMoney(c.totalCents),
            sub: `${((c.totalCents / total) * 100).toFixed(1)}%`,
          }))}
        />
      )}
    </Panel>
  );
}

function Trend({ s }: { s: ExpenseSummary }) {
  const [table, toggle] = useChartOrTable();
  const data = s.trend.map((t) => ({
    m: formatMonthKey(t.month),
    full: formatMonthKey(t.month, 'long'),
    spent: t.totalCents,
  }));
  return (
    <Panel
      title="Monthly spending"
      subtitle="Last 12 months"
      actions={toggle}
      id="trend"
      className="lg:col-span-2"
    >
      <div className="mb-3">
        <Legend
          items={[
            { label: 'Spent', form: 'solid', color: 'var(--brass)' },
            ...(s.monthlyBudgetCents !== null
              ? [{ label: 'Monthly budget', form: 'dashed' as const, color: 'var(--muted)' }]
              : []),
          ]}
        />
      </div>
      {s.trend.every((t) => t.totalCents === 0) ? (
        <EmptyNote>No spending in the last 12 months.</EmptyNote>
      ) : table ? (
        <DataTable
          caption="Monthly spending"
          columns={[
            { key: 'm', label: 'Month' },
            { key: 'v', label: 'Spent', numeric: true },
          ]}
          rows={s.trend.map((t) => ({ m: formatMonthKey(t.month, 'long'), v: formatMoney(t.totalCents) }))}
        />
      ) : (
        <TimeBars
          ariaLabel="Bar chart of spending per month for the last 12 months"
          data={data}
          xKey="m"
          fullKey="full"
          unit="cents"
          height={240}
          series={[{ key: 'spent', label: 'Spent', color: 'var(--brass)', form: 'solid' }]}
          {...(s.monthlyBudgetCents !== null
            ? { reference: { value: s.monthlyBudgetCents, label: 'Budget' } }
            : {})}
        />
      )}
    </Panel>
  );
}

function BudgetVsActual({ s }: { s: ExpenseSummary }) {
  return (
    <Panel title="Budget vs actual" subtitle={`${formatMonthKey(s.month, 'long')} · by category`} id="budget">
      {s.budgetLines.length === 0 ? (
        <EmptyNote>No category budgets set. Budgets help you see where a month is heading.</EmptyNote>
      ) : (
        <ul className="flex flex-col gap-3.5">
          {s.budgetLines.map((b) => {
            const over = b.remainingCents < 0;
            const pct = Math.min(b.ratio, 1) * 100;
            return (
              <li key={b.categoryId ?? 'all'} className="min-w-0">
                <div className="flex items-baseline justify-between gap-3 text-[0.8125rem]">
                  <span className="truncate text-ink" title={b.name}>
                    {b.name}
                  </span>
                  <span className="num shrink-0 text-muted">
                    <span className="text-ink">{formatMoney(b.spentCents)}</span> /{' '}
                    {formatMoney(b.budgetCents)}
                  </span>
                </div>
                <div
                  className="relative mt-1.5 h-2 rounded-full bg-raised"
                  role="img"
                  aria-label={`${b.name}: ${Math.round(b.ratio * 100)}% of budget used`}
                >
                  <div
                    className="h-2 rounded-full"
                    style={{ width: `${pct}%`, background: over ? 'var(--danger)' : 'var(--brass)' }}
                  />
                </div>
                <div className="mt-1 text-[0.75rem]">
                  {over ? (
                    <span className="text-danger">Over by {formatMoney(-b.remainingCents)}</span>
                  ) : (
                    <span className="text-faint">{formatMoney(b.remainingCents)} left</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/** Recurring calendar: the next 5 weeks as a Mon–Sun grid, charges placed on their dates. */
function RecurringCalendar({ data, today }: { data: ExpenseData; today: ISODate }) {
  const start = addDays(today, -((weekday(today) + 6) % 7));
  const end = addDays(start, 34);
  const charges = upcomingCharges(data.recurringPlans, addDays(start, -1), end);
  const cells = Array.from({ length: 35 }, (_, i) => addDays(start, i));
  const total = charges.filter((c) => c.date > today).reduce((sum, c) => sum + c.plan.amountCents, 0);
  return (
    <Panel
      title="Recurring calendar"
      subtitle={
        <>
          Next charges · <Money cents={total} kind="projected" /> still to come in this view
        </>
      }
      id="rec-cal"
      className="lg:col-span-2"
    >
      {data.recurringPlans.filter((p) => p.active).length === 0 ? (
        <EmptyNote>No active recurring expenses.</EmptyNote>
      ) : (
        <div
          className="relative overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label="Recurring charges by date, next five weeks"
        >
          <div className="grid min-w-[560px] grid-cols-7 gap-px overflow-hidden rounded-ctl bg-rule">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} aria-hidden="true" className="bg-surface px-2 py-1 text-[0.75rem] text-faint">
                {d}
              </div>
            ))}
            {cells.map((d) => {
              const due = charges.filter((c) => c.date === d);
              const past = d < today;
              return (
                <div
                  key={d}
                  className={`min-h-[58px] px-2 py-1.5 ${past ? 'bg-raised/40' : 'bg-surface'} ${d === today ? 'outline outline-1 -outline-offset-1 outline-ink/40' : ''}`}
                >
                  <span className="sr-only">
                    {formatLong(d)}
                    {past ? ' (past)' : ''}
                    {due.length === 0 ? ', no charges' : ''}
                  </span>
                  <div aria-hidden="true" className="num text-[0.71875rem] text-faint">
                    {d.slice(8) === '01' ? formatShort(d) : Number(d.slice(8))}
                  </div>
                  {due.map((c) => (
                    <div
                      key={c.plan.id}
                      className="mt-0.5 truncate rounded-[3px] bg-brass-tint px-1 text-[0.71875rem] text-ink"
                      title={`${c.plan.merchant} · ${formatMoney(c.plan.amountCents)}`}
                    >
                      <span className="num">
                        {formatMoney(c.plan.amountCents, { whole: c.plan.amountCents >= 100000 })}
                      </span>{' '}
                      {c.plan.merchant}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Panel>
  );
}

function Recent({ s, data }: { s: ExpenseSummary; data: ExpenseData }) {
  const cat = (id: string) => data.categories.find((c) => c.id === id);
  const method = (id: string) => data.paymentMethods.find((m) => m.id === id)?.name ?? 'Unknown method';
  return (
    <Panel title="Recent transactions" id="recent-tx" className="lg:col-span-3">
      {s.recent.length === 0 ? (
        <EmptyNote>No transactions in this period.</EmptyNote>
      ) : (
        <ul className="flex flex-col">
          {s.recent.map((e) => {
            const c = cat(e.categoryId);
            return (
              <li key={e.id} className="flex items-start gap-3 border-b border-rule py-2 last:border-0">
                <span className="num w-14 shrink-0 whitespace-nowrap pt-px text-[0.78125rem] text-faint">
                  {formatShort(e.date)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.84375rem] text-ink" title={e.merchant}>
                    {e.merchant}
                  </span>
                  <span className="flex items-center gap-1.5 truncate text-[0.75rem] text-faint">
                    <span
                      aria-hidden="true"
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ background: c?.color ?? 'var(--faint)' }}
                    />
                    {c?.name ?? 'Uncategorized'} · {method(e.paymentMethodId)}
                    {e.recurringPlanId && <Pill>Recurring</Pill>}
                  </span>
                </span>
                <Money cents={e.amountCents} kind="spent" className="shrink-0 text-[0.84375rem] text-ink" />
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function ExpensesPage() {
  const { range, today, preset } = useData();
  const ds = useDatasetOrThrow();
  const id = useId();
  const [categoryId, setCategoryId] = useState('');
  const [methodId, setMethodId] = useState('');
  const s = useMemo(
    () =>
      ds
        ? summarizeExpenses(ds.expenses, range, monthKey(today), today, {
            ...(categoryId ? { categoryId } : {}),
            ...(methodId ? { paymentMethodId: methodId } : {}),
          })
        : null,
    [ds, range, today, categoryId, methodId],
  );
  if (!ds || !s)
    return (
      <div className="rounded-panel bg-surface p-5" aria-busy="true">
        <SkeletonLines rows={6} />
      </div>
    );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filters">
        <label className="flex flex-col gap-1 text-[0.75rem] text-faint" htmlFor={`${id}-cat`}>
          Category
          <select
            id={`${id}-cat`}
            className={`${selectCls} max-w-[240px]`}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">All categories</option>
            {ds.expenses.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[0.75rem] text-faint" htmlFor={`${id}-pm`}>
          Payment method
          <select
            id={`${id}-pm`}
            className={selectCls}
            value={methodId}
            onChange={(e) => setMethodId(e.target.value)}
          >
            <option value="">All methods</option>
            {ds.expenses.paymentMethods.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Strip s={s} scope={presetLabel(preset).toLowerCase()} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Trend s={s} />
        <BudgetVsActual s={s} />
        <ByCategory s={s} />
        <RecurringCalendar data={ds.expenses} today={today} />
        <Recent s={s} data={ds.expenses} />
      </div>
    </div>
  );
}
