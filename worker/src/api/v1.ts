/**
 * Trackwell data API v1. Record-level only: there is no endpoint that replaces
 * the whole dataset. Every write is Zod-validated, parameterized, written in an
 * atomic batch with its audit row, and version-checked (optimistic concurrency).
 */
import { z } from 'zod';
import { todayISO } from '../../../src/domain/dates';
import { expectedPay } from '../../../src/domain/pay/engine';
import { PAY_RULES_V1 } from '../../../src/domain/pay/rules';
import { generateDue } from '../../../src/domain/expenses/recurring';
import type { Expense, RecurringPlan } from '../../../src/domain/expenses/types';
import type { CoverageBlock, WorkDay } from '../../../src/domain/work/types';
import {
  BudgetInput,
  CategoryInput,
  ExpenseInput,
  PaymentInput,
  PaymentMethodInput,
  PayPeriodOverrideInput,
  RecurringInput,
  ScheduleOverrideInput,
  Versioned,
  WorkDayInput,
  isoDate,
} from '../../../src/shared/api';
import type { Snapshot } from '../../../src/shared/snapshot';
import { isForeignKeyViolation, isUniqueViolation, type D1Stmt } from '../db';

export { json, type ApiCtx } from './http';
import { audit, body, conflict, defineRoute, json, notFound, nn, type ApiCtx, type Route } from './http';
import { assistantRoutes } from './assistant';
import { loadAssistantPrefs, loadWeekDefaults, settingsRoutes } from './settings';

type Json = Record<string, unknown>;

/* ------------------------------ snapshot ------------------------------ */

type WorkRow = {
  id: string;
  date: string;
  status: WorkDay['status'];
  employment_type: WorkDay['employmentType'];
  role: WorkDay['role'];
  format: WorkDay['format'];
  school_name: string;
  district: string;
  day_type: number;
  start_time: string;
  end_time: string;
  hours: number;
  pay_rate: number | null;
  class_name: string | null;
  teacher_name: string | null;
  schedule_id: string | null;
  lunch_variant: string | null;
  notes: string | null;
  source: 'subtrack' | 'trackwell';
  legacy_id: string | null;
  updated_at: number;
};
type BlockRow = {
  id: string;
  work_day_id: string;
  position: number;
  period_id: string | null;
  label: string | null;
  start_time: string | null;
  end_time: string | null;
  status: CoverageBlock['status'];
  teacher_name: string | null;
  room: string | null;
  subject: string | null;
  notes: string | null;
  copied_from_block_id: string | null;
};

const opt = <K extends string, V>(k: K, v: V | null) =>
  v === null || v === undefined ? {} : ({ [k]: v } as Record<K, V>);

async function snapshot(ctx: ApiCtx): Promise<Snapshot> {
  const q = (sql: string) => ctx.db.prepare(sql);
  const r = await ctx.db.batch([
    q('SELECT * FROM work_days WHERE deleted_at IS NULL ORDER BY date, id'),
    q(
      'SELECT b.* FROM coverage_blocks b JOIN work_days w ON w.id = b.work_day_id WHERE w.deleted_at IS NULL ORDER BY b.work_day_id, b.position',
    ),
    q('SELECT * FROM income_payments WHERE deleted_at IS NULL ORDER BY date, id'),
    q('SELECT * FROM expenses WHERE deleted_at IS NULL ORDER BY date, id'),
    q('SELECT * FROM expense_categories ORDER BY name'),
    q('SELECT * FROM payment_methods ORDER BY name'),
    q('SELECT * FROM recurring_expenses WHERE deleted_at IS NULL ORDER BY merchant'),
    q('SELECT * FROM recurring_skips'),
    q('SELECT * FROM budgets'),
    q('SELECT * FROM pay_period_overrides'),
    q('SELECT * FROM schedule_date_overrides'),
  ]);
  const rows = <T>(i: number) => (r[i]!.results ?? []) as T[];
  const blocks = new Map<string, CoverageBlock[]>();
  for (const b of rows<BlockRow>(1)) {
    const list = blocks.get(b.work_day_id) ?? [];
    list.push({
      id: b.id,
      status: b.status,
      ...opt('periodId', b.period_id),
      ...opt('label', b.label),
      ...opt('startTime', b.start_time),
      ...opt('endTime', b.end_time),
      ...opt('teacherName', b.teacher_name),
      ...opt('room', b.room),
      ...opt('subject', b.subject),
      ...opt('notes', b.notes),
      ...opt('copiedFromBlockId', b.copied_from_block_id),
    });
    blocks.set(b.work_day_id, list);
  }
  type R = Record<string, unknown>;
  return {
    workDays: rows<WorkRow>(0).map((w) => ({
      id: w.id,
      date: w.date,
      status: w.status,
      employmentType: w.employment_type,
      role: w.role,
      format: w.format,
      schoolName: w.school_name,
      district: w.district,
      dayType: w.day_type === 0.5 ? 0.5 : 1,
      startTime: w.start_time,
      endTime: w.end_time,
      hours: w.hours,
      ...opt('payRate', w.pay_rate),
      ...opt('className', w.class_name),
      ...opt('teacherName', w.teacher_name),
      ...opt('scheduleId', w.schedule_id),
      ...opt('lunchVariant', w.lunch_variant),
      ...opt('notes', w.notes),
      coverage: blocks.get(w.id) ?? [],
      source: { system: w.source, ...opt('legacyId', w.legacy_id) },
      updatedAt: w.updated_at,
    })),
    payments: rows<R>(2).map((p) => ({
      id: String(p.id),
      date: String(p.date),
      district: String(p.district),
      amountCents: Number(p.amount_cents),
      ...opt('payPeriodStart', p.pay_period_start as string | null),
      updatedAt: Number(p.updated_at),
      source: {
        system: p.source as 'subtrack' | 'trackwell',
        ...opt('legacyId', p.legacy_id as string | null),
      },
    })),
    expenses: rows<R>(3).map((e) => ({
      id: String(e.id),
      date: String(e.date),
      merchant: String(e.merchant),
      amountCents: Number(e.amount_cents),
      categoryId: String(e.category_id),
      paymentMethodId: String(e.payment_method_id),
      ...opt('notes', e.notes as string | null),
      ...opt('recurringPlanId', e.recurring_id as string | null),
      updatedAt: Number(e.updated_at),
      source: {
        system: e.source as 'expenses' | 'trackwell',
        ...opt('legacyId', e.legacy_id as string | null),
      },
    })),
    categories: rows<R>(4).map((c) => ({
      id: String(c.id),
      name: String(c.name),
      color: String(c.color),
      archived: c.archived_at !== null,
      updatedAt: Number(c.updated_at),
    })),
    paymentMethods: rows<R>(5).map((m) => ({
      id: String(m.id),
      name: String(m.name),
      type: String(m.type),
      archived: m.archived_at !== null,
      updatedAt: Number(m.updated_at),
    })),
    recurringPlans: rows<R>(6).map((p) => ({
      id: String(p.id),
      merchant: String(p.merchant),
      amountCents: Number(p.amount_cents),
      categoryId: String(p.category_id),
      paymentMethodId: String(p.payment_method_id),
      ...opt('notes', p.notes as string | null),
      frequency: p.frequency as 'monthly' | 'yearly',
      startDate: String(p.start_date),
      ...opt('occurrences', p.occurrences as number | null),
      active: p.active === 1,
      showMonthlyEquivalent: p.show_monthly_equivalent === 1,
      updatedAt: Number(p.updated_at),
    })),
    recurringSkips: rows<R>(7).map((s) => ({ planId: String(s.recurring_id), date: String(s.date) })),
    budgets: rows<R>(8).map((b) => ({
      id: String(b.id),
      month: String(b.month),
      categoryId: (b.category_id as string | null) ?? null,
      amountCents: Number(b.amount_cents),
    })),
    payPeriodOverrides: rows<R>(9).map((o) => ({
      periodStart: String(o.period_start),
      payday: String(o.payday),
      ...opt('note', o.note as string | null),
    })),
    scheduleOverrides: rows<R>(10).map((o) => ({
      schoolName: String(o.school_name),
      date: String(o.date),
      scheduleId: String(o.schedule_id),
    })),
    employmentDefaults: await loadWeekDefaults(ctx.db, todayISO(new Date(ctx.now()))),
    assistant: await loadAssistantPrefs(ctx.db),
    serverToday: todayISO(new Date(ctx.now())),
  };
}

/* ------------------------------ work days ------------------------------ */

function workDayValues(d: WorkDayInput) {
  const pay = expectedPay({
    employmentType: d.employmentType,
    role: d.role,
    dayType: d.dayType,
    hours: d.hours,
    ...(d.payRate ? { payRate: d.payRate } : {}),
  });
  return [
    d.date,
    d.status,
    d.employmentType,
    d.role,
    d.format,
    d.schoolName,
    d.district,
    d.dayType,
    d.startTime,
    d.endTime,
    d.hours,
    nn(d.payRate),
    PAY_RULES_V1.version,
    pay.netCents,
    pay.grossCents,
    nn(d.className),
    nn(d.teacherName),
    nn(d.scheduleId),
    nn(d.lunchVariant),
    nn(d.notes),
  ];
}

/** Coverage inserts are guarded so they only apply if the parent row is at `version` (atomic with the version check). */
function blockInserts(
  ctx: ApiCtx,
  workDayId: string,
  version: number,
  blocks: WorkDayInput['coverage'],
): D1Stmt[] {
  return blocks.map((b, i) =>
    ctx.db
      .prepare(
        `INSERT INTO coverage_blocks (id, work_day_id, position, period_id, label, start_time, end_time, status, teacher_name, room, subject, notes, copied_from_block_id)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM work_days WHERE id = ? AND updated_at = ?)`,
      )
      .bind(
        ctx.newId(),
        workDayId,
        i + 1,
        nn(b.periodId),
        nn(b.label),
        nn(b.startTime),
        nn(b.endTime),
        b.status,
        nn(b.teacherName),
        nn(b.room),
        nn(b.subject),
        nn(b.notes),
        nn(b.copiedFromBlockId),
        workDayId,
        version,
      ),
  );
}

const DUPLICATE_DAY =
  'A permanent work day is already saved for this date. Edit that day instead: a permanent day is paid once.';

export async function createWorkDay(ctx: ApiCtx, d: WorkDayInput) {
  const id = ctx.newId();
  const t = ctx.now();
  try {
    await ctx.db.batch([
      ctx.db
        .prepare(
          `INSERT INTO work_days (id, date, status, employment_type, role, format, school_name, district, day_type, start_time, end_time, hours,
            pay_rate, pay_rule_version, expected_net_cents, expected_gross_cents, class_name, teacher_name, schedule_id, lunch_variant, notes,
            source, legacy_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'trackwell', NULL, ?, ?)`,
        )
        .bind(id, ...workDayValues(d), t, t),
      ...blockInserts(ctx, id, t, d.coverage),
      audit(ctx, 'work_day', id, 'create', d),
    ]);
  } catch (e) {
    if (isUniqueViolation(e)) return conflict(DUPLICATE_DAY);
    throw e;
  }
  return json(201, { id, updatedAt: t });
}

async function updateWorkDay(ctx: ApiCtx, id: string, d: WorkDayInput, expected: number) {
  const t = Math.max(ctx.now(), expected + 1);
  let res;
  try {
    res = await ctx.db.batch([
      ctx.db
        .prepare(
          `UPDATE work_days SET date = ?, status = ?, employment_type = ?, role = ?, format = ?, school_name = ?, district = ?, day_type = ?,
             start_time = ?, end_time = ?, hours = ?, pay_rate = ?, pay_rule_version = ?, expected_net_cents = ?, expected_gross_cents = ?,
             class_name = ?, teacher_name = ?, schedule_id = ?, lunch_variant = ?, notes = ?, updated_at = ?
           WHERE id = ? AND updated_at = ? AND deleted_at IS NULL`,
        )
        .bind(...workDayValues(d), t, id, expected),
      ctx.db
        .prepare(
          'DELETE FROM coverage_blocks WHERE work_day_id = ? AND EXISTS (SELECT 1 FROM work_days WHERE id = ? AND updated_at = ?)',
        )
        .bind(id, id, t),
      ...blockInserts(ctx, id, t, d.coverage),
    ]);
  } catch (e) {
    if (isUniqueViolation(e)) return conflict(DUPLICATE_DAY);
    throw e;
  }
  if (res[0]!.meta.changes === 0) return staleOrMissing(ctx, 'work_days', id);
  await audit(ctx, 'work_day', id, 'update', d).run();
  return json(200, { id, updatedAt: t });
}

async function staleOrMissing(ctx: ApiCtx, table: string, id: string) {
  const exists = await ctx.db
    .prepare(`SELECT 1 AS x FROM ${table} WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first();
  return exists
    ? conflict('This record changed since you opened it. Reload to see the latest version, then try again.')
    : notFound();
}

async function softDelete(ctx: ApiCtx, table: string, entity: string, id: string) {
  const t = ctx.now();
  const r = await ctx.db
    .prepare(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`)
    .bind(t, t, id)
    .run();
  if (r.meta.changes === 0) return notFound();
  await audit(ctx, entity, id, 'delete', null).run();
  return json(200, { id, deleted: true });
}

/* ------------------------------ router ------------------------------ */

const routes: Route[] = [];
const route = defineRoute(routes);

// The whole-dataset snapshot is READ-ONLY.
route('GET', '/snapshot', async (ctx) => json(200, await snapshot(ctx)));

route('POST', '/work-days', async (ctx, req) => {
  const d = await body(req, WorkDayInput);
  return d instanceof Response ? d : createWorkDay(ctx, d);
});
route('PUT', '/work-days/:id', async (ctx, req, [id]) => {
  const d = await body(req, WorkDayInput.and(Versioned));
  return d instanceof Response ? d : updateWorkDay(ctx, id!, d, d.updatedAt);
});
route('DELETE', '/work-days/:id', (ctx, _r, [id]) => softDelete(ctx, 'work_days', 'work_day', id!));

route('POST', '/payments', async (ctx, req) => {
  const d = await body(req, PaymentInput);
  if (d instanceof Response) return d;
  const id = ctx.newId();
  const t = ctx.now();
  await ctx.db.batch([
    ctx.db
      .prepare(
        `INSERT INTO income_payments (id, date, district, amount_cents, pay_period_start, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'trackwell', ?, ?)`,
      )
      .bind(id, d.date, d.district, d.amountCents, nn(d.payPeriodStart), t, t),
    audit(ctx, 'payment', id, 'create', d),
  ]);
  return json(201, { id, updatedAt: t });
});
route('PUT', '/payments/:id', async (ctx, req, [id]) => {
  const d = await body(req, PaymentInput.and(Versioned));
  if (d instanceof Response) return d;
  const t = Math.max(ctx.now(), d.updatedAt + 1);
  const r = await ctx.db
    .prepare(
      `UPDATE income_payments SET date = ?, district = ?, amount_cents = ?, pay_period_start = ?, updated_at = ? WHERE id = ? AND updated_at = ? AND deleted_at IS NULL`,
    )
    .bind(d.date, d.district, d.amountCents, nn(d.payPeriodStart), t, id, d.updatedAt)
    .run();
  if (r.meta.changes === 0) return staleOrMissing(ctx, 'income_payments', id!);
  await audit(ctx, 'payment', id!, 'update', d).run();
  return json(200, { id, updatedAt: t });
});
route('DELETE', '/payments/:id', (ctx, _r, [id]) => softDelete(ctx, 'income_payments', 'payment', id!));

route('PUT', '/pay-periods/:id', async (ctx, req, [start]) => {
  if (!isoDate.safeParse(start).success)
    return json(422, { error: 'invalid', message: 'Pay period start must be a date.' });
  const d = await body(req, PayPeriodOverrideInput);
  if (d instanceof Response) return d;
  await ctx.db.batch([
    ctx.db
      .prepare(
        `INSERT INTO pay_period_overrides (period_start, payday, note, updated_at) VALUES (?, ?, ?, ?)
                ON CONFLICT (period_start) DO UPDATE SET payday = excluded.payday, note = excluded.note, updated_at = excluded.updated_at`,
      )
      .bind(start, d.payday, nn(d.note), ctx.now()),
    audit(ctx, 'pay_period_override', start!, 'update', d),
  ]);
  return json(200, { periodStart: start });
});
route('DELETE', '/pay-periods/:id', async (ctx, _r, [start]) => {
  const r = await ctx.db.prepare('DELETE FROM pay_period_overrides WHERE period_start = ?').bind(start).run();
  if (r.meta.changes) await audit(ctx, 'pay_period_override', start!, 'delete', null).run();
  return r.meta.changes ? json(200, { periodStart: start, deleted: true }) : notFound();
});

const fkGuard = async (fn: () => Promise<Response>) => {
  try {
    return await fn();
  } catch (e) {
    if (isForeignKeyViolation(e))
      return json(422, { error: 'invalid', message: 'The category or payment method no longer exists.' });
    throw e;
  }
};

route('POST', '/expenses', async (ctx, req) => {
  const d = await body(req, ExpenseInput);
  if (d instanceof Response) return d;
  const id = ctx.newId();
  const t = ctx.now();
  return fkGuard(async () => {
    await ctx.db.batch([
      ctx.db
        .prepare(
          `INSERT INTO expenses (id, date, merchant, amount_cents, category_id, payment_method_id, notes, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'trackwell', ?, ?)`,
        )
        .bind(id, d.date, d.merchant, d.amountCents, d.categoryId, d.paymentMethodId, nn(d.notes), t, t),
      audit(ctx, 'expense', id, 'create', d),
    ]);
    return json(201, { id, updatedAt: t });
  });
});
route('PUT', '/expenses/:id', async (ctx, req, [id]) => {
  const d = await body(req, ExpenseInput.and(Versioned));
  if (d instanceof Response) return d;
  const t = Math.max(ctx.now(), d.updatedAt + 1);
  return fkGuard(async () => {
    const r = await ctx.db
      .prepare(
        `UPDATE expenses SET date = ?, merchant = ?, amount_cents = ?, category_id = ?, payment_method_id = ?, notes = ?, updated_at = ? WHERE id = ? AND updated_at = ? AND deleted_at IS NULL`,
      )
      .bind(
        d.date,
        d.merchant,
        d.amountCents,
        d.categoryId,
        d.paymentMethodId,
        nn(d.notes),
        t,
        id,
        d.updatedAt,
      )
      .run();
    if (r.meta.changes === 0) return staleOrMissing(ctx, 'expenses', id!);
    await audit(ctx, 'expense', id!, 'update', d).run();
    return json(200, { id, updatedAt: t });
  });
});
route('DELETE', '/expenses/:id', async (ctx, _r, [id]) => {
  const row = await ctx.db
    .prepare('SELECT recurring_id, date FROM expenses WHERE id = ? AND deleted_at IS NULL')
    .bind(id)
    .first<{ recurring_id: string | null; date: string }>();
  if (!row) return notFound();
  const t = ctx.now();
  await ctx.db.batch([
    ctx.db.prepare('UPDATE expenses SET deleted_at = ?, updated_at = ? WHERE id = ?').bind(t, t, id),
    // A deleted recurring occurrence stays deleted: never regenerated (legacy defect D5).
    ...(row.recurring_id
      ? [
          ctx.db
            .prepare('INSERT OR IGNORE INTO recurring_skips (recurring_id, date) VALUES (?, ?)')
            .bind(row.recurring_id, row.date),
        ]
      : []),
    audit(ctx, 'expense', id!, 'delete', null),
  ]);
  return json(200, { id, deleted: true });
});

function simpleCrud(
  path: string,
  table: string,
  entity: string,
  schema: typeof CategoryInput | typeof PaymentMethodInput,
  cols: [string, string],
) {
  route('POST', path, async (ctx, req) => {
    const d = (await body(req, schema)) as Json | Response;
    if (d instanceof Response) return d;
    const id = ctx.newId();
    const t = ctx.now();
    await ctx.db.batch([
      ctx.db
        .prepare(
          `INSERT INTO ${table} (id, name, ${cols[1]}, source, updated_at) VALUES (?, ?, ?, 'trackwell', ?)`,
        )
        .bind(id, d.name, d[cols[0]], t),
      audit(ctx, entity, id, 'create', d),
    ]);
    return json(201, { id, updatedAt: t });
  });
  route('PUT', `${path}/:id`, async (ctx, req, [id]) => {
    const d = (await body(req, schema.and(Versioned).and(z.object({ archived: z.boolean().optional() })))) as
      Json | Response;
    if (d instanceof Response) return d;
    const t = Math.max(ctx.now(), Number(d.updatedAt) + 1);
    const r = await ctx.db
      .prepare(
        `UPDATE ${table} SET name = ?, ${cols[1]} = ?, archived_at = ?, updated_at = ? WHERE id = ? AND updated_at = ?`,
      )
      .bind(d.name, d[cols[0]], d.archived ? t : null, t, id, d.updatedAt)
      .run();
    if (r.meta.changes === 0) {
      const exists = await ctx.db.prepare(`SELECT 1 AS x FROM ${table} WHERE id = ?`).bind(id).first();
      return exists ? conflict('This record changed since you opened it. Reload and try again.') : notFound();
    }
    await audit(ctx, entity, id!, 'update', d).run();
    return json(200, { id, updatedAt: t });
  });
  // Removing never deletes history: it archives (hidden from pickers, kept on old records).
  route('DELETE', `${path}/:id`, async (ctx, _r, [id]) => {
    const t = ctx.now();
    const r = await ctx.db
      .prepare(`UPDATE ${table} SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL`)
      .bind(t, t, id)
      .run();
    if (r.meta.changes === 0) return notFound();
    await audit(ctx, entity, id!, 'delete', null).run();
    return json(200, { id, archived: true });
  });
}
simpleCrud('/categories', 'expense_categories', 'category', CategoryInput, ['color', 'color']);
simpleCrud('/payment-methods', 'payment_methods', 'payment_method', PaymentMethodInput, ['type', 'type']);

const recurringValues = (d: RecurringInput) => [
  d.merchant,
  d.amountCents,
  d.categoryId,
  d.paymentMethodId,
  nn(d.notes),
  d.frequency,
  d.startDate,
  nn(d.occurrences),
  d.active ? 1 : 0,
  d.showMonthlyEquivalent ? 1 : 0,
];
route('POST', '/recurring', async (ctx, req) => {
  const d = await body(req, RecurringInput);
  if (d instanceof Response) return d;
  const id = ctx.newId();
  const t = ctx.now();
  return fkGuard(async () => {
    await ctx.db.batch([
      ctx.db
        .prepare(
          `INSERT INTO recurring_expenses (id, merchant, amount_cents, category_id, payment_method_id, notes, frequency, start_date, occurrences, active, show_monthly_equivalent, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'trackwell', ?)`,
        )
        .bind(id, ...recurringValues(d), t),
      audit(ctx, 'recurring', id, 'create', d),
    ]);
    return json(201, { id, updatedAt: t });
  });
});
route('PUT', '/recurring/:id', async (ctx, req, [id]) => {
  const d = await body(req, RecurringInput.and(Versioned));
  if (d instanceof Response) return d;
  const t = Math.max(ctx.now(), d.updatedAt + 1);
  return fkGuard(async () => {
    const r = await ctx.db
      .prepare(
        `UPDATE recurring_expenses SET merchant = ?, amount_cents = ?, category_id = ?, payment_method_id = ?, notes = ?, frequency = ?, start_date = ?, occurrences = ?, active = ?, show_monthly_equivalent = ?, updated_at = ? WHERE id = ? AND updated_at = ? AND deleted_at IS NULL`,
      )
      .bind(...recurringValues(d), t, id, d.updatedAt)
      .run();
    if (r.meta.changes === 0) return staleOrMissing(ctx, 'recurring_expenses', id!);
    await audit(ctx, 'recurring', id!, 'update', d).run();
    return json(200, { id, updatedAt: t });
  });
});
route('DELETE', '/recurring/:id', (ctx, _r, [id]) => softDelete(ctx, 'recurring_expenses', 'recurring', id!));

/** Idempotent: inserts only occurrences that are due, not yet present, and not skipped. Uses the SERVER's date. */
route('POST', '/recurring/sync', async (ctx) => {
  const today = todayISO(new Date(ctx.now()));
  const snap = await snapshot(ctx);
  const allPlanExpenses = await ctx.db
    .prepare('SELECT id, date, recurring_id FROM expenses WHERE recurring_id IS NOT NULL')
    .all<{ id: string; date: string; recurring_id: string }>();
  const existing: Expense[] = allPlanExpenses.results.map((e) => ({
    id: e.id,
    date: e.date,
    merchant: '',
    amountCents: 0,
    categoryId: '',
    paymentMethodId: '',
    recurringPlanId: e.recurring_id,
  }));
  const gen = generateDue(snap.recurringPlans as RecurringPlan[], existing, snap.recurringSkips, today, () =>
    ctx.newId(),
  );
  const t = ctx.now();
  const stmts = gen.newExpenses.map((e) =>
    ctx.db
      .prepare(
        `INSERT INTO expenses (id, date, merchant, amount_cents, category_id, payment_method_id, notes, recurring_id, source, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'trackwell', ?, ?) ON CONFLICT DO NOTHING`,
      )
      .bind(
        e.id,
        e.date,
        e.merchant,
        e.amountCents,
        e.categoryId,
        e.paymentMethodId,
        nn(e.notes),
        e.recurringPlanId,
        t,
        t,
      ),
  );
  for (const pid of gen.completedPlanIds)
    stmts.push(
      ctx.db.prepare('UPDATE recurring_expenses SET active = 0, updated_at = ? WHERE id = ?').bind(t, pid),
    );
  if (stmts.length) await ctx.db.batch(stmts);
  return json(200, { created: gen.newExpenses.length, completed: gen.completedPlanIds.length });
});

route('PUT', '/budgets', async (ctx, req) => {
  const d = await body(req, BudgetInput);
  if (d instanceof Response) return d;
  const del = ctx.db
    .prepare(`DELETE FROM budgets WHERE month = ? AND ifnull(category_id, '') = ?`)
    .bind(d.month, d.categoryId ?? '');
  const id = ctx.newId();
  const stmts = [del];
  if (d.amountCents > 0)
    stmts.push(
      ctx.db
        .prepare('INSERT INTO budgets (id, month, category_id, amount_cents) VALUES (?, ?, ?, ?)')
        .bind(id, d.month, d.categoryId, d.amountCents),
    );
  stmts.push(
    audit(ctx, 'budget', `${d.month}:${d.categoryId ?? 'all'}`, d.amountCents > 0 ? 'update' : 'delete', d),
  );
  return fkGuard(async () => {
    await ctx.db.batch(stmts);
    return json(200, { id: d.amountCents > 0 ? id : null });
  });
});

route('PUT', '/schedule-overrides', async (ctx, req) => {
  const d = await body(req, ScheduleOverrideInput);
  if (d instanceof Response) return d;
  await ctx.db
    .prepare(
      `INSERT INTO schedule_date_overrides (school_name, date, schedule_id, updated_at) VALUES (?, ?, ?, ?)
              ON CONFLICT (school_name, date) DO UPDATE SET schedule_id = excluded.schedule_id, updated_at = excluded.updated_at`,
    )
    .bind(d.schoolName, d.date, d.scheduleId, ctx.now())
    .run();
  return json(200, { ok: true });
});
route('DELETE', '/schedule-overrides', async (ctx, req) => {
  const d = await body(req, ScheduleOverrideInput.pick({ schoolName: true, date: true }));
  if (d instanceof Response) return d;
  await ctx.db
    .prepare('DELETE FROM schedule_date_overrides WHERE school_name = ? AND date = ?')
    .bind(d.schoolName, d.date)
    .run();
  return json(200, { ok: true });
});

export async function v1(ctx: ApiCtx, req: Request): Promise<Response> {
  const path = new URL(req.url).pathname;
  let pathMatched = false;
  for (const [method, re, h] of [...routes, ...settingsRoutes, ...assistantRoutes]) {
    const m = re.exec(path);
    if (!m) continue;
    pathMatched = true;
    if (method !== req.method) continue;
    try {
      return await h(ctx, req, m.slice(1).map(decodeURIComponent));
    } catch (e) {
      // Never leak internals or data; log only the failure class.
      console.error(
        'api_error',
        req.method,
        path.replace(/\/[0-9a-f-]{8,}$/i, '/:id'),
        e instanceof Error ? e.message.slice(0, 120) : 'unknown',
      );
      return json(500, { error: 'server_error', message: 'Something went wrong. Nothing was saved.' });
    }
  }
  return pathMatched ? json(405, { error: 'method_not_allowed' }) : json(404, { error: 'not_found' });
}
