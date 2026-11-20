import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Plus, Search } from 'lucide-react';
import { formatMedium, formatShort, monthKey } from '@/domain/dates';
import { formatMoney, sumCents } from '@/domain/money';
import { count } from '@/domain/plural';
import { budgetFor } from '@/domain/expenses/summary';
import { monthlyEquivalentCents, occurrenceDates } from '@/domain/expenses/recurring';
import type { Category, Expense, PaymentMethod, RecurringPlan } from '@/domain/expenses/types';
import {
  BudgetInput,
  CategoryInput,
  ExpenseInput,
  PaymentMethodInput,
  RecurringInput,
  fieldErrors,
} from '@/shared/api';
import { ApiError, api } from '../api/client';
import { useData, useDatasetOrThrow } from '../providers/data';
import { EmptyNote, Money, Panel, Pill, SkeletonLines } from '../ui/primitives';
import {
  Button,
  ConfirmDialog,
  Field,
  Input,
  MoneyInput,
  Select,
  Sheet,
  Textarea,
  parseMoney,
  useNotice,
} from '../ui/forms';

/* ------------------------------ shared ------------------------------ */

function useSave() {
  const { mutate } = useData();
  const notify = useNotice();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>, done: string, after: () => void) {
    setBusy(true);
    setMsg(null);
    try {
      await mutate(fn);
      notify(done);
      after();
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fields);
        setMsg(e.message);
      } else setMsg('Something went wrong. Nothing was saved.');
    } finally {
      setBusy(false);
    }
  }
  return { errors, setErrors, msg, busy, run };
}

const Alert = ({ msg }: { msg: string | null }) =>
  msg ? (
    <p role="alert" className="rounded-ctl bg-danger-tint px-3 py-2 text-[0.8125rem]">
      {msg}
    </p>
  ) : null;

function FormSheet({
  title,
  formId,
  onClose,
  busy,
  extra,
  children,
}: {
  title: string;
  formId: string;
  onClose: () => void;
  busy: boolean;
  extra?: ReactNode;
  children: ReactNode;
}) {
  const { live } = useData();
  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button type="submit" form={formId} variant="primary" busy={busy} disabled={!live}>
            Save
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          {extra}
          {!live && <p className="w-full text-[0.75rem] text-faint">Demo data is read-only.</p>}
        </>
      }
    >
      {children}
    </Sheet>
  );
}

const activeOrSelected = <T extends { id: string; archived?: boolean }>(xs: T[], selected?: string) =>
  xs.filter((x) => !x.archived || x.id === selected);

/* ------------------------------ transactions ------------------------------ */

function ExpenseForm({ expense, onClose }: { expense?: Expense; onClose: () => void }) {
  const { dataset, today, live } = useData();
  const s = useSave();
  const cats = activeOrSelected(dataset?.expenses.categories ?? [], expense?.categoryId);
  const methods = activeOrSelected(dataset?.expenses.paymentMethods ?? [], expense?.paymentMethodId);
  const [date, setDate] = useState(expense?.date ?? today);
  const [merchant, setMerchant] = useState(expense?.merchant ?? '');
  const [amount, setAmount] = useState(expense ? (expense.amountCents / 100).toFixed(2) : '');
  const [categoryId, setCategoryId] = useState(expense?.categoryId ?? cats[0]?.id ?? '');
  const [methodId, setMethodId] = useState(expense?.paymentMethodId ?? methods[0]?.id ?? '');
  const [notes, setNotes] = useState(expense?.notes ?? '');
  const [confirm, setConfirm] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseMoney(amount);
    const parsed = ExpenseInput.safeParse({
      date,
      merchant,
      amountCents: cents ?? -1,
      categoryId,
      paymentMethodId: methodId,
      ...(notes.trim() ? { notes } : {}),
    });
    if (!parsed.success || cents === null)
      return s.setErrors({
        ...(parsed.success ? {} : fieldErrors(parsed.error)),
        ...(cents === null ? { amountCents: 'Enter an amount like 12.50' } : {}),
      });
    void s.run(
      () =>
        expense
          ? api.put(`/api/v1/expenses/${expense.id}`, { ...parsed.data, updatedAt: expense.updatedAt ?? 0 })
          : api.post('/api/v1/expenses', parsed.data),
      expense ? 'Expense updated.' : 'Expense added.',
      onClose,
    );
  }
  if (cats.length === 0 || methods.length === 0)
    return (
      <FormSheet title="Add an expense" formId="x" onClose={onClose} busy={false}>
        <EmptyNote>
          Create at least one category and one payment method first (Expenses → Categories).
        </EmptyNote>
      </FormSheet>
    );
  return (
    <FormSheet
      title={expense ? 'Edit expense' : 'Add an expense'}
      formId="expense-form"
      onClose={onClose}
      busy={s.busy}
      extra={
        expense && (
          <Button variant="danger" className="ml-auto" onClick={() => setConfirm(true)} disabled={!live}>
            Delete
          </Button>
        )
      }
    >
      <form id="expense-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Alert msg={s.msg} />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Date" error={s.errors.date}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Amount" error={s.errors.amountCents}>
            <MoneyInput value={amount} onChange={setAmount} placeholder="0.00" />
          </Field>
        </div>
        <Field label="Merchant or description" error={s.errors.merchant}>
          <Input value={merchant} onChange={(e) => setMerchant(e.target.value)} maxLength={160} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Category" error={s.errors.categoryId}>
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.archived ? ' (archived)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Payment method" error={s.errors.paymentMethodId}>
            <Select value={methodId} onChange={(e) => setMethodId(e.target.value)}>
              {methods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.archived ? ' (archived)' : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Notes" error={s.errors.notes}>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {expense?.recurringPlanId && (
          <p className="text-[0.75rem] text-faint">
            Created by a recurring plan. Deleting it won’t bring it back on the next sync.
          </p>
        )}
      </form>
      <ConfirmDialog
        open={confirm}
        title="Delete this expense?"
        body={
          expense
            ? `${expense.merchant}, ${formatMoney(expense.amountCents)} on ${formatMedium(expense.date)}, will be removed from your totals.`
            : ''
        }
        confirmLabel="Delete expense"
        busy={s.busy}
        onConfirm={() =>
          void s.run(() => api.del(`/api/v1/expenses/${expense!.id}`), 'Expense deleted.', onClose)
        }
        onCancel={() => setConfirm(false)}
      />
    </FormSheet>
  );
}

export function TransactionsPage() {
  const { live } = useData();
  const ds = useDatasetOrThrow();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [method, setMethod] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [limit, setLimit] = useState(100);
  const [editing, setEditing] = useState<Expense | 'new' | null>(() =>
    new URLSearchParams(location.search).get('new') === '1' ? 'new' : null,
  );
  const data = ds?.expenses;
  const rows = useMemo(() => {
    if (!data) return [];
    const n = q.trim().toLowerCase();
    const lo = min ? parseMoney(min) : null;
    const hi = max ? parseMoney(max) : null;
    return data.expenses
      .filter(
        (e) =>
          (!n || `${e.merchant} ${e.notes ?? ''}`.toLowerCase().includes(n)) &&
          (!cat || e.categoryId === cat) &&
          (!method || e.paymentMethodId === method) &&
          (!from || e.date >= from) &&
          (!to || e.date <= to) &&
          (lo === null || e.amountCents >= lo) &&
          (hi === null || e.amountCents <= hi),
      )
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  }, [data, q, cat, method, from, to, min, max]);
  if (!data) return <SkeletonLines rows={8} />;
  const catOf = (id: string) => data.categories.find((c) => c.id === id);
  const methodOf = (id: string) => data.paymentMethods.find((m) => m.id === id)?.name ?? 'Unknown method';
  const filtered = Boolean(q || cat || method || from || to || min || max);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Search" className="min-w-[12rem] flex-1">
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
              placeholder="Merchant or note"
              className="pl-9"
            />
          </div>
        </Field>
        <Field label="Category">
          <Select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">All</option>
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">All</option>
            {data.paymentMethods.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Min $">
          <Input
            inputMode="decimal"
            className="num w-24"
            value={min}
            onChange={(e) => setMin(e.target.value)}
          />
        </Field>
        <Field label="Max $">
          <Input
            inputMode="decimal"
            className="num w-24"
            value={max}
            onChange={(e) => setMax(e.target.value)}
          />
        </Field>
        <Button variant="primary" onClick={() => setEditing('new')} disabled={!live}>
          <Plus size={16} aria-hidden="true" /> Add expense
        </Button>
      </div>
      <section aria-label="Transactions" className="rounded-panel bg-surface p-4 md:p-5">
        <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[0.875rem] font-semibold">{count(rows.length, 'transaction')}</h2>
          <span className="text-[0.8125rem] text-faint">
            <Money cents={sumCents(rows.map((e) => e.amountCents))} kind="spent" />
            {filtered ? ' · filtered' : ''}
          </span>
        </header>
        {rows.length === 0 ? (
          <EmptyNote>
            {filtered ? 'No transactions match these filters.' : 'No expenses yet. Add your first one.'}
          </EmptyNote>
        ) : (
          <ul className="flex flex-col">
            {rows.slice(0, limit).map((e) => {
              const c = catOf(e.categoryId);
              return (
                <li key={e.id} className="border-b border-rule last:border-0">
                  <button
                    type="button"
                    onClick={() => setEditing(e)}
                    className="hoverable flex w-full items-start gap-3 rounded-ctl py-2 text-left"
                  >
                    <span className="sr-only">Edit </span>
                    <span className="num w-14 shrink-0 whitespace-nowrap pt-px text-[0.8125rem] text-faint">
                      {formatShort(e.date)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.875rem] text-ink">{e.merchant}</span>
                      <span className="flex items-center gap-1.5 truncate text-[0.75rem] text-faint">
                        <span
                          aria-hidden="true"
                          className="size-1.5 shrink-0 rounded-full"
                          style={{ background: c?.color ?? 'var(--faint)' }}
                        />
                        {c?.name ?? 'Uncategorized'} · {methodOf(e.paymentMethodId)}
                        {e.recurringPlanId && <Pill>Recurring</Pill>}
                      </span>
                    </span>
                    <Money cents={e.amountCents} kind="spent" className="shrink-0 text-[0.875rem]" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {rows.length > limit && (
          <Button size="sm" variant="quiet" className="mt-3" onClick={() => setLimit((l) => l + 200)}>
            Show {Math.min(200, rows.length - limit)} more
          </Button>
        )}
      </section>
      {editing && (
        <ExpenseForm {...(editing === 'new' ? {} : { expense: editing })} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

/* ------------------------------ categories & methods ------------------------------ */

function NamedForm<T extends Category | PaymentMethod>({
  kind,
  item,
  onClose,
}: {
  kind: 'category' | 'method';
  item?: T;
  onClose: () => void;
}) {
  const { live } = useData();
  const s = useSave();
  const [name, setName] = useState(item?.name ?? '');
  const [color, setColor] = useState((item as Category | undefined)?.color ?? '#5b86c5');
  const [type, setType] = useState((item as PaymentMethod | undefined)?.type ?? 'Debit card');
  const [confirm, setConfirm] = useState(false);
  const path = kind === 'category' ? 'categories' : 'payment-methods';
  const label = kind === 'category' ? 'category' : 'payment method';
  function submit(e: FormEvent) {
    e.preventDefault();
    const schema = kind === 'category' ? CategoryInput : PaymentMethodInput;
    const parsed = schema.safeParse(kind === 'category' ? { name, color } : { name, type });
    if (!parsed.success) return s.setErrors(fieldErrors(parsed.error));
    void s.run(
      () =>
        item
          ? api.put(`/api/v1/${path}/${item.id}`, {
              ...parsed.data,
              updatedAt: item.updatedAt ?? 0,
              archived: item.archived ?? false,
            })
          : api.post(`/api/v1/${path}`, parsed.data),
      item ? 'Saved.' : `${kind === 'category' ? 'Category' : 'Payment method'} added.`,
      onClose,
    );
  }
  return (
    <FormSheet
      title={item ? `Edit ${label}` : `New ${label}`}
      formId="named-form"
      onClose={onClose}
      busy={s.busy}
      extra={
        item &&
        (item.archived ? (
          <Button
            className="ml-auto"
            disabled={!live}
            onClick={() =>
              void s.run(
                () =>
                  api.put(`/api/v1/${path}/${item.id}`, {
                    name: item.name,
                    ...(kind === 'category' ? { color } : { type }),
                    updatedAt: item.updatedAt ?? 0,
                    archived: false,
                  }),
                'Restored.',
                onClose,
              )
            }
          >
            Restore
          </Button>
        ) : (
          <Button variant="danger" className="ml-auto" disabled={!live} onClick={() => setConfirm(true)}>
            Archive
          </Button>
        ))
      }
    >
      <form id="named-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Alert msg={s.msg} />
        <Field label="Name" error={s.errors.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        {kind === 'category' ? (
          <Field label="Color" hint="Used as a small identity dot" error={s.errors.color}>
            <Input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 w-20 p-1"
            />
          </Field>
        ) : (
          <Field label="Type" error={s.errors.type}>
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {['Debit card', 'Credit card', 'Cash', 'Bank transfer', 'Other'].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </Field>
        )}
      </form>
      <ConfirmDialog
        open={confirm}
        title={`Archive this ${label}?`}
        body={`It won’t be offered for new expenses. Existing expenses keep it, so your history doesn’t change.`}
        confirmLabel="Archive"
        busy={s.busy}
        onConfirm={() => void s.run(() => api.del(`/api/v1/${path}/${item!.id}`), 'Archived.', onClose)}
        onCancel={() => setConfirm(false)}
      />
    </FormSheet>
  );
}

export function CategoriesPage() {
  const { live } = useData();
  const ds = useDatasetOrThrow();
  const [edit, setEdit] = useState<{ kind: 'category' | 'method'; item?: Category | PaymentMethod } | null>(
    null,
  );
  if (!ds) return <SkeletonLines rows={6} />;
  const data = ds.expenses;
  const used = (key: 'categoryId' | 'paymentMethodId', id: string) =>
    data.expenses.filter((e) => e[key] === id);
  const list = (kind: 'category' | 'method', items: Array<Category | PaymentMethod>) =>
    items.length === 0 ? (
      <EmptyNote>None yet.</EmptyNote>
    ) : (
      <ul className="flex flex-col">
        {[...items]
          .sort(
            (a, b) =>
              Number(a.archived ?? false) - Number(b.archived ?? false) || a.name.localeCompare(b.name),
          )
          .map((x) => {
            const xs = used(kind === 'category' ? 'categoryId' : 'paymentMethodId', x.id);
            return (
              <li key={x.id} className="flex items-center gap-3 border-b border-rule py-2 last:border-0">
                {kind === 'category' && (
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: (x as Category).color }}
                  />
                )}
                <span className="min-w-0 flex-1 truncate text-[0.875rem] text-ink">
                  {x.name}
                  {kind === 'method' && <span className="text-faint"> · {(x as PaymentMethod).type}</span>}
                </span>
                {x.archived && <Pill>Archived</Pill>}
                <span className="num shrink-0 text-[0.75rem] text-faint">
                  {count(xs.length, 'expense')} ·{' '}
                  {formatMoney(sumCents(xs.map((e) => e.amountCents)), { whole: true })}
                </span>
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => setEdit({ kind, item: x })}
                  aria-label={`Edit ${x.name}`}
                >
                  Edit
                </Button>
              </li>
            );
          })}
      </ul>
    );
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Panel
        title="Categories"
        actions={
          <Button size="sm" onClick={() => setEdit({ kind: 'category' })} disabled={!live}>
            <Plus size={14} aria-hidden="true" /> New
          </Button>
        }
      >
        {list('category', data.categories)}
      </Panel>
      <Panel
        title="Payment methods"
        subtitle="How you paid. Bank balances aren’t tracked."
        actions={
          <Button size="sm" onClick={() => setEdit({ kind: 'method' })} disabled={!live}>
            <Plus size={14} aria-hidden="true" /> New
          </Button>
        }
      >
        {list('method', data.paymentMethods)}
      </Panel>
      {edit && (
        <NamedForm
          kind={edit.kind}
          {...(edit.item ? { item: edit.item } : {})}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------ recurring ------------------------------ */

function RecurringForm({ plan, onClose }: { plan?: RecurringPlan; onClose: () => void }) {
  const { dataset, today, live } = useData();
  const s = useSave();
  const cats = activeOrSelected(dataset?.expenses.categories ?? [], plan?.categoryId);
  const methods = activeOrSelected(dataset?.expenses.paymentMethods ?? [], plan?.paymentMethodId);
  const [merchant, setMerchant] = useState(plan?.merchant ?? '');
  const [amount, setAmount] = useState(plan ? (plan.amountCents / 100).toFixed(2) : '');
  const [frequency, setFrequency] = useState<RecurringPlan['frequency']>(plan?.frequency ?? 'monthly');
  const [startDate, setStartDate] = useState(plan?.startDate ?? today);
  const [occurrences, setOccurrences] = useState(plan?.occurrences ? String(plan.occurrences) : '');
  const [categoryId, setCategoryId] = useState(plan?.categoryId ?? cats[0]?.id ?? '');
  const [methodId, setMethodId] = useState(plan?.paymentMethodId ?? methods[0]?.id ?? '');
  const [active, setActive] = useState(plan?.active ?? true);
  const [confirm, setConfirm] = useState(false);
  function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseMoney(amount);
    const parsed = RecurringInput.safeParse({
      merchant,
      amountCents: cents ?? -1,
      categoryId,
      paymentMethodId: methodId,
      frequency,
      startDate,
      ...(occurrences ? { occurrences: Number(occurrences) } : {}),
      active,
      showMonthlyEquivalent: frequency === 'yearly',
    });
    if (!parsed.success || cents === null)
      return s.setErrors({
        ...(parsed.success ? {} : fieldErrors(parsed.error)),
        ...(cents === null ? { amountCents: 'Enter an amount' } : {}),
      });
    void s.run(
      () =>
        (plan
          ? api.put(`/api/v1/recurring/${plan.id}`, { ...parsed.data, updatedAt: plan.updatedAt ?? 0 })
          : api.post('/api/v1/recurring', parsed.data)
        ).then(() => api.post('/api/v1/recurring/sync')),
      plan ? 'Recurring expense updated.' : 'Recurring expense added.',
      onClose,
    );
  }
  return (
    <FormSheet
      title={plan ? 'Edit recurring expense' : 'New recurring expense'}
      formId="recurring-form"
      onClose={onClose}
      busy={s.busy}
      extra={
        plan && (
          <Button variant="danger" className="ml-auto" disabled={!live} onClick={() => setConfirm(true)}>
            Delete plan
          </Button>
        )
      }
    >
      <form id="recurring-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Alert msg={s.msg} />
        <Field label="Merchant or description" error={s.errors.merchant}>
          <Input value={merchant} onChange={(e) => setMerchant(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Amount" error={s.errors.amountCents}>
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
          <Field label="Repeats">
            <Select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as RecurringPlan['frequency'])}
            >
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </Select>
          </Field>
          <Field label="First charge" error={s.errors.startDate}>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="Number of payments" hint="Empty = ongoing" error={s.errors.occurrences}>
            <Input
              inputMode="numeric"
              className="num"
              value={occurrences}
              onChange={(e) => setOccurrences(e.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <Field label="Category">
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Payment method">
            <Select value={methodId} onChange={(e) => setMethodId(e.target.value)}>
              {methods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-[0.875rem]">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="size-4 accent-[var(--ink)]"
          />{' '}
          Active (new charges are added as they come due)
        </label>
        <p className="text-[0.75rem] text-faint">
          Changes apply to future charges; past expenses stay as recorded.
        </p>
      </form>
      <ConfirmDialog
        open={confirm}
        title="Delete this recurring plan?"
        body="No more charges will be added. Expenses it already created stay in your history."
        confirmLabel="Delete plan"
        busy={s.busy}
        onConfirm={() => void s.run(() => api.del(`/api/v1/recurring/${plan!.id}`), 'Plan deleted.', onClose)}
        onCancel={() => setConfirm(false)}
      />
    </FormSheet>
  );
}

export function RecurringPage() {
  const { live, today } = useData();
  const ds = useDatasetOrThrow();
  const [edit, setEdit] = useState<RecurringPlan | 'new' | null>(null);
  if (!ds) return <SkeletonLines rows={6} />;
  const plans = [...ds.expenses.recurringPlans].sort(
    (a, b) => Number(b.active) - Number(a.active) || a.merchant.localeCompare(b.merchant),
  );
  const next = (p: RecurringPlan) =>
    occurrenceDates(p, `${Number(today.slice(0, 4)) + 2}-12-31`).find((d) => d > today);
  const active = plans.filter((p) => p.active);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.875rem] text-muted">
          {count(active.length, 'active plan')} ·{' '}
          <Money cents={sumCents(active.map(monthlyEquivalentCents))} kind="projected" /> per month
        </p>
        <Button variant="primary" onClick={() => setEdit('new')} disabled={!live}>
          <Plus size={16} aria-hidden="true" /> New recurring expense
        </Button>
      </div>
      <section aria-label="Recurring expenses" className="rounded-panel bg-surface p-4 md:p-5">
        {plans.length === 0 ? (
          <EmptyNote>No recurring expenses yet. Add subscriptions or bills that repeat.</EmptyNote>
        ) : (
          <ul className="flex flex-col">
            {plans.map((p) => {
              const n = next(p);
              const made = ds.expenses.expenses.filter((e) => e.recurringPlanId === p.id).length;
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule py-2.5 last:border-0"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.875rem] text-ink">{p.merchant}</span>
                    <span className="block text-[0.75rem] text-faint">
                      {p.frequency === 'monthly' ? 'Monthly' : 'Yearly'} since {formatMedium(p.startDate)} ·{' '}
                      {count(made, 'charge')} so far{p.occurrences ? ` of ${p.occurrences}` : ''}
                    </span>
                  </span>
                  {p.active ? (
                    <span className="text-[0.75rem] text-muted">
                      {n ? `Next ${formatShort(n)}` : 'Ending'}
                    </span>
                  ) : (
                    <Pill>Ended</Pill>
                  )}
                  <span className="text-right">
                    <Money cents={p.amountCents} className="text-[0.875rem]" />
                    {p.frequency === 'yearly' && (
                      <span className="block text-[0.75rem] text-faint">
                        {formatMoney(monthlyEquivalentCents(p))}/mo
                      </span>
                    )}
                  </span>
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => setEdit(p)}
                    aria-label={`Edit ${p.merchant}`}
                  >
                    Edit
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {edit && <RecurringForm {...(edit === 'new' ? {} : { plan: edit })} onClose={() => setEdit(null)} />}
    </div>
  );
}

/* ------------------------------ budgets ------------------------------ */

function BudgetRow({
  label,
  month,
  categoryId,
  current,
  spent,
}: {
  label: string;
  month: string;
  categoryId: string | null;
  current: number | null;
  spent: number;
}) {
  const { live } = useData();
  const s = useSave();
  const [value, setValue] = useState(current !== null ? (current / 100).toFixed(2) : '');
  const dirty = (parseMoney(value) ?? 0) !== (current ?? 0) && !(value === '' && current === null);
  function save(e: FormEvent) {
    e.preventDefault();
    const cents = value.trim() === '' ? 0 : parseMoney(value);
    if (cents === null) return s.setErrors({ amountCents: 'Enter an amount' });
    const parsed = BudgetInput.safeParse({ month, categoryId, amountCents: cents });
    if (!parsed.success) return s.setErrors(fieldErrors(parsed.error));
    void s.run(
      () => api.put('/api/v1/budgets', parsed.data),
      cents ? 'Budget saved.' : 'Budget removed.',
      () => undefined,
    );
  }
  const ratio = current ? spent / current : 0;
  return (
    <form
      onSubmit={save}
      className="grid grid-cols-[minmax(0,1fr)_8rem_auto] items-end gap-3 border-b border-rule py-2.5 last:border-0"
    >
      <div className="min-w-0">
        <div className="truncate text-[0.875rem] text-ink">{label}</div>
        <div className="text-[0.75rem] text-faint">
          {current ? (
            <>
              Spent {formatMoney(spent)} ·{' '}
              {ratio > 1 ? (
                <span className="text-danger">over by {formatMoney(spent - current)}</span>
              ) : (
                `${formatMoney(current - spent)} left`
              )}
            </>
          ) : (
            `Spent ${formatMoney(spent)} · no budget`
          )}
        </div>
        {s.errors.amountCents && <div className="text-[0.75rem] text-danger">{s.errors.amountCents}</div>}
      </div>
      <MoneyInput aria-label={`${label} budget`} value={value} onChange={setValue} placeholder="None" />
      <Button type="submit" size="sm" disabled={!live || !dirty} busy={s.busy}>
        Save
      </Button>
    </form>
  );
}

export function BudgetsPage() {
  const { today } = useData();
  const ds = useDatasetOrThrow();
  const [scope, setScope] = useState<'*' | string>('*');
  if (!ds) return <SkeletonLines rows={6} />;
  const data = ds.expenses;
  const month = monthKey(today);
  const spentIn = (cat: string | null) =>
    sumCents(
      data.expenses
        .filter((e) => monthKey(e.date) === month && (cat === null || e.categoryId === cat))
        .map((e) => e.amountCents),
    );
  const exact = (cat: string | null) =>
    data.budgets.find((b) => b.month === scope && b.categoryId === cat)?.amountCents ?? null;
  return (
    <div className="flex max-w-[56rem] flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Budgets for">
          <Select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="*">Every month</option>
            <option value={month}>This month only ({month})</option>
          </Select>
        </Field>
        <p className="pb-2 text-[0.8125rem] text-faint">
          A month-specific budget replaces the every-month budget for that month. Spending shown is for{' '}
          {month}.
        </p>
      </div>
      <Panel title="Monthly budgets">
        <BudgetRow
          key={`${scope}-all`}
          label="Overall"
          month={scope}
          categoryId={null}
          current={exact(null)}
          spent={spentIn(null)}
        />
        {data.categories
          .filter((c) => !c.archived)
          .map((c) => (
            <BudgetRow
              key={`${scope}-${c.id}`}
              label={c.name}
              month={scope}
              categoryId={c.id}
              current={exact(c.id)}
              spent={spentIn(c.id)}
            />
          ))}
        <p className="mt-3 text-[0.75rem] text-faint">
          Effective this month: overall {formatMoney(budgetFor(data.budgets, month, null)?.amountCents ?? 0)}.
        </p>
      </Panel>
    </div>
  );
}
