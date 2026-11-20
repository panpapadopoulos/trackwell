import { count } from '@/domain/plural';
import { useId, useMemo, useState } from 'react';
import { formatMedium, formatMonthKey, formatShort } from '@/domain/dates';
import { rangeFor, type DateRange } from '@/domain/filters';
import { formatMoney } from '@/domain/money';
import { schoolYearKey, schoolYearLabel } from '@/domain/schoolYear';
import { summarizeWork, type WorkSummary } from '@/domain/work/summary';
import { EMPLOYMENT_LABEL, ROLE_LABEL, FORMAT_LABEL, type EmploymentType } from '@/domain/work/types';
import { useData, useDatasetOrThrow } from '../providers/data';
import { Block, EmptyNote, Legend, Money, Panel, Pill, Stamp, useChartOrTable } from '../ui/primitives';
import { MoneyStrip, PaydaysSlip } from '../components/finance';
import { DataTable, TimeBars } from '../charts/TimeBars';
import { BarList } from '../charts/BarList';

type Scope =
  | { kind: 'global' }
  | { kind: 'sy'; key: string }
  | { kind: 'cy'; year: number }
  | { kind: 'custom'; from: string; to: string };

const selectCls =
  'h-9 rounded-ctl border border-rule-strong bg-surface px-2.5 text-[0.8125rem] text-ink hover:border-faint focus-visible:outline-2';

function Filters({
  schools,
  years,
  calendarYears,
  scope,
  setScope,
  school,
  setSchool,
  type,
  setType,
}: {
  schools: string[];
  years: string[];
  calendarYears: number[];
  scope: Scope;
  setScope: (s: Scope) => void;
  school: string;
  setSchool: (s: string) => void;
  type: '' | EmploymentType;
  setType: (t: '' | EmploymentType) => void;
}) {
  const id = useId();
  const { today } = useData();
  const scopeValue =
    scope.kind === 'global'
      ? 'global'
      : scope.kind === 'sy'
        ? `sy:${scope.key}`
        : scope.kind === 'cy'
          ? `cy:${scope.year}`
          : 'custom';
  return (
    <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filters">
      <label className="flex flex-col gap-1 text-[0.75rem] text-faint" htmlFor={`${id}-scope`}>
        Period
        <select
          id={`${id}-scope`}
          className={selectCls}
          value={scopeValue}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'global') setScope({ kind: 'global' });
            else if (v.startsWith('sy:')) setScope({ kind: 'sy', key: v.slice(3) });
            else if (v.startsWith('cy:')) setScope({ kind: 'cy', year: Number(v.slice(3)) });
            else setScope({ kind: 'custom', from: `${today.slice(0, 4)}-08-01`, to: today });
          }}
        >
          <option value="global">Same as top bar</option>
          <optgroup label="School year (Aug–Jul)">
            {years.map((y) => (
              <option key={y} value={`sy:${y}`}>
                {schoolYearLabel(y)}
              </option>
            ))}
          </optgroup>
          <optgroup label="Calendar year">
            {calendarYears.map((y) => (
              <option key={y} value={`cy:${y}`}>
                {y}
              </option>
            ))}
          </optgroup>
          <option value="custom">Custom range…</option>
        </select>
      </label>
      {scope.kind === 'custom' && (
        <>
          <label className="flex flex-col gap-1 text-[0.75rem] text-faint">
            From
            <input
              type="date"
              className={selectCls}
              value={scope.from}
              max={scope.to}
              onChange={(e) => e.target.value && setScope({ ...scope, from: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-[0.75rem] text-faint">
            To
            <input
              type="date"
              className={selectCls}
              value={scope.to}
              min={scope.from}
              onChange={(e) => e.target.value && setScope({ ...scope, to: e.target.value })}
            />
          </label>
        </>
      )}
      <label className="flex flex-col gap-1 text-[0.75rem] text-faint" htmlFor={`${id}-school`}>
        School
        <select
          id={`${id}-school`}
          className={`${selectCls} max-w-[240px]`}
          value={school}
          onChange={(e) => setSchool(e.target.value)}
        >
          <option value="">All schools</option>
          {schools.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[0.75rem] text-faint" htmlFor={`${id}-type`}>
        Employment type
        <select
          id={`${id}-type`}
          className={selectCls}
          value={type}
          onChange={(e) => setType(e.target.value as '' | EmploymentType)}
        >
          <option value="">Permanent and regular</option>
          <option value="permanent">Permanent only</option>
          <option value="regular">Regular only</option>
        </select>
      </label>
      {(scope.kind !== 'global' || school || type) && (
        <button
          type="button"
          className="pressable h-9 rounded-ctl px-2 text-[0.8125rem] text-muted underline hover:text-ink"
          onClick={() => {
            setScope({ kind: 'global' });
            setSchool('');
            setType('');
          }}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

function PrimaryStrip({ s }: { s: WorkSummary }) {
  const filtered = s.outstandingCents === null;
  return (
    <MoneyStrip
      label="Earnings summary"
      items={[
        {
          label: 'Paid earnings',
          value: <Money cents={s.receivedCents} kind="received" />,
          caption: filtered
            ? 'Payments can’t be split by school or type'
            : 'Payments recorded in this period',
          lead: true,
        },
        {
          label: 'Expected gross',
          value: <Money cents={s.expectedGrossCents} />,
          caption: (
            <>
              Net <Money cents={s.expectedNetCents} />
            </>
          ),
        },
        {
          label: 'Outstanding earnings',
          value: <Money cents={s.outstandingCents} kind="expected" />,
          caption: filtered
            ? 'Not shown while filtered'
            : s.overdueCents
              ? `${formatMoney(s.overdueCents)} overdue`
              : 'Earned, not yet paid',
        },
        {
          label: `This month · ${formatMonthKey(s.currentMonth.month, 'long')}`,
          value: <Money cents={s.currentMonth.expectedNetCents} kind="expected" />,
          caption: (
            <>
              {count(s.currentMonth.days, 'day')} ·{' '}
              <Money cents={s.currentMonth.receivedCents} kind="received" /> received
            </>
          ),
        },
        {
          label: 'Next paycheck',
          value: s.nextPaycheck ? (
            <Money cents={s.nextPaycheck.expectedNetCents} kind="expected" />
          ) : (
            <span className="text-faint">&mdash;</span>
          ),
          caption: s.nextPaycheck
            ? `Estimated ${formatMedium(s.nextPaycheck.period.expectedPayday)}`
            : 'No unpaid work yet',
        },
      ]}
    />
  );
}

function WorkStats({ s }: { s: WorkSummary }) {
  const stats: Array<[string, string | number, string?]> = [
    ['Assignments', s.assignments, s.assignments === 1 ? 'work day' : 'work days'],
    ['Permanent', s.permanentDays, 'days'],
    ['Regular', s.regularDays, 'days'],
    ['Teacher jobs', s.teacherJobs],
    ['Assistant jobs', s.aideJobs],
    ['Full / half days', `${s.fullDays} / ${s.halfDays}`, 'teacher jobs'],
    ['Hours', s.hours.toFixed(1)],
    ['Multiple coverage', s.multipleCoverageDays, `${count(s.coveredPeriods, 'period')} covered`],
  ];
  return (
    <section
      aria-label="Work statistics"
      className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-panel bg-surface p-4 sm:grid-cols-4 md:p-5 xl:grid-cols-8"
    >
      {stats.map(([label, value, sub]) => (
        <div key={label} className="min-w-0">
          <div className="truncate text-[0.78125rem] text-faint">{label}</div>
          <div className="num mt-1 text-[1.125rem] font-semibold text-ink">{value}</div>
          {sub && <div className="truncate text-[0.71875rem] text-faint">{sub}</div>}
        </div>
      ))}
    </section>
  );
}

function VolumeChart({ s }: { s: WorkSummary }) {
  const [table, toggle] = useChartOrTable();
  const data = s.monthly.map((m) => ({
    m: formatMonthKey(m.month),
    full: formatMonthKey(m.month, 'long'),
    permanent: m.permanentDays,
    regular: m.regularDays,
  }));
  return (
    <Panel title="Work days by month" subtitle="By employment type" actions={toggle} id="volume">
      <div className="mb-3">
        <Legend
          items={[
            { label: 'Permanent', form: 'solid', color: 'var(--stamp)' },
            { label: 'Regular', form: 'solid', color: 'var(--teal)' },
          ]}
        />
      </div>
      {s.monthly.length === 0 ? (
        <EmptyNote>No work days in this view.</EmptyNote>
      ) : table ? (
        <DataTable
          caption="Work days by month"
          columns={[
            { key: 'm', label: 'Month' },
            { key: 'p', label: 'Permanent', numeric: true },
            { key: 'r', label: 'Regular', numeric: true },
          ]}
          rows={s.monthly.map((m) => ({
            m: formatMonthKey(m.month, 'long'),
            p: String(m.permanentDays),
            r: String(m.regularDays),
          }))}
        />
      ) : (
        <TimeBars
          ariaLabel="Stacked bars of permanent and regular work days per month"
          data={data}
          xKey="m"
          fullKey="full"
          unit="count"
          series={[
            { key: 'permanent', label: 'Permanent', color: 'var(--stamp)', form: 'solid', stackId: 'd' },
            { key: 'regular', label: 'Regular', color: 'var(--teal)', form: 'solid', stackId: 'd' },
          ]}
        />
      )}
    </Panel>
  );
}

function ExpectedVsPaid({ s }: { s: WorkSummary }) {
  const [table, toggle] = useChartOrTable();
  const filtered = s.receivedCents === null;
  const data = s.monthly.slice(-12).map((m) => ({
    m: formatMonthKey(m.month),
    full: formatMonthKey(m.month, 'long'),
    expected: m.expectedNetCents,
    paid: m.receivedCents,
  }));
  return (
    <Panel
      title="Expected vs paid"
      subtitle={
        filtered
          ? 'Payments aren’t linked to schools or employment types, so only expected pay is shown while filtered.'
          : 'Last 12 months of this view. Expected by work month; paid by the month money arrived.'
      }
      actions={toggle}
      id="exp-paid"
    >
      <div className="mb-3">
        <Legend
          items={[
            { label: 'Expected (earned)', form: 'dashed', color: 'var(--stamp)' },
            { label: 'Paid (received)', form: 'solid', color: 'var(--stamp)' },
          ]}
        />
      </div>
      {s.monthly.length === 0 ? (
        <EmptyNote>No earnings in this view.</EmptyNote>
      ) : table ? (
        <DataTable
          caption="Expected vs paid by month"
          columns={[
            { key: 'm', label: 'Month' },
            { key: 'e', label: 'Expected', numeric: true },
            { key: 'p', label: 'Paid', numeric: true },
          ]}
          rows={s.monthly.map((m) => ({
            m: formatMonthKey(m.month, 'long'),
            e: formatMoney(m.expectedNetCents),
            p: filtered ? '—' : formatMoney(m.receivedCents),
          }))}
        />
      ) : (
        <TimeBars
          ariaLabel="Grouped bars: expected earnings as dashed outlines, paid earnings as solid bars, by month"
          data={data}
          xKey="m"
          fullKey="full"
          unit="cents"
          series={[
            { key: 'expected', label: 'Expected', color: 'var(--stamp)', form: 'dashed' },
            ...(filtered
              ? []
              : [{ key: 'paid', label: 'Paid', color: 'var(--stamp)', form: 'solid' as const }]),
          ]}
        />
      )}
    </Panel>
  );
}

function ByEmployment({ s }: { s: WorkSummary }) {
  const p = s.byEmployment.permanent;
  const r = s.byEmployment.regular;
  return (
    <Panel title="Earnings by employment type" subtitle="Expected net pay" id="by-emp">
      {s.assignments === 0 ? (
        <EmptyNote>No work days in this view.</EmptyNote>
      ) : (
        <>
          <BarList
            ariaLabel="Expected earnings by employment type"
            color="var(--stamp)"
            items={[
              {
                id: 'p',
                label: 'Permanent',
                dot: 'var(--stamp)',
                value: p.netCents,
                display: formatMoney(p.netCents),
                sub: `${p.days} d`,
              },
              {
                id: 'r',
                label: 'Regular',
                dot: 'var(--teal)',
                color: 'var(--teal)',
                value: r.netCents,
                display: formatMoney(r.netCents),
                sub: `${r.days} d`,
              },
            ]}
          />
          <p className="mt-4 text-[0.78125rem] text-faint">
            Permanent days pay a flat $114.27 net / $130.00 gross per day, however many teachers you cover.
            Regular teacher days pay the day rate (half for a half day). Assistant days pay by the hour.
          </p>
        </>
      )}
    </Panel>
  );
}

function Biweekly({ s }: { s: WorkSummary }) {
  const [all, setAll] = useState(false);
  const rows = all ? s.periods : s.periods.slice(0, 6);
  return (
    <Panel
      title="Biweekly expected pay"
      subtitle="Two-week periods, Monday to Sunday (daylight-saving grouping fixed). Paid the Friday after each period ends."
      id="biweekly"
      actions={
        s.periods.length > 6 ? (
          <button
            type="button"
            onClick={() => setAll((a) => !a)}
            className="pressable h-7 rounded-ctl px-2 text-[0.75rem] text-muted underline hover:text-ink"
          >
            {all ? 'Show recent' : `Show all ${s.periods.length}`}
          </button>
        ) : undefined
      }
    >
      <div className={all ? 'max-h-[420px] overflow-auto' : ''}>
        <PaydaysSlip rows={rows} emptyText="No pay periods in this view." />
      </div>
      {s.periods.length > 0 && (
        <dl className="mt-auto flex flex-wrap justify-between gap-x-6 gap-y-1 border-t border-rule-strong pt-3 text-[0.8125rem]">
          <div className="flex gap-2">
            <dt className="text-faint">Received, shown periods</dt>
            <dd>
              <Money cents={rows.reduce((t, r) => t + r.receivedCents, 0)} kind="received" />
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-faint">Still expected</dt>
            <dd>
              <Money
                cents={rows
                  .filter((r) => r.status === 'upcoming' || r.status === 'awaiting')
                  .reduce((t, r) => t + r.expectedNetCents, 0)}
                kind="expected"
              />
            </dd>
          </div>
        </dl>
      )}
    </Panel>
  );
}

function TopClasses({ s }: { s: WorkSummary }) {
  return (
    <Panel title="Top classes" subtitle="Most covered classes and subjects" id="classes">
      {s.topClasses.length === 0 ? (
        <EmptyNote>No classes recorded in this view.</EmptyNote>
      ) : (
        <BarList
          ariaLabel="Most covered classes"
          color="var(--muted)"
          items={s.topClasses.map((c) => ({
            id: c.name,
            label: c.name,
            value: c.count,
            display: `${c.count}×`,
          }))}
        />
      )}
    </Panel>
  );
}

const STATUS: Record<string, { text: string; tone: 'neutral' | 'warning' }> = {
  upcoming: { text: 'Awaiting payday', tone: 'neutral' },
  awaiting: { text: 'No payment recorded', tone: 'warning' },
  'prior-arrangement': { text: 'Prior arrangement', tone: 'neutral' },
};

function Recent({ s }: { s: WorkSummary }) {
  return (
    <Panel
      title="Recent assignments"
      subtitle="Payment status comes from matching recorded payments to pay periods"
      id="recent"
      className="lg:col-span-2"
    >
      {s.recent.length === 0 ? (
        <EmptyNote>No assignments recorded yet. Log a work day from the Daily schedule.</EmptyNote>
      ) : (
        <>
          <ul className="flex flex-col sm:hidden" aria-label="Most recent assignments">
            {s.recent.map(({ day, netCents, status, paidOn }) => (
              <li key={day.id} className="flex items-start gap-3 border-b border-rule py-2.5 last:border-0">
                <span className="num w-12 shrink-0 whitespace-nowrap pt-px text-[0.78125rem] text-faint">
                  {formatShort(day.date)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.84375rem] text-ink">{day.schoolName}</span>
                  <span className="block truncate text-[0.75rem] text-faint">
                    {EMPLOYMENT_LABEL[day.employmentType]} ·{' '}
                    {day.format === 'multiple'
                      ? FORMAT_LABEL.multiple
                      : (day.className ?? ROLE_LABEL[day.role])}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <Money
                    cents={netCents}
                    kind={status === 'paid' ? 'plain' : 'expected'}
                    className="text-[0.84375rem]"
                  />
                  {status === 'paid' && paidOn ? (
                    <Stamp date={paidOn} compact />
                  ) : (
                    <Pill tone={STATUS[status]!.tone}>{STATUS[status]!.text}</Pill>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <div className="relative hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[560px] border-collapse text-[0.84375rem]">
              <caption className="sr-only">Most recent assignments</caption>
              <thead>
                <tr className="text-[0.75rem] text-faint">
                  <th scope="col" className="border-b border-rule pb-1.5 text-left font-medium">
                    Date
                  </th>
                  <th scope="col" className="border-b border-rule pb-1.5 text-left font-medium">
                    Assignment
                  </th>
                  <th scope="col" className="border-b border-rule pb-1.5 text-right font-medium">
                    Expected
                  </th>
                  <th scope="col" className="border-b border-rule pb-1.5 pl-3 text-right font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {s.recent.map(({ day, netCents, status, paidOn }) => (
                  <tr key={day.id} className="border-b border-rule last:border-0">
                    <td className="num whitespace-nowrap py-2 pr-3 align-top text-muted">
                      {formatShort(day.date)}
                    </td>
                    <td className="max-w-0 py-2 pr-3 align-top">
                      <div className="truncate text-ink" title={day.schoolName}>
                        {day.schoolName}
                      </div>
                      <div className="truncate text-[0.75rem] text-faint">
                        {EMPLOYMENT_LABEL[day.employmentType]} · {ROLE_LABEL[day.role]} ·{' '}
                        {day.format === 'multiple'
                          ? `${FORMAT_LABEL.multiple} (${day.coverage.filter((b) => b.status === 'covered').length})`
                          : (day.className ?? FORMAT_LABEL.single)}
                        {day.dayType === 0.5 ? ' · Half day' : ''}
                      </div>
                    </td>
                    <td className="py-2 text-right align-top">
                      <Money cents={netCents} kind={status === 'paid' ? 'plain' : 'expected'} />
                    </td>
                    <td className="py-2 pl-3 text-right align-top">
                      {status === 'paid' && paidOn ? (
                        <Stamp date={paidOn} compact />
                      ) : (
                        <Pill tone={STATUS[status]!.tone}>{STATUS[status]!.text}</Pill>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}

export function SubtrackPage() {
  const { range: globalRange, today, payConfig } = useData();
  const ds = useDatasetOrThrow();
  const [scope, setScope] = useState<Scope>({ kind: 'global' });
  const [school, setSchool] = useState('');
  const [type, setType] = useState<'' | EmploymentType>('');

  const range: DateRange =
    scope.kind === 'global'
      ? globalRange
      : scope.kind === 'sy'
        ? rangeFor({ kind: 'schoolYear', key: scope.key }, today)
        : scope.kind === 'cy'
          ? rangeFor({ kind: 'calendarYear', year: scope.year }, today)
          : rangeFor({ kind: 'custom', from: scope.from, to: scope.to }, today);

  const s = useMemo(
    () =>
      ds
        ? summarizeWork(
            ds.work.days,
            ds.work.payments,
            { range, ...(school ? { schoolName: school } : {}), ...(type ? { employmentType: type } : {}) },
            today,
            undefined,
            payConfig,
          )
        : null,
    [ds, range, school, type, today, payConfig],
  );
  const years = useMemo(
    () => [...new Set((ds?.work.days ?? []).map((d) => schoolYearKey(d.date)))].sort().reverse(),
    [ds],
  );
  const calendarYears = useMemo(
    () => [...new Set((ds?.work.days ?? []).map((d) => Number(d.date.slice(0, 4))))].sort().reverse(),
    [ds],
  );

  if (!ds || !s) return <SubtrackSkeleton />;
  return (
    <div className="flex flex-col gap-4">
      <Filters
        schools={s.schools}
        years={years}
        calendarYears={calendarYears}
        scope={scope}
        setScope={setScope}
        school={school}
        setSchool={setSchool}
        type={type}
        setType={setType}
      />
      <PrimaryStrip s={s} />
      <WorkStats s={s} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <VolumeChart s={s} />
        <ExpectedVsPaid s={s} />
        <Biweekly s={s} />
        <div className="flex flex-col gap-4">
          <ByEmployment s={s} />
          <TopClasses s={s} />
        </div>
        <Recent s={s} />
      </div>
    </div>
  );
}

function SubtrackSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      {['Earnings summary', 'Work statistics', 'Work days by month', 'Expected vs paid'].map((t) => (
        <Block key={t} title={t}>
          <span />
        </Block>
      ))}
    </div>
  );
}
