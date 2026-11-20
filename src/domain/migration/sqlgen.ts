/**
 * SQL generation for OFFLINE seed/import files applied with
 * `wrangler d1 execute --local --file`. (The live API always uses bound
 * parameters; a file of statements can't, so literals are escaped here and
 * this module is tested against hostile input.)
 *
 * Every INSERT is `ON CONFLICT DO NOTHING`: only uniqueness conflicts (an already
 * imported row) are skipped, so re-applying a file is a no-op. A CHECK or
 * foreign-key violation still FAILS LOUDLY; `INSERT OR IGNORE` would silently
 * drop such rows, which an import must never do.
 */
import { expectedPay } from '../pay/engine';
import { PAY_RULES_V1 } from '../pay/rules';
import type { ExpenseData } from '../expenses/types';
import type { IncomePayment, WorkDay } from '../work/types';

export const row = (table: string, cols: Record<string, unknown>) =>
  `INSERT INTO ${table} (${Object.keys(cols).join(', ')}) VALUES (${Object.values(cols).map(lit).join(', ')}) ON CONFLICT DO NOTHING;`;

export function lit(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new RangeError('non-finite number in SQL literal');
    return String(v);
  }
  if (typeof v === 'string') {
    if (v.includes('\u0000')) throw new RangeError('NUL byte in SQL literal');
    return `'${v.replace(/'/g, "''")}'`;
  }
  throw new TypeError(`unsupported SQL literal: ${typeof v}`);
}

export interface SqlOptions {
  source: 'trackwell' | 'subtrack' | 'expenses';
  importRunId?: string;
  now: number;
}

export function workDaySql(d: WorkDay, o: SqlOptions): string[] {
  const pay = expectedPay(d);
  const src = d.source?.system === 'subtrack' ? 'subtrack' : 'trackwell';
  const out = [
    row('work_days', {
      id: d.id,
      date: d.date,
      status: d.status,
      employment_type: d.employmentType,
      role: d.role,
      format: d.format,
      school_name: d.schoolName,
      district: d.district,
      day_type: d.dayType,
      start_time: d.startTime,
      end_time: d.endTime,
      hours: d.hours,
      pay_rate: d.payRate ?? null,
      pay_rule_version: PAY_RULES_V1.version,
      expected_net_cents: pay.netCents,
      expected_gross_cents: pay.grossCents,
      class_name: d.className ?? null,
      teacher_name: d.teacherName ?? null,
      schedule_id: d.scheduleId ?? null,
      lunch_variant: d.lunchVariant ?? null,
      notes: d.notes ?? null,
      source: src,
      legacy_id: d.source?.legacyId ?? null,
      import_run_id: o.importRunId ?? null,
      created_at: o.now,
      updated_at: o.now,
    }),
  ];
  d.coverage.forEach((b, i) =>
    out.push(
      row('coverage_blocks', {
        id: `${d.id}:b${i + 1}`,
        work_day_id: d.id,
        position: i + 1,
        period_id: b.periodId ?? null,
        label: b.label ?? null,
        start_time: b.startTime ?? null,
        end_time: b.endTime ?? null,
        status: b.status,
        teacher_name: b.teacherName ?? null,
        room: b.room ?? null,
        subject: b.subject ?? null,
        notes: b.notes ?? null,
        copied_from_block_id: null,
      }),
    ),
  );
  return out;
}

export function paymentSql(p: IncomePayment, o: SqlOptions): string {
  return row('income_payments', {
    id: p.id,
    date: p.date,
    district: p.district,
    amount_cents: p.amountCents,
    pay_period_start: p.payPeriodStart ?? null,
    source: p.source?.system === 'subtrack' ? 'subtrack' : 'trackwell',
    legacy_id: p.source?.legacyId ?? null,
    import_run_id: o.importRunId ?? null,
    created_at: o.now,
    updated_at: o.now,
  });
}

export function expenseDataSql(x: ExpenseData, o: SqlOptions): string[] {
  const src = o.source === 'expenses' ? 'expenses' : 'trackwell';
  const legacy = (id: string) => (o.source === 'expenses' ? id.replace(/^ex-/, '') : null);
  const out: string[] = [];
  for (const c of x.categories)
    out.push(
      row('expense_categories', {
        id: c.id,
        name: c.name,
        color: c.color,
        archived_at: c.archived ? o.now : null,
        source: src,
        legacy_id: legacy(c.id),
        import_run_id: o.importRunId ?? null,
        updated_at: o.now,
      }),
    );
  for (const m of x.paymentMethods)
    out.push(
      row('payment_methods', {
        id: m.id,
        name: m.name,
        type: m.type,
        archived_at: m.archived ? o.now : null,
        source: src,
        legacy_id: legacy(m.id),
        import_run_id: o.importRunId ?? null,
        updated_at: o.now,
      }),
    );
  for (const r of x.recurringPlans)
    out.push(
      row('recurring_expenses', {
        id: r.id,
        merchant: r.merchant,
        amount_cents: r.amountCents,
        category_id: r.categoryId,
        payment_method_id: r.paymentMethodId,
        notes: r.notes ?? null,
        frequency: r.frequency,
        start_date: r.startDate,
        occurrences: r.occurrences ?? null,
        active: r.active ? 1 : 0,
        show_monthly_equivalent: r.showMonthlyEquivalent ? 1 : 0,
        source: src,
        legacy_id: legacy(r.id),
        import_run_id: o.importRunId ?? null,
        updated_at: o.now,
      }),
    );
  for (const e of x.expenses)
    out.push(
      row('expenses', {
        id: e.id,
        date: e.date,
        merchant: e.merchant,
        amount_cents: e.amountCents,
        category_id: e.categoryId,
        payment_method_id: e.paymentMethodId,
        notes: e.notes ?? null,
        recurring_id: e.recurringPlanId ?? null,
        source: src,
        legacy_id: e.source?.legacyId ?? legacy(e.id),
        import_run_id: o.importRunId ?? null,
        created_at: o.now,
        updated_at: o.now,
      }),
    );
  for (const b of x.budgets)
    out.push(
      row('budgets', { id: b.id, month: b.month, category_id: b.categoryId, amount_cents: b.amountCents }),
    );
  return out;
}
