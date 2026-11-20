import { useMemo, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { formatMedium, formatShort, type ISODate } from '@/domain/dates';
import { formatMoney, sumCents } from '@/domain/money';
import { count } from '@/domain/plural';
import { earningsFromPeriods } from '@/domain/earnings';
import { reconcilePeriods, summarizeWork, type PeriodRow } from '@/domain/work/summary';
import type { IncomePayment } from '@/domain/work/types';
import { PaymentInput, PayPeriodOverrideInput, fieldErrors } from '@/shared/api';
import { ApiError, api } from '../api/client';
import { useData, useDatasetOrThrow } from '../providers/data';
import { EmptyNote, Money, Panel, Pill, SkeletonLines, Stamp } from '../ui/primitives';
import {
  Button,
  ConfirmDialog,
  Field,
  Input,
  MoneyInput,
  Select,
  Sheet,
  parseMoney,
  useNotice,
} from '../ui/forms';
import { MoneyStrip } from '../components/finance';

const STATUS_PILL: Record<PeriodRow['status'], { text: string; tone: 'neutral' | 'warning' }> = {
  paid: { text: 'Paid', tone: 'neutral' },
  upcoming: { text: 'Upcoming', tone: 'neutral' },
  awaiting: { text: 'Overdue', tone: 'warning' },
  'prior-arrangement': { text: 'Prior arrangement', tone: 'neutral' },
};

function PaymentForm({
  payment,
  periods,
  onClose,
}: {
  payment?: IncomePayment;
  periods: PeriodRow[];
  onClose: () => void;
}) {
  const { mutate, today, live } = useData();
  const notify = useNotice();
  const [date, setDate] = useState(payment?.date ?? today);
  const [district, setDistrict] = useState(payment?.district ?? 'Munster');
  const [amount, setAmount] = useState(payment ? (payment.amountCents / 100).toFixed(2) : '');
  const [link, setLink] = useState(payment?.payPeriodStart ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseMoney(amount);
    const parsed = PaymentInput.safeParse({
      date,
      district: district.trim(),
      amountCents: cents ?? -1,
      ...(link ? { payPeriodStart: link } : {}),
    });
    if (!parsed.success || cents === null) {
      setErrors({
        ...(parsed.success ? {} : fieldErrors(parsed.error)),
        ...(cents === null ? { amountCents: 'Enter an amount like 571.35' } : {}),
      });
      return;
    }
    setBusy(true);
    try {
      await mutate(() =>
        payment
          ? api.put(`/api/v1/payments/${payment.id}`, { ...parsed.data, updatedAt: payment.updatedAt ?? 0 })
          : api.post('/api/v1/payments', parsed.data),
      );
      notify(payment ? 'Payment updated.' : 'Payment recorded.');
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setMsg(err.message);
      }
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!payment) return;
    setBusy(true);
    try {
      await mutate(() => api.del(`/api/v1/payments/${payment.id}`));
      notify('Payment deleted.');
      onClose();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Couldn’t delete.');
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title={payment ? 'Edit payment' : 'Record a payment'}
      footer={
        <>
          <Button type="submit" form="payment-form" variant="primary" busy={busy} disabled={!live}>
            {payment ? 'Save changes' : 'Record payment'}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          {payment && (
            <Button variant="danger" className="ml-auto" onClick={() => setConfirm(true)} disabled={!live}>
              Delete
            </Button>
          )}
        </>
      }
    >
      <form id="payment-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {msg && (
          <p role="alert" className="rounded-ctl bg-danger-tint px-3 py-2 text-[0.8125rem]">
            {msg}
          </p>
        )}
        <p className="text-[0.8125rem] text-muted">
          Enter the net amount that actually arrived, on the date it arrived.
        </p>
        <Field label="Date received" error={errors.date}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Amount received (net)" error={errors.amountCents}>
          <MoneyInput value={amount} onChange={setAmount} placeholder="0.00" />
        </Field>
        <Field label="District" error={errors.district}>
          <Input value={district} onChange={(e) => setDistrict(e.target.value)} />
        </Field>
        <Field
          label="Pay period"
          hint="Usually matched automatically by date. Link it here if the date is unusual."
          error={errors.payPeriodStart}
        >
          <Select value={link} onChange={(e) => setLink(e.target.value)}>
            <option value="">Match automatically</option>
            {periods.map((p) => (
              <option key={p.period.start} value={p.period.start}>
                {p.period.label} · payday {formatShort(p.period.expectedPayday)}
              </option>
            ))}
          </Select>
        </Field>
      </form>
      <ConfirmDialog
        open={confirm}
        title="Delete this payment?"
        body={`The ${formatMoney(payment?.amountCents ?? 0)} payment on ${payment ? formatMedium(payment.date) : ''} will be removed from your totals, and its pay period becomes unpaid again.`}
        confirmLabel="Delete payment"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setConfirm(false)}
      />
    </Sheet>
  );
}

function PaydayOverride({ row, onClose }: { row: PeriodRow; onClose: () => void }) {
  const { mutate, live } = useData();
  const notify = useNotice();
  const [payday, setPayday] = useState<ISODate>(row.period.expectedPayday);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    const parsed = PayPeriodOverrideInput.safeParse({
      payday,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    if (!parsed.success) return setErr('Enter a valid date.');
    setBusy(true);
    try {
      await mutate(() => api.put(`/api/v1/pay-periods/${row.period.start}`, parsed.data));
      notify('Payday changed.');
      onClose();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Couldn’t save.');
    } finally {
      setBusy(false);
    }
  }
  async function reset() {
    setBusy(true);
    try {
      await mutate(() => api.del(`/api/v1/pay-periods/${row.period.start}`));
      notify('Payday reset to the rule.');
      onClose();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Couldn’t reset.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Payday for ${row.period.label}`}
      footer={
        <>
          <Button type="submit" form="payday-form" variant="primary" busy={busy} disabled={!live}>
            Save payday
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          {row.period.overridden && (
            <Button variant="quiet" className="ml-auto" onClick={reset} disabled={!live}>
              Use the rule again
            </Button>
          )}
        </>
      }
    >
      <form id="payday-form" onSubmit={save} className="flex flex-col gap-4" noValidate>
        {err && (
          <p role="alert" className="rounded-ctl bg-danger-tint px-3 py-2 text-[0.8125rem]">
            {err}
          </p>
        )}
        <p className="text-[0.8125rem] text-muted">
          The rule says the Friday after the period ends. Change it when the district shifts a payday (for
          example around a holiday). Amounts don’t change.
        </p>
        <Field label="Expected payday">
          <Input type="date" value={payday} onChange={(e) => setPayday(e.target.value)} />
        </Field>
        <Field label="Note (optional)">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Thanksgiving week"
            maxLength={200}
          />
        </Field>
      </form>
    </Sheet>
  );
}

export function PaymentsPage() {
  const { today, payConfig, live } = useData();
  const ds = useDatasetOrThrow();
  const [form, setForm] = useState<IncomePayment | 'new' | null>(() =>
    new URLSearchParams(location.search).get('new') === '1' ? 'new' : null,
  );
  const [payday, setPayday] = useState<PeriodRow | null>(null);
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo(
    () =>
      ds
        ? [...reconcilePeriods(ds.work.days, ds.work.payments, today, undefined, payConfig).values()].sort(
            (a, b) => b.period.start.localeCompare(a.period.start),
          )
        : [],
    [ds, today, payConfig],
  );
  const summary = useMemo(
    () =>
      ds ? summarizeWork(ds.work.days, ds.work.payments, { range: {} }, today, undefined, payConfig) : null,
    [ds, today, payConfig],
  );
  if (!ds || !summary) return <SkeletonLines rows={8} />;
  const e = earningsFromPeriods(rows);
  const payments = [...ds.work.payments].sort((a, b) => b.date.localeCompare(a.date));
  const shown = showAll ? rows : rows.slice(0, 10);

  return (
    <div className="flex flex-col gap-4">
      <MoneyStrip
        label="Earnings status"
        items={[
          {
            label: 'Received, all time',
            value: <Money cents={sumCents(payments.map((p) => p.amountCents))} kind="received" />,
            caption: count(payments.length, 'payment'),
            lead: true,
          },
          {
            label: 'Outstanding earnings',
            value: <Money cents={e.outstandingCents} kind="expected" />,
            caption: 'Earned, not yet paid',
          },
          {
            label: 'Upcoming paychecks',
            value: <Money cents={e.upcomingCents} kind="expected" />,
            caption: count(e.upcoming.length, 'pay period'),
          },
          {
            label: 'Overdue',
            value:
              e.overdueCents > 0 ? (
                <span className="text-warning">
                  <Money cents={e.overdueCents} kind="expected" />
                </span>
              ) : (
                <Money cents={0} />
              ),
            caption: e.overdue.length
              ? `Payday passed, ${count(e.overdue.length, 'period')} unpaid`
              : 'Nothing overdue',
          },
        ]}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[72ch] text-[0.8125rem] text-faint">
          Paid periods differ from expected by <Money cents={e.paidVarianceCents} kind="net" /> in total
          (deductions or adjustments). Legacy SubTrack check (“still expected” since Aug 1, 2026):{' '}
          <Money cents={summary.legacyStillExpectedCents} />.
        </p>
        <Button variant="primary" onClick={() => setForm('new')} disabled={!live}>
          <Plus size={16} aria-hidden="true" /> Record payment
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel
          title="Pay periods"
          subtitle="Two weeks, Monday to Sunday. Paid the Friday after the period ends unless you change the payday."
          id="periods"
        >
          {rows.length === 0 ? (
            <EmptyNote>No pay periods yet. They appear when you log work.</EmptyNote>
          ) : (
            <div
              className="relative overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-label="Pay periods table"
            >
              <table className="w-full min-w-[40rem] border-collapse text-[0.875rem]">
                <caption className="sr-only">Pay periods with expected and received amounts</caption>
                <thead>
                  <tr className="text-[0.75rem] text-faint">
                    <th scope="col" className="border-b border-rule pb-2 text-left font-medium">
                      Period
                    </th>
                    <th scope="col" className="border-b border-rule pb-2 text-left font-medium">
                      Expected payday
                    </th>
                    <th scope="col" className="border-b border-rule pb-2 text-right font-medium">
                      Expected
                    </th>
                    <th scope="col" className="border-b border-rule pb-2 text-right font-medium">
                      Received
                    </th>
                    <th scope="col" className="border-b border-rule pb-2 text-right font-medium">
                      Difference
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
                  {shown.map((r) => (
                    <tr key={r.period.start} className="border-b border-rule last:border-0">
                      <td className="py-2 pr-3">
                        <div className="text-ink">{r.period.label}</div>
                        <div className="text-[0.75rem] text-faint">{count(r.days, 'day')}</div>
                      </td>
                      <td className="num py-2 pr-3 text-muted">
                        {formatShort(r.period.expectedPayday)}
                        {r.period.overridden && (
                          <span className="ml-1.5 text-[0.75rem] text-faint">(changed)</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <Money cents={r.expectedNetCents} kind={r.status === 'paid' ? 'plain' : 'expected'} />
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {r.status === 'paid' ? (
                          <span className="flex flex-col items-end gap-1">
                            <Money cents={r.receivedCents} kind="received" />
                            <Stamp date={r.paymentDates[0]!} />
                          </span>
                        ) : (
                          <span className="text-faint">&mdash;</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {r.status === 'paid' ? (
                          <Money
                            cents={r.receivedCents - r.expectedNetCents}
                            kind="net"
                            className="text-muted"
                          />
                        ) : (
                          <span className="text-faint">&mdash;</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {r.status === 'paid' ? (
                          <span className="sr-only">Paid</span>
                        ) : (
                          <Pill tone={STATUS_PILL[r.status].tone}>{STATUS_PILL[r.status].text}</Pill>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {r.status !== 'paid' && r.status !== 'prior-arrangement' && (
                          <Button
                            size="sm"
                            variant="quiet"
                            onClick={() => setPayday(r)}
                            disabled={!live}
                            aria-label={`Change payday for ${r.period.label}`}
                          >
                            Change payday
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > 10 && (
            <Button
              size="sm"
              variant="quiet"
              className="mt-3 self-start"
              onClick={() => setShowAll((s) => !s)}
            >
              {showAll ? 'Show recent' : `Show all ${rows.length}`}
            </Button>
          )}
        </Panel>

        <Panel title="Payment history" subtitle="Actual money received" id="history">
          {payments.length === 0 ? (
            <EmptyNote>No payments recorded yet.</EmptyNote>
          ) : (
            <ul className="flex flex-col">
              {payments.slice(0, showAll ? undefined : 12).map((p) => (
                <li key={p.id} className="flex items-center gap-3 border-b border-rule py-2 last:border-0">
                  <span className="num w-24 shrink-0 text-[0.8125rem] text-faint">
                    {formatMedium(p.date)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-muted">
                    {p.district}
                    {p.payPeriodStart ? ' · linked' : ''}
                  </span>
                  <Money cents={p.amountCents} kind="received" className="text-[0.875rem]" />
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => setForm(p)}
                    aria-label={`Edit payment of ${formatMoney(p.amountCents)} on ${formatMedium(p.date)}`}
                  >
                    Edit
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {form && (
        <PaymentForm
          {...(form === 'new' ? {} : { payment: form })}
          periods={rows.slice(0, 26)}
          onClose={() => setForm(null)}
        />
      )}
      {payday && <PaydayOverride row={payday} onClose={() => setPayday(null)} />}
    </div>
  );
}
