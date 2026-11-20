import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  addDays,
  addMonths,
  formatLong,
  formatMonthKey,
  monthKey,
  monthRange,
  weekday,
  type ISODate,
} from '@/domain/dates';
import { formatMoney, sumCents } from '@/domain/money';
import { expectedPay } from '@/domain/pay/engine';
import { payPeriodFor } from '@/domain/pay/periods';
import { schoolYearKey, schoolYearLabel } from '@/domain/schoolYear';
import { defaultsFor } from '@/domain/work/defaults';
import { reconcilePeriods } from '@/domain/work/summary';
import type { WorkDay } from '@/domain/work/types';
import { categoryTotals } from '@/domain/expenses/summary';
import { useData, useDatasetOrThrow } from '../providers/data';
import { EmptyNote, Money, Panel, SkeletonLines } from '../ui/primitives';
import { Button } from '../ui/forms';
import { WorkDayEditor } from '../components/WorkDayEditor';

/* ------------------------------ work calendar ------------------------------ */

export function CalendarPage() {
  const { today, payConfig, live, weekDefaults } = useData();
  const ds = useDatasetOrThrow();
  const [month, setMonth] = useState(monthKey(today));
  const [open, setOpen] = useState<{ day?: WorkDay; date: ISODate } | null>(null);
  const periods = useMemo(
    () => (ds ? reconcilePeriods(ds.work.days, ds.work.payments, today, undefined, payConfig) : new Map()),
    [ds, today, payConfig],
  );
  if (!ds) return <SkeletonLines rows={8} />;
  const { from, to } = monthRange(month);
  const start = addDays(from, -((weekday(from) + 6) % 7));
  const cells: ISODate[] = [];
  for (let d = start; d <= to || cells.length % 7 !== 0; d = addDays(d, 1)) cells.push(d);
  const byDate = new Map<string, WorkDay[]>();
  for (const w of ds.work.days)
    if (w.status === 'worked') byDate.set(w.date, [...(byDate.get(w.date) ?? []), w]);
  const monthDays = ds.work.days.filter((w) => w.status === 'worked' && monthKey(w.date) === month);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="quiet"
          onClick={() => setMonth(addMonths(month, -1))}
          aria-label="Previous month"
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </Button>
        <h2 className="min-w-[10rem] text-center text-[1rem] font-semibold" aria-live="polite">
          {formatMonthKey(month, 'long')}
        </h2>
        <Button
          size="sm"
          variant="quiet"
          onClick={() => setMonth(addMonths(month, 1))}
          aria-label="Next month"
        >
          <ChevronRight size={16} aria-hidden="true" />
        </Button>
        <Button size="sm" onClick={() => setMonth(monthKey(today))}>
          Today
        </Button>
        <span className="ml-auto text-[0.8125rem] text-faint">
          {monthDays.length} worked ·{' '}
          <Money cents={sumCents(monthDays.map((d) => expectedPay(d).netCents))} kind="expected" /> expected
        </span>
      </div>
      <div
        className="relative overflow-x-auto rounded-panel bg-surface p-3"
        tabIndex={0}
        role="region"
        aria-label={`Work calendar, ${formatMonthKey(month, 'long')}`}
      >
        <div className="grid min-w-[44rem] grid-cols-7 gap-1">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} aria-hidden="true" className="px-2 py-1 text-[0.75rem] text-faint">
              {d}
            </div>
          ))}
          {cells.map((d) => {
            const work = byDate.get(d) ?? [];
            const inMonth = monthKey(d) === month;
            const def = defaultsFor(d, weekDefaults);
            const planned = work.length === 0 && def && d >= today;
            return (
              <button
                key={d}
                type="button"
                onClick={() => setOpen({ ...(work[0] ? { day: work[0] } : {}), date: d })}
                disabled={!live && work.length === 0}
                aria-current={d === today ? 'date' : undefined}
                className={`hoverable flex min-h-[5.25rem] flex-col items-start gap-1 rounded-ctl p-2 text-left ${work.length ? 'bg-raised' : planned ? 'planned-outline' : ''} ${inMonth ? '' : 'bg-ground/40'} ${d === today ? 'outline outline-1 -outline-offset-1 outline-ink/40' : ''}`}
              >
                <span className="sr-only">{formatLong(d)}</span>
                <span aria-hidden="true" className="num text-[0.75rem] text-faint">
                  {Number(d.slice(8))}
                </span>
                {work.map((w) => {
                  const st = periods.get(payPeriodFor(w.date, payConfig).start);
                  return (
                    <span key={w.id} className="w-full">
                      <span className="block truncate text-[0.75rem] text-ink">{w.schoolName}</span>
                      <span className="flex items-center justify-between gap-1 text-[0.75rem]">
                        <Money
                          cents={expectedPay(w).netCents}
                          kind={st?.status === 'paid' ? 'plain' : 'expected'}
                          className="text-muted"
                        />
                        {st?.status === 'paid' && (
                          <span className="text-[0.6875rem] font-bold text-stamp-ink">Paid</span>
                        )}
                      </span>
                    </span>
                  );
                })}
                {planned && (
                  <span className="text-[0.75rem] text-faint">
                    Planned · {def!.employmentType === 'permanent' ? 'Perm.' : 'Reg.'}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      {open && (
        <WorkDayEditor
          {...(open.day ? { day: open.day } : { initialDate: open.date })}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------ work analytics ------------------------------ */

export function WorkAnalyticsPage() {
  const ds = useDatasetOrThrow();
  if (!ds) return <SkeletonLines rows={8} />;
  const worked = ds.work.days.filter((d) => d.status === 'worked');
  const years = [...new Set(worked.map((d) => schoolYearKey(d.date)))].sort().reverse();
  const rows = years.map((y) => {
    const ds2 = worked.filter((d) => schoolYearKey(d.date) === y);
    const paid = sumCents(
      ds.work.payments.filter((p) => schoolYearKey(p.date) === y).map((p) => p.amountCents),
    );
    const net = sumCents(ds2.map((d) => expectedPay(d).netCents));
    return {
      y,
      days: ds2.length,
      perm: ds2.filter((d) => d.employmentType === 'permanent').length,
      reg: ds2.filter((d) => d.employmentType === 'regular').length,
      half: ds2.filter((d) => d.dayType === 0.5).length,
      net,
      paid,
      perDay: ds2.length ? Math.round(net / ds2.length) : 0,
    };
  });
  const bySchool = [
    ...worked.reduce(
      (m, d) => m.set(d.schoolName, [...(m.get(d.schoolName) ?? []), d]),
      new Map<string, WorkDay[]>(),
    ),
  ]
    .map(([name, xs]) => ({ name, days: xs.length, net: sumCents(xs.map((d) => expectedPay(d).netCents)) }))
    .sort((a, b) => b.days - a.days);
  if (worked.length === 0)
    return <EmptyNote>No work days yet. Analytics appear once you log work.</EmptyNote>;
  return (
    <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Panel title="School years compared" subtitle="Expected by work date; received by payment date">
        <div
          className="relative overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label="School year comparison"
        >
          <table className="w-full min-w-[40rem] border-collapse text-[0.875rem]">
            <thead>
              <tr className="text-[0.75rem] text-faint">
                {[
                  'School year',
                  'Work days',
                  'Permanent',
                  'Regular',
                  'Half days',
                  'Expected',
                  'Received',
                  'Per day',
                ].map((h, i) => (
                  <th
                    key={h}
                    scope="col"
                    className={`border-b border-rule pb-2 font-medium ${i ? 'text-right' : 'text-left'}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.y} className="border-b border-rule last:border-0">
                  <th scope="row" className="py-2 text-left font-medium">
                    {schoolYearLabel(r.y)}
                  </th>
                  <td className="num py-2 text-right">{r.days}</td>
                  <td className="num py-2 text-right">{r.perm}</td>
                  <td className="num py-2 text-right">{r.reg}</td>
                  <td className="num py-2 text-right">{r.half}</td>
                  <td className="py-2 text-right">
                    <Money cents={r.net} />
                  </td>
                  <td className="py-2 text-right">
                    <Money cents={r.paid} kind="received" />
                  </td>
                  <td className="py-2 text-right">
                    <Money cents={r.perDay} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="By school">
        <ul className="flex flex-col">
          {bySchool.map((s) => (
            <li key={s.name} className="flex items-baseline gap-3 border-b border-rule py-2 last:border-0">
              <span className="min-w-0 flex-1 truncate text-[0.875rem]" title={s.name}>
                {s.name}
              </span>
              <span className="num text-[0.8125rem] text-faint">{s.days} days</span>
              <span className="num w-28 text-right text-[0.875rem]">{formatMoney(s.net)}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

/* ------------------------------ expense analytics ------------------------------ */

export function ExpenseAnalyticsPage() {
  const { today } = useData();
  const ds = useDatasetOrThrow();
  if (!ds) return <SkeletonLines rows={8} />;
  const data = ds.expenses;
  const months = Array.from({ length: 6 }, (_, i) => addMonths(monthKey(today), i - 5));
  const inMonth = (m: string) => data.expenses.filter((e) => monthKey(e.date) === m);
  const cats = categoryTotals(
    data.expenses.filter((e) => e.date >= `${months[0]}-01`),
    data.categories,
  );
  if (data.expenses.length === 0)
    return <EmptyNote>No expenses yet. Analytics appear once you add some.</EmptyNote>;
  return (
    <Panel
      title="Spending by category, last 6 months"
      subtitle="Each cell is that month’s total for the category"
    >
      <div
        className="relative overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label="Category by month table"
      >
        <table className="w-full min-w-[44rem] border-collapse text-[0.875rem]">
          <thead>
            <tr className="text-[0.75rem] text-faint">
              <th scope="col" className="border-b border-rule pb-2 text-left font-medium">
                Category
              </th>
              {months.map((m) => (
                <th key={m} scope="col" className="border-b border-rule pb-2 text-right font-medium">
                  {formatMonthKey(m)}
                </th>
              ))}
              <th scope="col" className="border-b border-rule pb-2 text-right font-medium">
                6-month total
              </th>
            </tr>
          </thead>
          <tbody>
            {cats.map((c) => (
              <tr key={c.categoryId} className="border-b border-rule">
                <th scope="row" className="py-2 text-left font-normal">
                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="size-2 rounded-full"
                      style={{ background: c.color }}
                    />
                    {c.name}
                  </span>
                </th>
                {months.map((m) => {
                  const v = sumCents(
                    inMonth(m)
                      .filter((e) => e.categoryId === c.categoryId)
                      .map((e) => e.amountCents),
                  );
                  return (
                    <td key={m} className={`num py-2 text-right ${v ? '' : 'text-faint'}`}>
                      {v ? formatMoney(v, { whole: true }) : '—'}
                    </td>
                  );
                })}
                <td className="num py-2 text-right font-medium">
                  {formatMoney(c.totalCents, { whole: true })}
                </td>
              </tr>
            ))}
            <tr>
              <th scope="row" className="pt-2 text-left font-semibold">
                Total
              </th>
              {months.map((m) => (
                <td key={m} className="num pt-2 text-right font-semibold">
                  {formatMoney(sumCents(inMonth(m).map((e) => e.amountCents)), { whole: true })}
                </td>
              ))}
              <td className="num pt-2 text-right font-semibold">
                {formatMoney(sumCents(cats.map((c) => c.totalCents)), { whole: true })}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
