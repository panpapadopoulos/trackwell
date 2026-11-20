import { useMemo, useState, type FormEvent } from 'react';
import { ArrowDown, Plus, Trash2 } from 'lucide-react';
import { formatLong, type ISODate } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { expectedPay, hoursBetween } from '@/domain/pay/engine';
import { PAY_RULES_V1 } from '@/domain/pay/rules';
import { resolveSchedule } from '@/domain/schedule/resolve';
import { classRows } from '@/domain/schedule/rows';
import type { BellSchedule, LunchVariant } from '@/domain/schedule/types';
import { defaultsFor } from '@/domain/work/defaults';
import { COVERAGE_STATUS_LABEL, type CoverageStatus, type WorkDay } from '@/domain/work/types';
import { WorkDayInput, fieldErrors } from '@/shared/api';
import { ApiError, api } from '../api/client';
import { useData } from '../providers/data';
import {
  Button,
  Combobox,
  ConfirmDialog,
  Field,
  Input,
  Select,
  Sheet,
  Textarea,
  useNotice,
} from '../ui/forms';
import { classSuggestions, rankClasses, suggestionKey } from '@/domain/work/suggestions';
import { SegmentedControl } from '../ui/SegmentedControl';

type RowStatus = CoverageStatus | '';
interface BlockDraft {
  key: string;
  label: string;
  startTime: string;
  endTime: string;
  status: RowStatus;
  teacherName: string;
  room: string;
  subject: string;
  notes: string;
}

const emptyBlock = (key: string, label = '', start = '', end = ''): BlockDraft => ({
  key,
  label,
  startTime: start,
  endTime: end,
  status: '',
  teacherName: '',
  room: '',
  subject: '',
  notes: '',
});

/** One row per class period: split periods (before/after lunch) merge into their class period. */
export function scheduleRows(schedule: BellSchedule, lunch: LunchVariant): BlockDraft[] {
  return classRows(schedule, lunch).map((r) => emptyBlock(r.id, r.label, r.start, r.end));
}

function teacherHistory(days: readonly WorkDay[]) {
  const map = new Map<string, { room?: string; subject?: string; date: string; count: number }>();
  const note = (name: string | undefined, date: string, room?: string, subject?: string) => {
    if (!name) return;
    const prev = map.get(name);
    if (!prev || date >= prev.date)
      map.set(name, {
        ...(room ? { room } : {}),
        ...(subject ? { subject } : {}),
        date,
        count: (prev?.count ?? 0) + 1,
      });
    else prev.count += 1;
  };
  for (const d of days) {
    note(d.teacherName, d.date, undefined, d.className);
    for (const b of d.coverage) note(b.teacherName, d.date, b.room, b.subject);
  }
  return map;
}

export function WorkDayEditor({
  day,
  initialDate,
  onClose,
  prefill,
  onSubmit,
  title,
  submitLabel,
}: {
  day?: WorkDay;
  initialDate?: ISODate;
  onClose: () => void;
  /** Initial values for a NEW day (e.g. an assistant draft). Never treated as an existing record. */
  prefill?: WorkDay;
  /** Replaces the default save (POST/PUT). Used by the assistant to confirm a draft. */
  onSubmit?: (input: WorkDayInput) => Promise<void>;
  title?: string;
  submitLabel?: string;
}) {
  const { dataset, registry, mutate, live, today, weekDefaults } = useData();
  const notify = useNotice();
  const days = useMemo(() => dataset?.work.days ?? [], [dataset]);
  const seed = day ?? prefill;
  const startDate = seed?.date ?? initialDate ?? today;
  const def = defaultsFor(startDate, weekDefaults);
  const permanentStart = (def?.employmentType ?? 'regular') === 'permanent';

  const [date, setDate] = useState(startDate);
  const [touched, setTouched] = useState(Boolean(seed));
  const [employmentType, setEmploymentType] = useState(
    seed?.employmentType ?? def?.employmentType ?? 'regular',
  );
  const [role, setRole] = useState(seed?.role ?? 'teacher');
  const [dayType, setDayType] = useState<1 | 0.5>(seed?.dayType ?? 1);
  const [schoolName, setSchoolName] = useState(seed?.schoolName ?? def?.schoolName ?? '');
  const [district, setDistrict] = useState(seed?.district ?? def?.district ?? 'Munster');
  const [startTime, setStartTime] = useState(
    seed?.startTime ?? (permanentStart ? PAY_RULES_V1.permanentDefaultStart : '08:00'),
  );
  const [endTime, setEndTime] = useState(
    seed?.endTime ?? (permanentStart ? PAY_RULES_V1.permanentDefaultEnd : '15:00'),
  );
  const [hours, setHours] = useState(String(seed?.hours ?? hoursBetween(startTime, endTime)));
  const [customRate, setCustomRate] = useState(seed?.payRate !== undefined ? String(seed.payRate) : '');
  const [format, setFormat] = useState(seed?.format ?? 'single');
  const [className, setClassName] = useState(seed?.className ?? '');
  const [teacherName, setTeacherName] = useState(seed?.teacherName ?? '');
  const [scheduleChoice, setScheduleChoice] = useState(seed?.scheduleId ?? '');
  const [lunch, setLunch] = useState<LunchVariant>((seed?.lunchVariant as LunchVariant) ?? 'A');
  const [notes, setNotes] = useState(seed?.notes ?? '');
  const [blocks, setBlocks] = useState<Record<string, BlockDraft>>(() =>
    Object.fromEntries(
      (seed?.coverage ?? []).map((b, i) => [
        b.periodId ?? `free-${i}`,
        {
          key: b.periodId ?? `free-${i}`,
          label: b.label ?? '',
          startTime: b.startTime ?? '',
          endTime: b.endTime ?? '',
          status: b.status,
          teacherName: b.teacherName ?? '',
          room: b.room ?? '',
          subject: b.subject ?? '',
          notes: b.notes ?? '',
        },
      ]),
    ),
  );
  const [freeKeys, setFreeKeys] = useState<string[]>(() =>
    (seed?.coverage ?? []).filter((b) => !b.periodId).map((_, i) => `free-${i}`),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const history = useMemo(() => teacherHistory(days), [days]);
  const classes = useMemo(() => classSuggestions(days), [days]);
  /** Earlier classes for a field: the teacher's own first; the exact current text isn't repeated. */
  const classOptions = (teacher: string, query: string) =>
    rankClasses(classes, teacher, query)
      .filter((c) => suggestionKey(c.value) !== suggestionKey(query))
      .map((c) => ({ value: c.value, ...(c.withTeacher ? { hint: `with ${teacher.trim()}` } : {}) }));
  const schools = useMemo(
    () => [...new Set([PAY_RULES_V1.permanentDefaultSchool, ...days.map((d) => d.schoolName)])].sort(),
    [days],
  );
  const districts = useMemo(() => [...new Set(['Munster', ...days.map((d) => d.district)])].sort(), [days]);
  const resolved = resolveSchedule(registry, schoolName, date, scheduleChoice || undefined);
  const schedule = resolved?.schedule;
  const schoolSchedules = registry.schedules.filter((s) => s.schoolName === schoolName);
  const rows = schedule && schedule.periods.length ? scheduleRows(schedule, lunch) : [];

  function onDate(d: string) {
    setDate(d);
    if (touched) return;
    const x = defaultsFor(d, weekDefaults);
    if (!x) return;
    setEmploymentType(x.employmentType);
    if (x.schoolName) setSchoolName(x.schoolName);
    if (x.district) setDistrict(x.district);
    const perm = x.employmentType === 'permanent';
    const s = perm ? PAY_RULES_V1.permanentDefaultStart : '08:00';
    const e = perm ? PAY_RULES_V1.permanentDefaultEnd : '15:00';
    setStartTime(s);
    setEndTime(e);
    setHours(String(hoursBetween(s, e)));
  }
  const touch = () => setTouched(true);
  const setTimes = (s: string, e: string) => {
    setStartTime(s);
    setEndTime(e);
    if (/^\d\d:\d\d$/.test(s) && /^\d\d:\d\d$/.test(e)) setHours(String(hoursBetween(s, e)));
  };

  const block = (r: BlockDraft) => blocks[r.key] ?? r;
  function updateBlock(r: BlockDraft, patch: Partial<BlockDraft>) {
    setBlocks((bs) => {
      const cur = { ...(bs[r.key] ?? r), ...patch };
      if (patch.teacherName !== undefined) {
        const h = history.get(patch.teacherName);
        if (h) {
          if (!cur.room && h.room) cur.room = h.room;
          if (!cur.subject && h.subject) cur.subject = h.subject;
          if (!cur.status) cur.status = 'covered';
        }
      }
      return { ...bs, [r.key]: cur };
    });
  }
  function copyDown(list: BlockDraft[], i: number) {
    const from = block(list[i]!);
    const to = list[i + 1];
    if (!to) return;
    updateBlock(to, {
      status: from.status,
      teacherName: from.teacherName,
      room: from.room,
      subject: from.subject,
    });
  }

  const payRate = customRate ? Number(customRate) : undefined;
  const pay = expectedPay({
    employmentType,
    role,
    dayType,
    hours: Number(hours) || 0,
    ...(payRate ? { payRate } : {}),
  });

  function buildInput(): unknown {
    const list = rows.length ? rows : freeKeys.map((k) => blocks[k] ?? emptyBlock(k));
    const coverage =
      format === 'multiple'
        ? list
            .map(block)
            .filter((b) => b.status)
            .map((b) => ({
              ...(rows.length ? { periodId: b.key } : {}),
              ...(b.label ? { label: b.label } : {}),
              ...(b.startTime ? { startTime: b.startTime } : {}),
              ...(b.endTime ? { endTime: b.endTime } : {}),
              status: b.status,
              ...(b.teacherName.trim() ? { teacherName: b.teacherName.trim() } : {}),
              ...(b.room.trim() ? { room: b.room.trim() } : {}),
              ...(b.subject.trim() ? { subject: b.subject.trim() } : {}),
              ...(b.notes.trim() ? { notes: b.notes.trim() } : {}),
            }))
        : [];
    return {
      date,
      status: 'worked',
      employmentType,
      role,
      format,
      schoolName: schoolName.trim(),
      district: district.trim(),
      dayType,
      startTime,
      endTime,
      hours: Number(hours),
      ...(payRate ? { payRate } : {}),
      ...(format === 'single' && className.trim() ? { className: className.trim() } : {}),
      ...(format === 'single' && teacherName.trim() ? { teacherName: teacherName.trim() } : {}),
      ...(schedule ? { scheduleId: schedule.id } : {}),
      ...(format === 'multiple' && schedule ? { lunchVariant: lunch } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      coverage,
    };
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = WorkDayInput.safeParse(buildInput());
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      setFormError('Some fields need attention.');
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      if (onSubmit) {
        await onSubmit(parsed.data);
        onClose();
        return;
      }
      await mutate(() =>
        day
          ? api.put(`/api/v1/work-days/${day.id}`, { ...parsed.data, updatedAt: day.updatedAt ?? 0 })
          : api.post('/api/v1/work-days', parsed.data),
      );
      notify(day ? 'Work day updated.' : 'Work day saved.');
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setFormError(err.message);
      } else setFormError('Couldn’t save. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!day) return;
    setBusy(true);
    try {
      await mutate(() => api.del(`/api/v1/work-days/${day.id}`));
      notify('Work day deleted.');
      onClose();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Couldn’t delete.');
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  }

  const coveredCount = Object.values(blocks).filter((b) => b.status === 'covered').length;

  return (
    <Sheet
      open
      wide
      onClose={onClose}
      title={title ?? (day ? `Edit work day · ${formatLong(day.date)}` : 'Log a work day')}
      footer={
        <>
          <Button type="submit" form="workday-form" variant="primary" busy={busy} disabled={!live}>
            {submitLabel ?? (day ? 'Save changes' : 'Save work day')}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          {day && (
            <Button
              variant="danger"
              className="ml-auto"
              onClick={() => setConfirmDelete(true)}
              disabled={!live}
            >
              <Trash2 size={15} aria-hidden="true" /> Delete
            </Button>
          )}
          {!live && <p className="w-full text-[0.75rem] text-faint">Demo data is read-only.</p>}
        </>
      }
    >
      <form id="workday-form" onSubmit={save} className="flex flex-col gap-5" noValidate>
        {formError && (
          <p role="alert" className="rounded-ctl bg-danger-tint px-3 py-2 text-[0.8125rem] text-ink">
            {formError}
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Date" error={errors.date}>
            <Input type="date" value={date} onChange={(e) => onDate(e.target.value)} required />
          </Field>
          <Field label="Employment type" hint={!touched && def ? 'From your weekday default' : undefined}>
            <SegmentedControl
              label="Employment type"
              value={employmentType}
              onChange={(v) => {
                touch();
                setEmploymentType(v);
              }}
              options={[
                { value: 'permanent', label: 'Permanent' },
                { value: 'regular', label: 'Regular' },
              ]}
            />
          </Field>
          <Field label="Role">
            <SegmentedControl
              label="Role"
              value={role}
              onChange={(v) => {
                touch();
                setRole(v);
              }}
              options={[
                { value: 'teacher', label: 'Teacher' },
                { value: 'aide', label: 'Assistant' },
              ]}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="School" error={errors.schoolName}>
            <Input
              list="tw-schools"
              value={schoolName}
              onChange={(e) => {
                touch();
                setSchoolName(e.target.value);
              }}
              required
            />
          </Field>
          <Field label="District" error={errors.district}>
            <Input
              list="tw-districts"
              value={district}
              onChange={(e) => {
                touch();
                setDistrict(e.target.value);
              }}
              required
            />
          </Field>
        </div>
        <datalist id="tw-schools">
          {schools.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <datalist id="tw-districts">
          {districts.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Start" error={errors.startTime}>
            <Input
              type="time"
              value={startTime}
              onChange={(e) => {
                touch();
                setTimes(e.target.value, endTime);
              }}
            />
          </Field>
          <Field label="End" error={errors.endTime}>
            <Input
              type="time"
              value={endTime}
              onChange={(e) => {
                touch();
                setTimes(startTime, e.target.value);
              }}
            />
          </Field>
          <Field label="Hours" error={errors.hours} hint="Calculated; editable">
            <Input
              inputMode="decimal"
              className="num"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          </Field>
          <Field label="Day">
            <Select value={String(dayType)} onChange={(e) => setDayType(e.target.value === '0.5' ? 0.5 : 1)}>
              <option value="1">Full day</option>
              <option value="0.5">Half day</option>
            </Select>
          </Field>
        </div>

        <Field label="Assignment format">
          <SegmentedControl
            label="Assignment format"
            value={format}
            onChange={setFormat}
            options={[
              { value: 'single', label: 'Single assignment' },
              { value: 'multiple', label: 'Multiple coverage' },
            ]}
          />
        </Field>

        {format === 'single' ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Class or subject" error={errors.className}>
              <Combobox
                value={className}
                onChange={setClassName}
                options={classOptions(teacherName, className)}
                placeholder="e.g. Biology"
                maxLength={160}
              />
            </Field>
            <Field label="Teacher covered" error={errors.teacherName}>
              <Input
                list="tw-teachers"
                value={teacherName}
                onChange={(e) => setTeacherName(e.target.value)}
              />
            </Field>
          </div>
        ) : (
          <section aria-label="Coverage by period" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <Field
                label="Bell schedule"
                className="min-w-[14rem] flex-1"
                hint={
                  resolved
                    ? resolved.reason === 'manual'
                      ? 'Chosen manually'
                      : resolved.reason === 'override'
                        ? 'Date override'
                        : 'By weekday'
                    : 'No schedule for this school and date: enter periods freely'
                }
              >
                <Select value={scheduleChoice} onChange={(e) => setScheduleChoice(e.target.value)}>
                  <option value="">
                    Automatic{resolved && resolved.reason !== 'manual' ? ` (${resolved.schedule.name})` : ''}
                  </option>
                  {schoolSchedules.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {schedule && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[0.8125rem] font-medium">Lunch</span>
                  <SegmentedControl
                    label="Lunch schedule"
                    value={lunch}
                    onChange={setLunch}
                    options={schedule.lunchVariants.map((v) => ({ value: v, label: v }))}
                  />
                </div>
              )}
            </div>
            {errors.coverage && <p className="text-[0.75rem] text-danger">{errors.coverage}</p>}
            <CoverageGrid
              rows={rows.length ? rows : freeKeys.map((k) => blocks[k] ?? emptyBlock(k))}
              free={!rows.length}
              block={block}
              update={updateBlock}
              classOptions={classOptions}
              copyDown={copyDown}
              remove={(k) => setFreeKeys((ks) => ks.filter((x) => x !== k))}
            />
            {!rows.length && (
              <Button
                size="sm"
                className="self-start"
                onClick={() => setFreeKeys((ks) => [...ks, `free-${Date.now()}`])}
              >
                <Plus size={14} aria-hidden="true" /> Add period
              </Button>
            )}
          </section>
        )}
        <datalist id="tw-teachers">
          {[...history.entries()]
            .sort((a, b) => b[1].count - a[1].count)
            .map(([n]) => (
              <option key={n} value={n} />
            ))}
        </datalist>

        <details className="text-[0.8125rem]">
          <summary className="cursor-pointer text-muted">Custom pay rate and notes</summary>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label={role === 'aide' ? 'Hourly rate ($)' : 'Day rate ($)'}
              hint="Leave empty for the standard rate"
              error={errors.payRate}
            >
              <Input
                inputMode="decimal"
                className="num"
                value={customRate}
                onChange={(e) => setCustomRate(e.target.value)}
                disabled={employmentType === 'permanent'}
              />
            </Field>
            <Field label="Notes" error={errors.notes}>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
        </details>

        <div className="rounded-ctl bg-raised p-3 text-[0.8125rem]" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-ink">
              1 paid work day
              {format === 'multiple'
                ? ` · ${coveredCount} ${coveredCount === 1 ? 'period' : 'periods'} covered`
                : ''}
            </span>
            <span className="num text-ink">
              <span className="expected-figure">{formatMoney(pay.netCents)}</span> net ·{' '}
              {formatMoney(pay.grossCents)} gross
            </span>
          </div>
          <p className="mt-1 text-faint">
            {employmentType === 'permanent'
              ? 'Permanent days pay a flat rate per day.'
              : role === 'aide'
                ? 'Assistant days pay by the hour.'
                : 'Teacher days pay the day rate (half for a half day).'}{' '}
            {format === 'multiple' && 'Covering several teachers doesn’t change daily pay.'}
          </p>
        </div>
      </form>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this work day?"
        body="It disappears from your dashboards and totals. The record is kept in the database history and can be restored by an administrator."
        confirmLabel="Delete work day"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </Sheet>
  );
}

function CoverageGrid({
  rows,
  free,
  block,
  update,
  copyDown,
  remove,
  classOptions,
}: {
  classOptions: (teacher: string, query: string) => { value: string; hint?: string }[];
  rows: BlockDraft[];
  free: boolean;
  block: (r: BlockDraft) => BlockDraft;
  update: (r: BlockDraft, p: Partial<BlockDraft>) => void;
  copyDown: (rows: BlockDraft[], i: number) => void;
  remove: (key: string) => void;
}) {
  if (rows.length === 0) return <p className="text-[0.8125rem] text-faint">No periods yet.</p>;
  return (
    <ol className="flex flex-col gap-2">
      {rows.map((r, i) => {
        const b = block(r);
        const off = b.status === '' || b.status === 'free' || b.status === 'planning';
        return (
          <li
            key={r.key}
            className={`rounded-ctl p-3 ${b.status === 'covered' ? 'bg-stamp-tint' : 'bg-raised/60'}`}
          >
            <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-[9rem_8.5rem_minmax(0,1fr)_6rem_minmax(0,1fr)_auto]">
              <legend className="sr-only">{b.label || `Period ${i + 1}`}</legend>
              {free ? (
                <div className="col-span-2 grid grid-cols-3 gap-2 sm:col-span-1 sm:grid-cols-1">
                  <Input
                    aria-label="Period name"
                    placeholder="Period"
                    value={b.label}
                    onChange={(e) => update(r, { label: e.target.value })}
                  />
                  <Input
                    aria-label="Start"
                    type="time"
                    value={b.startTime}
                    onChange={(e) => update(r, { startTime: e.target.value })}
                  />
                  <Input
                    aria-label="End"
                    type="time"
                    value={b.endTime}
                    onChange={(e) => update(r, { endTime: e.target.value })}
                  />
                </div>
              ) : (
                <div className="col-span-2 flex items-baseline justify-between gap-2 sm:col-span-1 sm:flex-col sm:justify-start sm:gap-0">
                  <span className="text-[0.875rem] font-medium text-ink">{b.label}</span>
                  <span className="num text-[0.75rem] text-faint">
                    {b.startTime}–{b.endTime}
                  </span>
                </div>
              )}
              <Select
                aria-label={`${b.label || 'Period'} status`}
                value={b.status}
                onChange={(e) => update(r, { status: e.target.value as RowStatus })}
              >
                <option value="">Not set</option>
                {(['covered', 'free', 'planning', 'other'] as const).map((s) => (
                  <option key={s} value={s}>
                    {COVERAGE_STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
              <Input
                aria-label={`${b.label || 'Period'} teacher`}
                list="tw-teachers"
                placeholder="Teacher"
                value={b.teacherName}
                disabled={off}
                onChange={(e) => update(r, { teacherName: e.target.value })}
              />
              <Input
                aria-label={`${b.label || 'Period'} room`}
                placeholder="Room"
                value={b.room}
                disabled={off}
                onChange={(e) => update(r, { room: e.target.value })}
              />
              <Combobox
                aria-label={`${b.label || 'Period'} subject`}
                placeholder="Subject or class"
                value={b.subject}
                disabled={off}
                maxLength={160}
                options={classOptions(b.teacherName, b.subject)}
                onChange={(v) => update(r, { subject: v })}
                className="col-span-2 sm:col-span-1"
              />
              <div className="col-span-2 flex justify-end gap-1 sm:col-span-1">
                {i < rows.length - 1 && (
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => copyDown(rows, i)}
                    aria-label={`Copy ${b.label || 'this period'} to the next period`}
                    title="Copy to next period"
                  >
                    <ArrowDown size={15} aria-hidden="true" />
                  </Button>
                )}
                {free && (
                  <Button size="sm" variant="quiet" onClick={() => remove(r.key)} aria-label="Remove period">
                    <Trash2 size={15} aria-hidden="true" />
                  </Button>
                )}
              </div>
            </fieldset>
          </li>
        );
      })}
    </ol>
  );
}
