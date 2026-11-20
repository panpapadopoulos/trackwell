import { Link } from 'react-router';
import { count } from '@/domain/plural';
import { useId, useMemo, useState } from 'react';
import { formatLong, weekday, type ISODate } from '@/domain/dates';
import { expectedPay } from '@/domain/pay/engine';
import { DEFAULT_REGISTRY, DEMO_SCHOOL } from '@/domain/schedule/registry';
import { minutes, periodsForLunch, resolveSchedule } from '@/domain/schedule/resolve';
import type { LunchVariant, SchedulePeriod } from '@/domain/schedule/types';
import { defaultsFor } from '@/domain/work/defaults';
import {
  COVERAGE_STATUS_LABEL,
  EMPLOYMENT_LABEL,
  FORMAT_LABEL,
  type CoverageBlock,
  type WorkDay,
} from '@/domain/work/types';
import { useData, useDatasetOrThrow } from '../providers/data';
import { EmptyNote, Money, Panel, Pill } from '../ui/primitives';
import { SegmentedControl } from '../ui/SegmentedControl';

const MHS = 'Munster High School';
const PX_PER_MIN = 1.1; // duration is length (period height ∝ minutes)

const KIND_LABEL: Record<SchedulePeriod['kind'], string> = {
  class: 'Class',
  lunch: 'Lunch',
  passing: 'Passing',
  plc: 'PLC',
  pd: 'PD',
  tutorial: 'Tutorial',
  advisory: 'Advisory',
  other: 'Other',
};

function Timetable({
  periods,
  coverage,
}: {
  periods: SchedulePeriod[];
  coverage?: Map<string, CoverageBlock>;
}) {
  return (
    <ol className="flex flex-col gap-1" aria-label="Timetable">
      {periods.map((p) => {
        const len = minutes(p.end) - minutes(p.start);
        const block = coverage?.get(p.splitOf ?? p.id) ?? coverage?.get(p.id);
        const lunch = p.kind === 'lunch';
        return (
          <li
            key={p.id}
            className={`flex gap-3 rounded-ctl px-3 py-1.5 ${lunch ? 'hatched' : block?.status === 'covered' ? 'bg-stamp-tint' : 'bg-raised/60'}`}
            style={{ minHeight: Math.max(36, len * PX_PER_MIN) }}
          >
            <span className="num w-[88px] shrink-0 pt-px text-[0.78125rem] text-faint">
              {p.start}–{p.end}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2 text-[0.84375rem] text-ink">
                {p.label}
                {p.kind !== 'class' && <Pill>{KIND_LABEL[p.kind]}</Pill>}
                {p.lunchVariant && <Pill>{p.lunchVariant} lunch</Pill>}
              </span>
              {block && (
                <span className="mt-0.5 block truncate text-[0.78125rem] text-muted">
                  {COVERAGE_STATUS_LABEL[block.status]}
                  {block.teacherName ? ` · ${block.teacherName}` : ''}
                  {block.room ? ` · Room ${block.room}` : ''}
                  {block.subject ? ` · ${block.subject}` : ''}
                </span>
              )}
            </span>
            <span className="num shrink-0 text-[0.75rem] text-faint">{len} min</span>
          </li>
        );
      })}
    </ol>
  );
}

function CoverageList({ day }: { day: WorkDay }) {
  return (
    <ol className="flex flex-col" aria-label="Coverage by period">
      {day.coverage.map((b) => (
        <li key={b.id} className="flex items-start gap-3 border-b border-rule py-2 last:border-0">
          <span className="w-[72px] shrink-0 text-[0.8125rem] text-faint">{b.label ?? b.periodId}</span>
          <span className="min-w-0 flex-1">
            {b.status === 'covered' ? (
              <>
                <span className="block truncate text-[0.84375rem] text-ink" title={b.teacherName}>
                  {b.teacherName}
                </span>
                <span className="block truncate text-[0.75rem] text-faint">
                  {b.subject} · Room {b.room}
                </span>
              </>
            ) : (
              <span className="text-[0.84375rem] text-faint">{COVERAGE_STATUS_LABEL[b.status]}</span>
            )}
          </span>
          {b.status === 'covered' ? (
            <Pill tone="stamp">Covered</Pill>
          ) : (
            <Pill>{COVERAGE_STATUS_LABEL[b.status]}</Pill>
          )}
        </li>
      ))}
    </ol>
  );
}

export function SchedulePage() {
  const { today, registry, weekDefaults } = useData();
  const ds = useDatasetOrThrow();
  const id = useId();
  const [date, setDate] = useState<ISODate>(today);
  const [school, setSchool] = useState(MHS);
  const [manual, setManual] = useState('');
  const [lunch, setLunch] = useState<LunchVariant>('A');

  const resolved = resolveSchedule(registry, school, date, manual || undefined);
  const def = defaultsFor(date, weekDefaults);
  const sample = useMemo(() => {
    const multi = (ds?.work.days ?? []).filter((d) => d.format === 'multiple' && d.status === 'worked');
    return multi[multi.length - 1] ?? null;
  }, [ds]);
  const schoolSchedules = DEFAULT_REGISTRY.schedules.filter((s) => s.schoolName === school);
  const weekend = weekday(date) === 0 || weekday(date) === 6;

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[72ch] text-[0.84375rem] text-muted">
        Bell schedules are chosen by weekday, with manual overrides. To record a day&rsquo;s coverage,{' '}
        <Link to="/subtrack/assignments?new=1" className="text-ink underline">
          log a work day
        </Link>
        .
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Bell schedule" subtitle={formatLong(date)} id="bell">
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-[0.75rem] text-faint" htmlFor={`${id}-d`}>
              Date
              <input
                id={`${id}-d`}
                type="date"
                value={date}
                onChange={(e) => e.target.value && setDate(e.target.value)}
                className="h-9 rounded-ctl border border-rule-strong bg-surface px-2.5 text-[0.8125rem] text-ink"
              />
            </label>
            <label className="flex flex-col gap-1 text-[0.75rem] text-faint" htmlFor={`${id}-s`}>
              School
              <select
                id={`${id}-s`}
                value={school}
                onChange={(e) => {
                  setSchool(e.target.value);
                  setManual('');
                }}
                className="h-9 rounded-ctl border border-rule-strong bg-surface px-2.5 text-[0.8125rem] text-ink"
              >
                <option value={MHS}>{MHS}</option>
                <option value={DEMO_SCHOOL}>{DEMO_SCHOOL} (synthetic)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[0.75rem] text-faint" htmlFor={`${id}-o`}>
              Schedule
              <select
                id={`${id}-o`}
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                className="h-9 rounded-ctl border border-rule-strong bg-surface px-2.5 text-[0.8125rem] text-ink"
              >
                <option value="">Automatic (by weekday)</option>
                {schoolSchedules.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[0.8125rem] text-muted">
            {def ? (
              <span>
                Default for this day: <span className="text-ink">{EMPLOYMENT_LABEL[def.employmentType]}</span>
                {def.schoolName ? ` at ${def.schoolName}` : ', school chosen per assignment'}. Defaults never
                mark a day as worked.
              </span>
            ) : (
              <span>No default on weekends.</span>
            )}
          </div>
          {!resolved ? (
            <EmptyNote>
              {weekend
                ? 'No school schedule on weekends.'
                : 'No bell schedule is defined for this school and date.'}
            </EmptyNote>
          ) : resolved.schedule.status === 'pending-reference' ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[0.9375rem] font-semibold text-ink">{resolved.schedule.name}</span>
                <Pill tone="warning">Times pending</Pill>
                <span className="text-[0.78125rem] text-faint">
                  {resolved.reason === 'manual' ? 'chosen manually' : 'by weekday'}
                </span>
              </div>
              <EmptyNote>
                Period times, lunch A/B/C splits, PLC/PD and tutorial rows for Munster High School
                2026&ndash;27 will be transcribed from the official bell schedule image. They haven&rsquo;t
                been entered, because Trackwell never guesses them.
              </EmptyNote>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[0.9375rem] font-semibold text-ink">{resolved.schedule.name}</span>
                {resolved.schedule.status === 'synthetic' && <Pill>Synthetic demo times</Pill>}
                <SegmentedControl
                  size="sm"
                  label="Lunch schedule"
                  value={lunch}
                  onChange={setLunch}
                  options={resolved.schedule.lunchVariants.map((v) => ({ value: v, label: `${v} lunch` }))}
                />
              </div>
              <Timetable periods={periodsForLunch(resolved.schedule, lunch)} />
            </div>
          )}
        </Panel>

        <Panel
          title="Multiple coverage"
          subtitle={sample ? `Example from synthetic data · ${formatLong(sample.date)}` : 'Example'}
          id="coverage"
        >
          {!sample ? (
            <EmptyNote>No multiple-coverage day in this dataset.</EmptyNote>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
                <Pill tone="stamp">{EMPLOYMENT_LABEL[sample.employmentType]}</Pill>
                <Pill>{FORMAT_LABEL[sample.format]}</Pill>
                <span className="text-muted">{sample.schoolName}</span>
              </div>
              <CoverageList day={sample} />
              <div className="rounded-ctl bg-raised p-3 text-[0.8125rem]">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-ink">
                    1 {EMPLOYMENT_LABEL[sample.employmentType].toLowerCase()} work day ·{' '}
                    {count(sample.coverage.filter((b) => b.status === 'covered').length, 'period')} covered
                  </span>
                  <span className="num text-ink">
                    <Money cents={expectedPay(sample).netCents} kind="expected" /> net ·{' '}
                    <Money cents={expectedPay(sample).grossCents} /> gross
                  </span>
                </div>
                <p className="mt-1 text-faint">
                  Covering several teachers doesn&rsquo;t change daily pay. The day is paid once.
                </p>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
