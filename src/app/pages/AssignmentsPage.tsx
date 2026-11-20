import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { formatShort, formatWeekdayShort } from '@/domain/dates';
import { formatMoney, sumCents } from '@/domain/money';
import { expectedPay } from '@/domain/pay/engine';
import { payPeriodFor } from '@/domain/pay/periods';
import { count } from '@/domain/plural';
import { reconcilePeriods, type PeriodPayStatus } from '@/domain/work/summary';
import {
  EMPLOYMENT_LABEL,
  FORMAT_LABEL,
  ROLE_LABEL,
  type EmploymentType,
  type WorkDay,
} from '@/domain/work/types';
import { useData, useDatasetOrThrow } from '../providers/data';
import { EmptyNote, Money, Pill, SkeletonLines, Stamp } from '../ui/primitives';
import { Button, Field, Input, Select } from '../ui/forms';
import { WorkDayEditor } from '../components/WorkDayEditor';

const STATUS: Record<PeriodPayStatus, { text: string; tone: 'neutral' | 'warning' }> = {
  paid: { text: 'Paid', tone: 'neutral' },
  upcoming: { text: 'Awaiting payday', tone: 'neutral' },
  awaiting: { text: 'Overdue', tone: 'warning' },
  'prior-arrangement': { text: 'Prior arrangement', tone: 'neutral' },
};

function haystack(d: WorkDay): string {
  return [
    d.schoolName,
    d.district,
    d.className,
    d.teacherName,
    d.notes,
    ...d.coverage.flatMap((b) => [b.teacherName, b.room, b.subject, b.notes]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function AssignmentsPage() {
  const { today, payConfig, live } = useData();
  const ds = useDatasetOrThrow();
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [type, setType] = useState<'' | EmploymentType>('');
  const [format, setFormat] = useState<'' | WorkDay['format']>('');
  const [editing, setEditing] = useState<WorkDay | 'new' | null>(() =>
    new URLSearchParams(location.search).get('new') === '1' ? 'new' : null,
  );

  const days = useMemo(() => ds?.work.days.filter((d) => d.status === 'worked') ?? [], [ds]);
  const periods = useMemo(
    () => (ds ? reconcilePeriods(ds.work.days, ds.work.payments, today, undefined, payConfig) : new Map()),
    [ds, today, payConfig],
  );
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return days
      .filter(
        (d) =>
          (!from || d.date >= from) &&
          (!to || d.date <= to) &&
          (!type || d.employmentType === type) &&
          (!format || d.format === format) &&
          (!needle || haystack(d).includes(needle)),
      )
      .sort((a, b) => b.date.localeCompare(a.date) || a.schoolName.localeCompare(b.schoolName));
  }, [days, q, from, to, type, format]);

  if (!ds) return <SkeletonLines rows={8} />;
  const filtered = Boolean(q || from || to || type || format);
  const total = sumCents(rows.map((d) => expectedPay(d).netCents));
  const statusOf = (d: WorkDay) => periods.get(payPeriodFor(d.date, payConfig).start);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Search" className="min-w-[14rem] flex-1">
          <div className="relative">
            <Search
              size={15}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
            />
            <Input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="School, teacher, room, subject…"
              className="pl-9"
            />
          </div>
        </Field>
        <Field label="From">
          <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value as '' | EmploymentType)}>
            <option value="">All</option>
            <option value="permanent">Permanent</option>
            <option value="regular">Regular</option>
          </Select>
        </Field>
        <Field label="Format">
          <Select value={format} onChange={(e) => setFormat(e.target.value as '' | WorkDay['format'])}>
            <option value="">All</option>
            <option value="single">Single</option>
            <option value="multiple">Multiple coverage</option>
          </Select>
        </Field>
        <Button
          variant="primary"
          onClick={() => setEditing('new')}
          disabled={!live}
          title={live ? undefined : 'Demo data is read-only'}
        >
          <Plus size={16} aria-hidden="true" /> Log work day
        </Button>
      </div>

      <section aria-label="Assignments" className="rounded-panel bg-surface p-4 md:p-5">
        <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[0.875rem] font-semibold">{count(rows.length, 'work day')}</h2>
          <span className="text-[0.8125rem] text-faint">
            <Money cents={total} kind="expected" /> expected net{filtered ? ' · filtered' : ''}
          </span>
        </header>
        {rows.length === 0 ? (
          <EmptyNote
            action={
              filtered ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setQ('');
                    setFrom('');
                    setTo('');
                    setType('');
                    setFormat('');
                  }}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          >
            {filtered
              ? 'No work days match these filters.'
              : 'No work days yet. Log your first day to start tracking pay.'}
          </EmptyNote>
        ) : (
          <>
            <ul className="flex flex-col md:hidden" aria-label="Work days">
              {rows.map((d) => {
                const st = statusOf(d);
                return (
                  <li key={d.id} className="border-b border-rule last:border-0">
                    <button
                      type="button"
                      onClick={() => setEditing(d)}
                      className="hoverable flex w-full items-start gap-3 rounded-ctl py-2.5 text-left"
                    >
                      <span className="num w-12 shrink-0 text-[0.8125rem] text-faint">
                        {formatShort(d.date)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.875rem] text-ink">{d.schoolName}</span>
                        <span className="block truncate text-[0.75rem] text-faint">
                          {EMPLOYMENT_LABEL[d.employmentType]} ·{' '}
                          {d.format === 'multiple'
                            ? `${d.coverage.filter((b) => b.status === 'covered').length} covered`
                            : (d.className ?? ROLE_LABEL[d.role])}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <Money
                          cents={expectedPay(d).netCents}
                          kind={st?.status === 'paid' ? 'plain' : 'expected'}
                          className="text-[0.875rem]"
                        />
                        {st?.status === 'paid' && st.paymentDates[0] ? (
                          <Stamp date={st.paymentDates[0]} compact />
                        ) : st ? (
                          <Pill tone={STATUS[st.status as PeriodPayStatus].tone}>
                            {STATUS[st.status as PeriodPayStatus].text}
                          </Pill>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="hidden md:block">
              <table className="w-full border-collapse text-[0.875rem]">
                <caption className="sr-only">Work days</caption>
                <thead>
                  <tr className="text-[0.75rem] text-faint">
                    <th scope="col" className="border-b border-rule pb-2 text-left font-medium">
                      Date
                    </th>
                    <th scope="col" className="border-b border-rule pb-2 text-left font-medium">
                      School
                    </th>
                    <th scope="col" className="border-b border-rule pb-2 text-left font-medium">
                      Assignment
                    </th>
                    <th scope="col" className="border-b border-rule pb-2 text-right font-medium">
                      Hours
                    </th>
                    <th scope="col" className="border-b border-rule pb-2 text-right font-medium">
                      Expected
                    </th>
                    <th scope="col" className="border-b border-rule pb-2 text-right font-medium">
                      Status
                    </th>
                    <th scope="col" className="border-b border-rule pb-2">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => {
                    const st = statusOf(d);
                    return (
                      <tr key={d.id} className="border-b border-rule last:border-0">
                        <td className="num whitespace-nowrap py-2 pr-3 text-muted">
                          {formatWeekdayShort(d.date)} {formatShort(d.date)}
                        </td>
                        <td className="max-w-0 py-2 pr-3">
                          <div className="truncate text-ink" title={d.schoolName}>
                            {d.schoolName}
                          </div>
                          <div className="truncate text-[0.75rem] text-faint">{d.district}</div>
                        </td>
                        <td className="max-w-0 py-2 pr-3">
                          <div className="truncate text-ink">
                            {EMPLOYMENT_LABEL[d.employmentType]} · {ROLE_LABEL[d.role]}
                            {d.dayType === 0.5 ? ' · Half day' : ''}
                          </div>
                          <div className="truncate text-[0.75rem] text-faint">
                            {d.format === 'multiple'
                              ? `${FORMAT_LABEL.multiple}: ${
                                  d.coverage
                                    .filter((b) => b.status === 'covered')
                                    .map((b) => b.teacherName)
                                    .filter(Boolean)
                                    .join(', ') || 'no teachers recorded'
                                }`
                              : [d.className, d.teacherName].filter(Boolean).join(' · ') ||
                                FORMAT_LABEL.single}
                          </div>
                        </td>
                        <td className="num py-2 pr-3 text-right text-muted">{d.hours.toFixed(2)}</td>
                        <td className="py-2 pr-3 text-right">
                          <Money
                            cents={expectedPay(d).netCents}
                            kind={st?.status === 'paid' ? 'plain' : 'expected'}
                          />
                        </td>
                        <td className="py-2 pr-3 text-right">
                          {st?.status === 'paid' && st.paymentDates[0] ? (
                            <Stamp date={st.paymentDates[0]} compact />
                          ) : st ? (
                            <Pill tone={STATUS[st.status as PeriodPayStatus].tone}>
                              {STATUS[st.status as PeriodPayStatus].text}
                            </Pill>
                          ) : null}
                        </td>
                        <td className="py-2 text-right">
                          <Button
                            size="sm"
                            variant="quiet"
                            onClick={() => setEditing(d)}
                            aria-label={`Edit work day ${formatShort(d.date)} at ${d.schoolName}`}
                          >
                            Edit
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className="mt-3 text-[0.75rem] text-faint">
          Totals use the preserved SubTrack pay rules. {formatMoney(total)} expected across the rows shown.
        </p>
      </section>

      {editing && (
        <WorkDayEditor {...(editing === 'new' ? {} : { day: editing })} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
