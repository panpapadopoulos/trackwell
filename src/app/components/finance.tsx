import { count } from '@/domain/plural';
import type { ReactNode } from 'react';
import {
  addDays,
  formatMedium,
  formatShort,
  formatWeekdayShort,
  weekday,
  type ISODate,
} from '@/domain/dates';
import { expectedPay } from '@/domain/pay/engine';
import { defaultsFor } from '@/domain/work/defaults';
import { EMPLOYMENT_LABEL, type WorkDay } from '@/domain/work/types';
import type { PeriodRow } from '@/domain/work/summary';
import { Money, Pill, Stamp } from '../ui/primitives';
import { useData } from '../providers/data';

export interface StripItem {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  /** The figure that answers the screen's question: set largest. */
  lead?: boolean;
}

/** One container split by 1px dividers (taste: group, don't box; no tile per KPI). */
export function MoneyStrip({ items, label }: { items: StripItem[]; label: string }) {
  return (
    <section
      aria-label={label}
      className="grid grid-cols-2 overflow-hidden rounded-panel bg-surface lg:grid-flow-col lg:auto-cols-fr"
    >
      {items.map((it, i) => (
        <div
          key={it.label}
          className={[
            'min-w-0 border-rule p-4 md:p-5',
            i % 2 === 1 ? 'border-l' : '',
            i >= 2 ? 'border-t lg:border-t-0' : '',
            i > 0 ? 'lg:border-l' : '',
            it.lead ? 'col-span-2 lg:col-span-1' : '',
            // odd tail on the 2-column phone grid spans both columns (no orphan cell)
            !it.lead && i === items.length - 1 && items.filter((x) => !x.lead).length % 2 === 1
              ? 'col-span-2 lg:col-span-1'
              : '',
            it.lead && items.length % 2 === 0 ? '' : '',
          ].join(' ')}
        >
          <div className="text-[0.78125rem] text-faint">{it.label}</div>
          <div
            className={`mt-1.5 whitespace-nowrap font-semibold tracking-[-0.02em] text-ink ${it.lead ? 'text-[1.75rem] md:text-[2rem]' : 'text-[1.25rem] md:text-[1.375rem]'}`}
          >
            {it.value}
          </div>
          {it.caption && <div className="mt-1 truncate text-[0.78125rem] text-faint">{it.caption}</div>}
        </div>
      ))}
    </section>
  );
}

/** Week cells are narrow on phones: short forms, full form in the title tooltip. */
const SHORT_EMPLOYMENT = { permanent: 'Perm.', regular: 'Reg.' } as const;

const STATUS_TEXT: Record<PeriodRow['status'], string> = {
  paid: 'Paid',
  upcoming: 'Expected',
  awaiting: 'No payment recorded',
  'prior-arrangement': 'Prior arrangement',
};

/**
 * THE SIGNATURE: the Paydays slip, ruled like a library date-due card.
 * Columns: pay period · expected payday · amount. A stamp appears ONLY when a
 * real payment record exists; expected amounts stay dashed and unstamped.
 */
export function PaydaysSlip({ rows, emptyText }: { rows: PeriodRow[]; emptyText: string }) {
  if (rows.length === 0) return <p className="text-[0.8125rem] text-muted">{emptyText}</p>;
  return (
    <table className="w-full border-collapse text-[0.84375rem]">
      <caption className="sr-only">Pay periods with expected payday, amount and payment status</caption>
      <thead>
        <tr className="text-[0.75rem] text-faint">
          <th scope="col" className="border-b border-rule-strong pb-1.5 text-left font-medium">
            Pay period
          </th>
          <th scope="col" className="border-b border-rule-strong pb-1.5 text-left font-medium">
            Payday
          </th>
          <th scope="col" className="border-b border-rule-strong pb-1.5 text-right font-medium">
            Amount
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const paid = r.status === 'paid';
          return (
            <tr key={r.period.start} className="border-b border-rule last:border-0">
              <td className="py-2.5 pr-2 align-top">
                <div className="text-ink">{r.period.label}</div>
                <div className="text-[0.75rem] text-faint">
                  {r.days} {r.days === 1 ? 'day' : 'days'} · {r.hours.toFixed(1)} h
                </div>
              </td>
              <td className="py-2.5 pr-2 align-top">
                <div className="num text-muted">
                  {formatShort(paid ? r.paymentDates[0]! : r.period.expectedPayday)}
                </div>
                <div className="text-[0.75rem] text-faint">
                  {paid
                    ? 'received'
                    : r.status === 'awaiting'
                      ? 'was due'
                      : r.status === 'upcoming'
                        ? 'expected'
                        : '—'}
                </div>
              </td>
              <td className="py-2.5 text-right align-top">
                <div className="flex flex-col items-end gap-1">
                  <Money
                    cents={paid ? r.receivedCents : r.expectedNetCents}
                    kind={paid ? 'received' : 'expected'}
                  />
                  {paid ? (
                    <Stamp date={r.paymentDates[0]!} compact />
                  ) : r.status === 'awaiting' ? (
                    <Pill tone="warning">{STATUS_TEXT[r.status]}</Pill>
                  ) : (
                    <span className="text-[0.75rem] text-faint">{STATUS_TEXT[r.status]}</span>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** This week Mon–Fri: saved work (solid) vs defaults (dotted, never counted as worked). */
export function WeekStrip({ days, today }: { days: readonly WorkDay[]; today: ISODate }) {
  const { weekDefaults } = useData();
  const wd = weekday(today);
  const monday = addDays(today, wd === 0 ? -6 : 1 - wd);
  const cells = [0, 1, 2, 3, 4].map((i) => addDays(monday, i));
  return (
    <div
      className="relative -mx-1 overflow-x-auto px-1 pb-1"
      tabIndex={0}
      role="region"
      aria-label="This week, scrollable"
    >
      <ol className="grid grid-cols-[repeat(5,minmax(76px,1fr))] gap-2" aria-label="This week">
        {cells.map((date) => {
          const worked = days.find((d) => d.date === date && d.status === 'worked');
          const def = defaultsFor(date, weekDefaults);
          const isToday = date === today;
          return (
            <li
              key={date}
              className={`min-w-0 rounded-[6px] px-2 py-2.5 ${worked ? 'bg-raised' : 'planned-outline'} ${isToday ? 'outline outline-1 -outline-offset-1 outline-ink/40' : ''}`}
              aria-current={isToday ? 'date' : undefined}
            >
              <div className="flex items-baseline justify-between gap-1">
                <span className="text-[0.8125rem] font-semibold text-ink">{formatWeekdayShort(date)}</span>
                <span className="num text-[0.75rem] text-faint">{Number(date.slice(8))}</span>
              </div>
              <div
                className="mt-1 truncate text-[0.75rem] text-muted"
                title={
                  [
                    worked
                      ? EMPLOYMENT_LABEL[worked.employmentType]
                      : def
                        ? EMPLOYMENT_LABEL[def.employmentType]
                        : '',
                    worked?.schoolName ?? def?.schoolName ?? '',
                  ]
                    .filter(Boolean)
                    .join(' · ') || undefined
                }
              >
                {worked
                  ? SHORT_EMPLOYMENT[worked.employmentType]
                  : def
                    ? SHORT_EMPLOYMENT[def.employmentType]
                    : 'No default'}
              </div>
              <div className="mt-1.5 text-[0.78125rem]">
                {worked ? (
                  <Money cents={expectedPay(worked).netCents} kind="expected" />
                ) : (
                  <span className="text-faint">{date < today ? 'Not logged' : 'Planned'}</span>
                )}
              </div>
              {worked?.format === 'multiple' && (
                <div className="mt-1 truncate text-[0.71875rem] text-faint">
                  {count(worked.coverage.filter((b) => b.status === 'covered').length, 'cover')}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function formatPayday(row: PeriodRow | null): string {
  return row ? formatMedium(row.period.expectedPayday) : '—';
}
