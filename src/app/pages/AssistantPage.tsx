import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Check, X } from 'lucide-react';
import { formatLong } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { COVERAGE_STATUS_LABEL, EMPLOYMENT_LABEL, type WorkDay } from '@/domain/work/types';
import { ASSISTANT_MAX_CHARS, type WorkDayInput } from '@/shared/api';
import type {
  AnswerResponse,
  AssistantMeta,
  AssistantStatus,
  ClarifyResponse,
  ConfirmResponse,
  DraftResponse,
  TraceStep,
} from '@/shared/assistant';
import { ApiError, api } from '../api/client';
import { WorkDayEditor } from '../components/WorkDayEditor';
import { useData } from '../providers/data';
import { Button, Field, Textarea, useNotice } from '../ui/forms';
import { Money, Panel, Pill } from '../ui/primitives';
import { SegmentedControl } from '../ui/SegmentedControl';

const EXAMPLE =
  'Today I covered Mr. Smith during periods 1 and 3, had period 5 free, and covered Mrs. Jones during period 7.';
const QUESTION_EXAMPLE = 'How much did I spend last month?';

type Tab = 'log' | 'ask';

function ModeNote({ meta, status }: { meta?: AssistantMeta | undefined; status: AssistantStatus | null }) {
  const mode = meta?.mode ?? status?.mode;
  const model = meta?.model ?? status?.model;
  if (!mode) return null;
  return (
    <p className="text-[0.78125rem] text-faint">
      {mode === 'mock' ? (
        <>
          <Pill tone="warning">Mock model</Pill> Rule-based stand-in for local testing, not AI inference.
          Tools, validation and saving are real.
        </>
      ) : (
        <>
          <Pill>Workers AI</Pill> {model}
        </>
      )}
      {status && (
        <span className="ml-1">
          · {status.today.requests} of {status.dailyLimit} requests today
        </span>
      )}
    </p>
  );
}

function Trace({ steps }: { steps: TraceStep[] }) {
  return (
    <Panel
      title="How the assistant got there"
      subtitle="Each step ran on the server. Model = a tool call the model chose; Server = deterministic code."
      id="trace"
    >
      <ol className="flex flex-col">
        {steps.map((s) => (
          <li
            key={s.step}
            className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 border-b border-rule py-2 last:border-0"
          >
            <span className="num text-[0.78125rem] text-faint">{s.step}</span>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-ink">
                <code className="font-mono text-[0.78125rem]">{s.tool}</code>
                <Pill>{s.by === 'model' ? 'Model' : 'Server'}</Pill>
                {!s.ok && <Pill tone="danger">Rejected</Pill>}
              </p>
              <p className="mt-0.5 text-[0.78125rem] text-muted [overflow-wrap:anywhere]">{s.summary}</p>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

/** The draft as a WorkDay so the existing editor can open it pre-filled (never as an existing record). */
function asWorkDay(d: WorkDayInput): WorkDay {
  return {
    ...d,
    id: 'assistant-draft',
    coverage: d.coverage.map((b, i) => ({ ...b, id: `draft-${i}` })),
  } as WorkDay;
}

function DraftPreview({
  res,
  onSaved,
  onDiscarded,
}: {
  res: DraftResponse;
  onSaved: (c: ConfirmResponse) => void;
  onDiscarded: () => void;
}) {
  const { mutate } = useData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const d = res.draft;

  async function confirm(input?: WorkDayInput) {
    const c = await mutate(() =>
      api.post<ConfirmResponse>(`/api/v1/assistant/drafts/${res.draftId}/confirm`, input ? { input } : {}),
    );
    onSaved(c);
  }
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await confirm();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t save. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  }
  async function discard() {
    setBusy(true);
    try {
      await api.post(`/api/v1/assistant/drafts/${res.draftId}/reject`, {});
      onDiscarded();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t discard the draft.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Review before saving"
      subtitle="Nothing is saved until you choose Save. You can edit any field first."
      id="draft"
    >
      {error && (
        <p role="alert" className="mb-3 rounded-ctl bg-danger-tint px-3 py-2 text-[0.8125rem] text-ink">
          {error}
        </p>
      )}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[0.84375rem] sm:grid-cols-2">
        <div>
          <dt className="text-[0.75rem] text-faint">Date</dt>
          <dd className="text-ink">{formatLong(d.date)}</dd>
        </div>
        <div>
          <dt className="text-[0.75rem] text-faint">Employment</dt>
          <dd className="text-ink">
            {EMPLOYMENT_LABEL[d.employmentType]} {d.role === 'aide' ? 'assistant' : 'teacher'} ·{' '}
            {d.dayType === 1 ? 'full day' : 'half day'}
          </dd>
        </div>
        <div>
          <dt className="text-[0.75rem] text-faint">School</dt>
          <dd className="text-ink [overflow-wrap:anywhere]">
            {d.schoolName} · {d.district}
          </dd>
        </div>
        <div>
          <dt className="text-[0.75rem] text-faint">Bell schedule</dt>
          <dd className="text-ink">
            {res.schedule ? `${res.schedule.name} (${res.schedule.status})` : 'None on file'}
            {d.lunchVariant ? ` · Lunch ${d.lunchVariant}` : ''}
          </dd>
        </div>
      </dl>

      {d.coverage.length > 0 ? (
        <div
          className="relative mt-4 overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label="Draft periods, scrollable"
        >
          <table className="w-full min-w-[32rem] text-left text-[0.8125rem]">
            <caption className="sr-only">Periods in this draft</caption>
            <thead className="text-[0.75rem] text-faint">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Period</th>
                <th className="py-1.5 pr-3 font-medium">Time</th>
                <th className="py-1.5 pr-3 font-medium">Status</th>
                <th className="py-1.5 pr-3 font-medium">Teacher</th>
                <th className="py-1.5 font-medium">Room</th>
              </tr>
            </thead>
            <tbody>
              {d.coverage.map((b, i) => (
                <tr key={b.periodId ?? i} className="border-t border-rule">
                  <td className="py-2 pr-3 text-ink">{b.label ?? b.periodId}</td>
                  <td className="num py-2 pr-3 text-muted">
                    {b.startTime && b.endTime ? `${b.startTime}–${b.endTime}` : '—'}
                  </td>
                  <td className="py-2 pr-3 text-ink">{COVERAGE_STATUS_LABEL[b.status]}</td>
                  <td className="py-2 pr-3 text-ink [overflow-wrap:anywhere]">{b.teacherName ?? ''}</td>
                  <td className="py-2 text-muted">{b.room ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 text-[0.84375rem] text-muted">
          One assignment for the whole day{d.teacherName ? ` covering ${d.teacherName}` : ''}.
        </p>
      )}

      <p className="mt-4 text-[0.84375rem] text-ink">
        Pay preview: <Money cents={res.pay.netCents} kind="expected" className="font-semibold" /> net ·{' '}
        {formatMoney(res.pay.grossCents)} gross
        <span className="block text-[0.75rem] text-faint">
          Calculated by Trackwell’s pay rules ({res.pay.rulesVersion}), not by the model. Covering several
          teachers doesn’t change daily pay.
        </span>
      </p>

      {(res.assumptions.length > 0 || res.warnings.length > 0) && (
        <ul className="mt-3 flex flex-col gap-1 text-[0.78125rem]">
          {res.warnings.map((w) => (
            <li key={w} className="rounded-ctl bg-warning-tint px-2 py-1 text-ink">
              {w}
            </li>
          ))}
          {res.assumptions.map((a) => (
            <li key={a} className="text-muted">
              Assumed: {a}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" busy={busy} onClick={save}>
          Save work day
        </Button>
        <Button onClick={() => setEditing(true)} disabled={busy}>
          Edit before saving
        </Button>
        <Button variant="quiet" onClick={discard} disabled={busy}>
          Discard
        </Button>
      </div>

      {editing && (
        <WorkDayEditor
          prefill={asWorkDay(d)}
          title="Edit the assistant’s draft"
          submitLabel="Save work day"
          onSubmit={confirm}
          onClose={() => setEditing(false)}
        />
      )}
    </Panel>
  );
}

function Saved({ c }: { c: ConfirmResponse }) {
  return (
    <Panel
      title={c.verified ? 'Saved and verified' : 'Saved, but verification failed'}
      subtitle="Read back from the database after saving."
      id="saved"
    >
      <ul className="flex flex-col gap-1 text-[0.8125rem]">
        {c.checks.map((x) => (
          <li key={x.label} className="flex items-center gap-2 text-ink">
            {x.ok ? (
              <Check size={15} aria-hidden="true" className="text-ink" />
            ) : (
              <X size={15} aria-hidden="true" className="text-danger" />
            )}
            <span>
              <span className="sr-only">{x.ok ? 'Passed: ' : 'Failed: '}</span>
              {x.label}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[0.84375rem]">
        <Link to="/subtrack/assignments" className="text-ink underline">
          Open Assignments
        </Link>
      </p>
    </Panel>
  );
}

function Answer({ res }: { res: AnswerResponse }) {
  return (
    <Panel title="Answer" subtitle={`From your records, ${res.range.from} to ${res.range.to}`} id="answer">
      <p className="text-[0.875rem] text-ink">{res.answer}</p>
      {res.figures.length > 0 && (
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
          {res.figures.map((f) => (
            <div
              key={f.label}
              className="flex items-baseline justify-between gap-3 border-b border-rule py-1.5"
            >
              <dt className="text-[0.8125rem] text-muted [overflow-wrap:anywhere]">{f.label}</dt>
              <dd className="text-[0.875rem] text-ink">
                <Money cents={f.cents} kind={f.kind} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-3 text-[0.75rem] text-faint">
        Totals come from database queries and a fixed template. The model only picked the question’s period;
        it never saw your records.
      </p>
    </Panel>
  );
}

export function AssistantPage() {
  const { live } = useData();
  const notify = useNotice();
  const [tab, setTab] = useState<Tab>('log');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DraftResponse | ClarifyResponse | AnswerResponse | null>(null);
  const [saved, setSaved] = useState<ConfirmResponse | null>(null);
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const inFlight = useRef(false);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const refreshStatus = () => {
    api
      .get<AssistantStatus>('/api/v1/assistant/status')
      .then(setStatus)
      .catch(() => setStatus(null));
  };
  useEffect(() => {
    if (live) refreshStatus();
  }, [live]);

  function switchTab(t: Tab) {
    if (inFlight.current) return;
    setTab(t);
    setText('');
    setResult(null);
    setSaved(null);
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const message = text.trim();
    if (message.length < 3) {
      setError(tab === 'log' ? 'Describe the day first.' : 'Ask a question first.');
      return;
    }
    if (inFlight.current) return; // one request at a time: no duplicate drafts
    inFlight.current = true;
    setElapsed(0);
    setBusy(true);
    setError(null);
    setResult(null);
    setSaved(null);
    try {
      const path = tab === 'log' ? '/api/v1/assistant/assignment' : '/api/v1/assistant/ask';
      // The server stops after 150 s; the browser waits a little longer than that.
      setResult(
        await api.post<DraftResponse | ClarifyResponse | AnswerResponse>(
          path,
          { message },
          { timeoutMs: 170_000 },
        ),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The assistant is unavailable. Nothing was saved.');
    } finally {
      inFlight.current = false;
      setBusy(false);
      refreshStatus();
    }
  }

  if (!live)
    return (
      <Panel
        title="Assistant"
        subtitle="Works on your records only."
        className="max-w-[720px]"
        id="assistant"
      >
        <p className="text-[0.84375rem] text-muted">
          The assistant reads and writes your real records through the server, so it’s off while demo data is
          shown. Switch{' '}
          <Link to="/settings#data" className="text-ink underline">
            Data source
          </Link>{' '}
          to Your records to use it.
        </p>
      </Panel>
    );

  const meta = result && 'meta' in result ? result.meta : undefined;
  return (
    <div className="flex max-w-[860px] flex-col gap-4">
      <Panel
        title="Assistant"
        subtitle="Log a work day in your own words, or ask about your money. Pay and totals always come from Trackwell’s code."
        id="assistant"
      >
        <div className="flex flex-col gap-4">
          <SegmentedControl<Tab>
            label="Assistant task"
            value={tab}
            onChange={switchTab}
            options={[
              { value: 'log', label: 'Log a work day' },
              { value: 'ask', label: 'Ask about money' },
            ]}
          />
          <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
            <Field
              label={tab === 'log' ? 'Describe the day' : 'Your question'}
              hint={`${text.length} of ${ASSISTANT_MAX_CHARS} characters`}
              error={error ?? undefined}
            >
              <Textarea
                rows={3}
                maxLength={ASSISTANT_MAX_CHARS}
                value={text}
                readOnly={busy}
                onChange={(e) => setText(e.target.value)}
                placeholder={tab === 'log' ? EXAMPLE : QUESTION_EXAMPLE}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="primary" busy={busy}>
                {tab === 'log' ? 'Draft the work day' : 'Ask'}
              </Button>
              <Button onClick={() => setText(tab === 'log' ? EXAMPLE : QUESTION_EXAMPLE)} disabled={busy}>
                Use the example
              </Button>
            </div>
          </form>
          {busy && (
            <p role="status" className="text-[0.8125rem] text-muted">
              Working… {elapsed} s.{' '}
              {tab === 'log'
                ? 'The model makes several tool calls; this usually takes 10–60 seconds.'
                : 'This usually takes a few seconds.'}{' '}
              Nothing is saved until you confirm.
            </p>
          )}
          <ModeNote meta={meta} status={status} />
        </div>
      </Panel>

      {result?.kind === 'clarify' && (
        <Panel title="One more detail" id="clarify">
          <p role="status" className="text-[0.875rem] text-ink">
            {result.message}
          </p>
        </Panel>
      )}
      {result?.kind === 'draft' && !saved && (
        <DraftPreview
          key={result.draftId}
          res={result}
          onSaved={(c) => {
            setSaved(c);
            notify(c.verified ? 'Work day saved and verified.' : 'Work day saved; verification failed.');
          }}
          onDiscarded={() => {
            setResult(null);
            notify('Draft discarded. Nothing was saved.');
          }}
        />
      )}
      {saved && <Saved c={saved} />}
      {result?.kind === 'answer' && <Answer res={result} />}
      {result && result.trace.length > 0 && <Trace steps={result.trace} />}
    </div>
  );
}
