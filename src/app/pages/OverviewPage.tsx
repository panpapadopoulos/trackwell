import { count } from '@/domain/plural';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { formatMedium, formatMonthKey, formatShort } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { summarizeOverview } from '@/domain/overview';
import { reconcilePeriods } from '@/domain/work/summary';
import type { PayScheduleConfig } from '@/domain/pay/rules';
import type { Dataset } from '@/demo/synthetic';
import { presetLabel } from '@/domain/filters';
import { useData, useDatasetOrThrow } from '../providers/data';
import {
  Block,
  EmptyNote,
  Legend,
  Money,
  Panel,
  Pill,
  SkeletonLines,
  useChartOrTable,
} from '../ui/primitives';
import { MoneyStrip, PaydaysSlip, WeekStrip } from '../components/finance';
import { DataTable, TimeBars } from '../charts/TimeBars';

function useOverview() {
  const { range, today, payConfig } = useData();
  const ds = useDatasetOrThrow();
  return useMemo(
    () =>
      ds ? { ds, o: summarizeOverview(ds.work, ds.expenses, range, today, undefined, payConfig) } : null,
    [ds, range, today, payConfig],
  );
}

function Finding() {
  const v = useOverview();
  if (!v) return <div className="skeleton h-5 w-80" />;
  const { o } = v;
  const next = o.upcomingPaychecks[0];
  const overdue = [...o.overduePaychecks].sort((a, b) => b.period.end.localeCompare(a.period.end))[0];
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.875rem] text-muted">
      {next ? (
        <span>
          Next payday <span className="text-ink">{formatMedium(next.period.expectedPayday)}</span>:{' '}
          <Money cents={next.expectedNetCents} kind="expected" className="text-ink" /> expected for{' '}
          {next.period.label}.
        </span>
      ) : (
        <span>No upcoming paycheck: there&rsquo;s no unpaid work on record.</span>
      )}
      {overdue && (
        <Pill tone="warning">
          No payment recorded for the {formatShort(overdue.period.expectedPayday)} payday
        </Pill>
      )}
    </p>
  );
}

function Strip() {
  const { preset } = useData();
  const v = useOverview();
  if (!v)
    return (
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-panel bg-surface p-5 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <SkeletonLines key={i} rows={2} tall />
        ))}
      </div>
    );
  const { o } = v;
  const scope = presetLabel(preset).toLowerCase();
  return (
    <MoneyStrip
      label="Money summary"
      items={[
        {
          label: 'Income received',
          value: <Money cents={o.receivedCents} kind="received" />,
          caption: `${count(o.paymentCount, 'payment')} · ${scope}`,
          lead: true,
        },
        {
          label: 'Expenses recorded',
          value: <Money cents={o.expensesCents} kind="spent" />,
          caption: `${count(o.expenseCount, 'transaction')} · ${scope}`,
        },
        {
          label: 'Net cash flow',
          value: <Money cents={o.netCashFlowCents} kind="net" />,
          caption: 'Received − expenses · not a balance',
        },
        {
          label: 'Outstanding earnings',
          value: <Money cents={o.expectedUnpaidCents} kind="expected" />,
          caption: o.overduePaychecks.length
            ? `${count(o.overduePaychecks.length, 'pay period')} overdue · earned, not yet paid`
            : 'Earned, not yet paid',
        },
      ]}
    />
  );
}

function CashFlow() {
  const v = useOverview();
  const [table, toggle] = useChartOrTable();
  if (!v) return null;
  const { o } = v;
  const data = o.monthly.map((m) => ({
    m: formatMonthKey(m.month),
    full: formatMonthKey(m.month, 'long'),
    received: m.receivedCents,
    expected: m.expectedUnpaidCents,
    spent: m.expensesCents,
  }));
  const empty = o.monthly.every(
    (m) => m.receivedCents === 0 && m.expensesCents === 0 && m.expectedUnpaidCents === 0,
  );
  return (
    <Panel
      title="Income and expenses by month"
      subtitle="Last 12 months. Received above the line, expenses below; expected pay is outlined in the month it should arrive."
      actions={toggle}
      className="lg:col-span-2"
      id="cashflow"
    >
      <div className="mb-3">
        <Legend
          items={[
            { label: 'Received', form: 'solid', color: 'var(--stamp)' },
            { label: 'Expected, unpaid', form: 'dashed', color: 'var(--stamp)' },
            { label: 'Expenses', form: 'solid', color: 'var(--brass)' },
          ]}
        />
      </div>
      {empty ? (
        <EmptyNote>
          No income or expenses recorded in this period yet. Once payments and expenses exist, each month
          appears here.
        </EmptyNote>
      ) : table ? (
        <DataTable
          caption="Income and expenses by month"
          columns={[
            { key: 'month', label: 'Month' },
            { key: 'received', label: 'Received', numeric: true },
            { key: 'expected', label: 'Expected, unpaid', numeric: true },
            { key: 'spent', label: 'Expenses', numeric: true },
            { key: 'net', label: 'Net', numeric: true },
          ]}
          rows={o.monthly.map((m) => ({
            month: formatMonthKey(m.month, 'long'),
            received: formatMoney(m.receivedCents),
            expected: formatMoney(m.expectedUnpaidCents),
            spent: formatMoney(m.expensesCents),
            net: formatMoney(m.netCents, { signed: true }),
          }))}
        />
      ) : (
        <TimeBars
          ariaLabel="Bar chart of income received, expected pay and expenses by month. Use the Table button for exact values."
          data={data}
          xKey="m"
          fullKey="full"
          unit="cents"
          height={240}
          series={[
            { key: 'received', label: 'Received', color: 'var(--stamp)', form: 'solid', stackId: 'in' },
            {
              key: 'expected',
              label: 'Expected, unpaid',
              color: 'var(--stamp)',
              form: 'dashed',
              stackId: 'in',
            },
            { key: 'spent', label: 'Expenses', color: 'var(--brass)', form: 'solid', below: true },
          ]}
        />
      )}
    </Panel>
  );
}

function Paydays() {
  const v = useOverview();
  const { ds, today, payConfig } = { ...useData(), ds: v?.ds };
  if (!v || !ds) return null;
  const s = v.o;
  const rows = [...s.upcomingPaychecks.slice(0, 2).reverse(), ...s.overduePaychecks];
  // Most recent paid periods (from all work) to complete the slip.
  const paid = summarizePaid(ds, today, payConfig);
  return (
    <Panel
      title="Paydays"
      subtitle="Paid the Friday after each two-week period ends. Stamped only when a payment is recorded."
      className="lg:row-span-2"
      id="paydays"
    >
      <PaydaysSlip
        rows={[...rows, ...paid].slice(0, 6)}
        emptyText="No pay periods yet. Log a work day to start a pay period."
      />
      <Link
        to="/subtrack"
        className="mt-auto self-start pt-3 text-[0.8125rem] text-muted underline hover:text-ink"
      >
        All pay periods
      </Link>
    </Panel>
  );
}

function summarizePaid(ds: Dataset, today: string, cfg?: PayScheduleConfig) {
  return [...reconcilePeriods(ds.work.days, ds.work.payments, today, undefined, cfg).values()]
    .filter((r) => r.status === 'paid')
    .sort((a, b) => b.period.start.localeCompare(a.period.start))
    .slice(0, 4);
}

function ThisWeek() {
  const { today } = useData();
  const ds = useDatasetOrThrow();
  if (!ds) return null;
  return (
    <Panel
      title="This week"
      subtitle="Saved work is filled in. Your default schedule shows as dotted outlines and is never counted as worked."
      id="week"
      className="lg:col-span-2"
    >
      <WeekStrip days={ds.work.days} today={today} />
    </Panel>
  );
}

function UpcomingRecurring() {
  const v = useOverview();
  if (!v) return null;
  const { o } = v;
  return (
    <Panel
      title="Upcoming recurring"
      subtitle={
        <>
          Next 30 days · <Money cents={o.upcomingRecurringCents} kind="projected" /> projected
        </>
      }
      id="recurring"
    >
      {o.upcomingRecurring.length === 0 ? (
        <EmptyNote>No recurring charges in the next 30 days.</EmptyNote>
      ) : (
        <ul className="flex flex-col">
          {o.upcomingRecurring.slice(0, 3).map((c) => (
            <li
              key={`${c.plan.id}-${c.date}`}
              className="flex items-baseline gap-3 border-b border-rule py-2 text-[0.84375rem] last:border-0"
            >
              <span className="num w-14 shrink-0 text-[0.78125rem] text-faint">{formatShort(c.date)}</span>
              <span className="min-w-0 flex-1 truncate text-ink" title={c.plan.merchant}>
                {c.plan.merchant}
              </span>
              <Money cents={c.plan.amountCents} kind="projected" className="shrink-0 text-muted" />
            </li>
          ))}
        </ul>
      )}
      <Link
        to="/expenses"
        className="mt-auto self-start pt-3 text-[0.8125rem] text-muted underline hover:text-ink"
      >
        {o.upcomingRecurring.length > 3 ? `All ${o.upcomingRecurring.length} upcoming charges` : 'Expenses'}
      </Link>
    </Panel>
  );
}

export function OverviewPage() {
  return (
    <div className="flex flex-col gap-4">
      <Finding />
      <Block title="Money summary">
        <Strip />
      </Block>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Block title="Income and expenses by month" className="lg:col-span-2">
          <CashFlow />
        </Block>
        <Block title="Paydays">
          <Paydays />
        </Block>
        <Block title="This week" className="lg:col-span-2">
          <ThisWeek />
        </Block>
        <Block title="Upcoming recurring">
          <UpcomingRecurring />
        </Block>
      </div>
    </div>
  );
}
