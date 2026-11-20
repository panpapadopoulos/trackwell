import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { formatMoney, centsFromDollars } from '@/domain/money';
import { PAY_RULES_V1, PAY_SCHEDULE_V1 } from '@/domain/pay/rules';
import type { WeeklyDefaults } from '@/domain/work/defaults';
import { EMPLOYMENT_LABEL } from '@/domain/work/types';
import { useTheme, type ThemePreference } from '../providers/theme';
import { DEMO_TOGGLES, useData, type DatasetChoice } from '../providers/data';
import { EmploymentDefaultsInput, fieldErrors } from '@/shared/api';
import { ApiError, api } from '../api/client';
import { Button, Field, Input, Select, useNotice } from '../ui/forms';
import { Panel } from '../ui/primitives';
import { SegmentedControl } from '../ui/SegmentedControl';

const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;

const DATASETS: { value: DatasetChoice; label: string; help: string }[] = [
  { value: 'api', label: 'Your records', help: 'The real database (this is what you normally use).' },
  { value: 'synthetic', label: 'Synthetic demo', help: 'Realistic, generated records. No real data.' },
  { value: 'one', label: 'One of each', help: 'A single record of everything: every count is exactly 1.' },
  { value: 'empty', label: 'Empty', help: 'A first run with no records.' },
  { value: 'worst-case', label: 'Stress test', help: 'Very long names, huge amounts, 3,000+ transactions.' },
  { value: 'loading', label: 'Loading', help: 'Shows every block’s loading skeleton.' },
  {
    value: 'error',
    label: 'Load failure',
    help: 'Shows each block’s error state. Nothing is ever shown as $0 on failure.',
  },
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-rule py-3 last:border-0 sm:flex-row sm:items-baseline sm:gap-6">
      <dt className="w-56 shrink-0 text-[0.8125rem] text-faint">{label}</dt>
      <dd className="text-[0.84375rem] text-ink">{children}</dd>
    </div>
  );
}

export function SettingsPage() {
  const { preference, setPreference } = useTheme();
  const { choice, setChoice } = useData();
  return (
    <div className="flex max-w-[860px] flex-col gap-4">
      <Panel title="Appearance" id="appearance">
        <SegmentedControl<ThemePreference>
          label="Theme"
          value={preference}
          onChange={setPreference}
          options={[
            { value: 'system', label: 'Match system' },
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]}
        />
      </Panel>

      <Panel
        title="Data source"
        subtitle={
          DEMO_TOGGLES
            ? 'Development build: switch to synthetic states to test the interface. Demo data is read-only.'
            : 'Trackwell is showing your records.'
        }
        id="data"
      >
        <fieldset className="flex flex-col gap-1.5">
          <legend className="sr-only">Data source</legend>
          {DATASETS.filter((d) => DEMO_TOGGLES || d.value === 'api').map((d) => (
            <label
              key={d.value}
              className="hoverable flex cursor-pointer items-start gap-3 rounded-ctl px-2 py-2"
            >
              <input
                type="radio"
                name="dataset"
                className="mt-1 accent-[var(--ink)]"
                checked={choice === d.value}
                onChange={() => setChoice(d.value)}
              />
              <span>
                <span className="block text-[0.84375rem] text-ink">{d.label}</span>
                <span className="block text-[0.78125rem] text-faint">{d.help}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </Panel>

      <EmploymentDefaultsPanel />

      <AssistantPanel />

      <Panel
        title="Pay rules"
        subtitle={`Preserved exactly from SubTrack (${PAY_RULES_V1.version})`}
        id="pay"
      >
        <dl>
          <Row label="Permanent day">
            {formatMoney(centsFromDollars(PAY_RULES_V1.permanentNetPerDay))} net /{' '}
            {formatMoney(centsFromDollars(PAY_RULES_V1.permanentGrossPerDay))} gross, flat per work day
          </Row>
          <Row label="Regular teacher day">
            {formatMoney(centsFromDollars(PAY_RULES_V1.teacherFullDayRate))} per full day, half for a half day
          </Row>
          <Row label="Regular assistant day">
            {formatMoney(centsFromDollars(PAY_RULES_V1.aideHourlyRate))} per hour
          </Row>
          <Row label="Multiple coverage">Paid once per work day, never per teacher covered</Row>
          <Row label="Pay periods">
            {PAY_SCHEDULE_V1.lengthDays} days, Monday to Sunday, from {PAY_SCHEDULE_V1.anchor}
          </Row>
          <Row label="Expected payday">
            Period end + {PAY_SCHEDULE_V1.paydayOffsetDays} days (the Friday after). Checked against your
            payment history; shown as an estimate until a payment is recorded.
          </Row>
          <Row label="Outstanding tracking">Work from {PAY_RULES_V1.outstandingTrackingStart} onward</Row>
        </dl>
      </Panel>

      <Panel title="About" id="about">
        <p className="text-[0.84375rem] text-muted">
          Trackwell: Work. Earn. Understand.{' '}
          <Link to="/brand" className="text-ink underline">
            Brand and design system
          </Link>
        </p>
      </Panel>
    </div>
  );
}

type WD = 1 | 2 | 3 | 4 | 5;
const WEEKDAYS: WD[] = [1, 2, 3, 4, 5];
type DefaultRow = { employmentType: 'permanent' | 'regular'; schoolName: string; district: string };

const toRows = (w: WeeklyDefaults) =>
  Object.fromEntries(
    WEEKDAYS.map((d) => [
      d,
      {
        employmentType: w[d]?.employmentType ?? 'regular',
        schoolName: w[d]?.schoolName ?? '',
        district: w[d]?.district ?? '',
      },
    ]),
  ) as Record<WD, DefaultRow>;

/** Editable weekday defaults (saved in D1, effective from today; history kept). */
function EmploymentDefaultsPanel() {
  const { weekDefaults, live, mutate } = useData();
  const notify = useNotice();
  const [rows, setRows] = useState(() => toRows(weekDefaults));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (d: WD, patch: Partial<DefaultRow>) => setRows((r) => ({ ...r, [d]: { ...r[d], ...patch } }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const payload = Object.fromEntries(
      WEEKDAYS.map((d) => [
        d,
        {
          employmentType: rows[d].employmentType,
          schoolName: rows[d].schoolName.trim() || null,
          district: rows[d].district.trim() || null,
        },
      ]),
    );
    const parsed = EmploymentDefaultsInput.safeParse(payload);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      setFormError('Some days need attention.');
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await mutate(() => api.put('/api/v1/settings/employment-defaults', parsed.data));
      notify('Employment defaults saved. They apply to new entries from today.');
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Couldn’t save. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Employment defaults"
      subtitle="Pre-fill only. They never mark a day as worked, and saved work days and their pay never change."
      id="defaults"
    >
      <form onSubmit={save} noValidate className="flex flex-col gap-3">
        {formError && (
          <p role="alert" className="rounded-ctl bg-danger-tint px-3 py-2 text-[0.8125rem] text-ink">
            {formError}
          </p>
        )}
        {WEEKDAYS.map((d) => (
          <fieldset
            key={d}
            className="grid grid-cols-1 gap-3 border-b border-rule pb-3 last:border-0 sm:grid-cols-[7rem_10rem_minmax(0,1fr)_minmax(0,10rem)]"
          >
            <legend className="sr-only">{DAYS[d]}</legend>
            <p aria-hidden="true" className="pt-7 text-[0.84375rem] text-ink max-sm:pt-0">
              {DAYS[d]}
            </p>
            <Field label="Type">
              <Select
                value={rows[d].employmentType}
                disabled={!live}
                onChange={(e) => set(d, { employmentType: e.target.value as DefaultRow['employmentType'] })}
              >
                <option value="permanent">{EMPLOYMENT_LABEL.permanent}</option>
                <option value="regular">{EMPLOYMENT_LABEL.regular}</option>
              </Select>
            </Field>
            <Field label="School" error={errors[`${d}.schoolName`]}>
              <Input
                value={rows[d].schoolName}
                disabled={!live}
                maxLength={160}
                placeholder="Chosen per assignment"
                onChange={(e) => set(d, { schoolName: e.target.value })}
              />
            </Field>
            <Field label="District">
              <Input
                value={rows[d].district}
                disabled={!live}
                maxLength={120}
                onChange={(e) => set(d, { district: e.target.value })}
              />
            </Field>
          </fieldset>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" busy={busy} disabled={!live}>
            Save defaults
          </Button>
          {!live && <p className="text-[0.75rem] text-faint">Demo data is read-only.</p>}
        </div>
      </form>
    </Panel>
  );
}

/** Assistant preferences the assistant reads on every request (persistent context). */
function AssistantPanel() {
  const { snapshot, live, mutate } = useData();
  const notify = useNotice();
  const [lunch, setLunch] = useState<'A' | 'B' | 'C'>(snapshot?.assistant.usualLunch ?? 'A');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await mutate(() => api.put('/api/v1/settings/assistant', { usualLunch: lunch }));
      notify('Assistant preferences saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t save.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel
      title="Assistant"
      subtitle="Remembered across sessions and used when the assistant drafts a work day."
      id="assistant-prefs"
    >
      <form onSubmit={save} noValidate className="flex flex-wrap items-end gap-3">
        <Field
          label="Usual lunch"
          hint="Decides which split-period times a draft uses."
          error={error ?? undefined}
        >
          <Select
            value={lunch}
            disabled={!live}
            onChange={(e) => setLunch(e.target.value as 'A' | 'B' | 'C')}
          >
            <option value="A">Lunch A</option>
            <option value="B">Lunch B</option>
            <option value="C">Lunch C</option>
          </Select>
        </Field>
        <Button type="submit" busy={busy} disabled={!live}>
          Save
        </Button>
      </form>
      <p className="mt-3 text-[0.78125rem] text-faint">
        Only your message goes to the model, plus the tool results it needs (dates, period ids, teacher names
        from your history). Amounts and backups are never sent.
      </p>
    </Panel>
  );
}
