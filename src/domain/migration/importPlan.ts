/**
 * Legacy → D1 import plan (pure). The CLI (tools/migrate/legacy-import.ts) only
 * does file I/O and runs wrangler; every decision is here and tested on
 * synthetic legacy-shaped data.
 *
 * Safety properties:
 *  1. Validate: input schemas, referential integrity, and the database's own
 *     limits are checked BEFORE any SQL exists. Any problem ⇒ no SQL (refuse).
 *  2. Stable identifiers: st-<legacy id> / ex-<legacy id>; (source, legacy_id) unique.
 *  3. Idempotent: ON CONFLICT DO NOTHING; re-running inserts nothing.
 *  4. Archived: the raw legacy documents are stored write-once (incl. retired balances/sync).
 *  5. Reversible: rollback SQL removes exactly this run's rows (by import_run_id).
 *  6. Reconcilable: control totals computed from the legacy input with the legacy rules.
 */
import { lit, paymentSql, row, workDaySql, expenseDataSql } from './sqlgen';
import { mapLegacy, type ControlTotals, type MappedImport } from './legacy';

export interface ImportIssue {
  kind: 'schema' | 'reference' | 'limit' | 'duplicate';
  /** Where (entity + field), never the value itself (privacy). */
  where: string;
  count: number;
}

export interface ImportPlan {
  runId: string;
  ok: boolean;
  issues: ImportIssue[];
  controls: ControlTotals;
  mapped: MappedImport | null;
  sql: string[];
  rollbackSql: string[];
}

const LIMITS: Array<[string, (m: MappedImport) => Array<string | undefined>, number]> = [
  ['work_days.school_name', (m) => m.workDays.map((d) => d.schoolName), 160],
  ['work_days.district', (m) => m.workDays.map((d) => d.district), 120],
  ['work_days.notes', (m) => m.workDays.map((d) => d.notes), 2000],
  ['expenses.merchant', (m) => m.expenses.expenses.map((e) => e.merchant), 160],
  ['expenses.notes', (m) => m.expenses.expenses.map((e) => e.notes), 2000],
  ['expense_categories.name', (m) => m.expenses.categories.map((c) => c.name), 80],
  ['payment_methods.name', (m) => m.expenses.paymentMethods.map((x) => x.name), 80],
  ['recurring_expenses.merchant', (m) => m.expenses.recurringPlans.map((r) => r.merchant), 160],
];

function countBy<T>(xs: T[], pred: (x: T) => boolean) {
  return xs.reduce((n, x) => n + (pred(x) ? 1 : 0), 0);
}

export function planImport(
  subtrackRaw: unknown,
  expensesRaw: unknown,
  meta: { runId: string; now: number; subtrackSha256: string; expensesSha256: string },
): ImportPlan {
  const empty = (issues: ImportIssue[]): ImportPlan => ({
    runId: meta.runId,
    ok: false,
    issues,
    mapped: null,
    sql: [],
    rollbackSql: [],
    controls: {
      jobs: 0,
      payments: 0,
      expectedNetCents: 0,
      paymentsCents: 0,
      expenses: 0,
      expensesCents: 0,
      categories: 0,
      paymentMethods: 0,
      recurring: 0,
    },
  });

  let mapped: MappedImport;
  try {
    mapped = mapLegacy(subtrackRaw, expensesRaw);
  } catch (e) {
    const paths = (e as { issues?: Array<{ path: Array<string | number> }> }).issues?.map((i) =>
      i.path.filter((p) => typeof p === 'string').join('.'),
    ) ?? ['document'];
    const grouped = new Map<string, number>();
    for (const p of paths) grouped.set(p || 'document', (grouped.get(p || 'document') ?? 0) + 1);
    return empty([...grouped].map(([where, count]) => ({ kind: 'schema', where, count })));
  }

  const issues: ImportIssue[] = [];
  // Referential integrity
  const cats = new Set(mapped.expenses.categories.map((c) => c.id));
  const methods = new Set(mapped.expenses.paymentMethods.map((m) => m.id));
  const plans = new Set(mapped.expenses.recurringPlans.map((p) => p.id));
  const refs: Array<[string, number]> = [
    ['expenses.category', countBy(mapped.expenses.expenses, (e) => !cats.has(e.categoryId))],
    ['expenses.payment_method', countBy(mapped.expenses.expenses, (e) => !methods.has(e.paymentMethodId))],
    [
      'expenses.recurring',
      countBy(mapped.expenses.expenses, (e) => Boolean(e.recurringPlanId) && !plans.has(e.recurringPlanId!)),
    ],
    ['recurring.category', countBy(mapped.expenses.recurringPlans, (p) => !cats.has(p.categoryId))],
    [
      'recurring.payment_method',
      countBy(mapped.expenses.recurringPlans, (p) => !methods.has(p.paymentMethodId)),
    ],
  ];
  for (const [where, count] of refs) if (count) issues.push({ kind: 'reference', where, count });
  // Database limits (would fail CHECK constraints)
  for (const [where, get, max] of LIMITS) {
    const n = countBy(
      get(mapped),
      (v) => v !== undefined && (v.length > max || v.trim().length === 0) && !where.endsWith('notes'),
    );
    const tooLong = countBy(get(mapped), (v) => v !== undefined && v.length > max);
    if (n || tooLong) issues.push({ kind: 'limit', where, count: Math.max(n, tooLong) });
  }
  const nonPositive =
    countBy(mapped.payments, (p) => p.amountCents <= 0) +
    countBy(mapped.expenses.expenses, (e) => e.amountCents <= 0);
  if (nonPositive) issues.push({ kind: 'limit', where: 'amount_cents > 0', count: nonPositive });
  // Duplicate ids within a source would collapse into one row: refuse instead of losing one.
  const dup = (ids: string[]) => ids.length - new Set(ids).size;
  for (const [where, n] of [
    ['work_days.id', dup(mapped.workDays.map((d) => d.id))],
    ['income_payments.id', dup(mapped.payments.map((p) => p.id))],
    ['expenses.id', dup(mapped.expenses.expenses.map((e) => e.id))],
  ] as const)
    if (n) issues.push({ kind: 'duplicate', where, count: n });
  // One live permanent day per date (DB unique index)
  const perm = mapped.workDays.filter((d) => d.employmentType === 'permanent').map((d) => d.date);
  if (dup(perm)) issues.push({ kind: 'duplicate', where: 'work_days.permanent_per_date', count: dup(perm) });

  if (issues.length) return { ...empty(issues), controls: mapped.before, mapped };

  const o = { now: meta.now, importRunId: meta.runId };
  const sql = [
    row('import_runs', {
      id: meta.runId,
      started_at: meta.now,
      finished_at: meta.now,
      source: 'subtrack',
      backup_sha256: meta.subtrackSha256,
      dry_run: 0,
      report_json: null,
    }),
    row('legacy_archive', {
      id: `${meta.runId}:subtrack`,
      import_run_id: meta.runId,
      source: 'subtrack',
      kv_key: 'user_data',
      sha256: meta.subtrackSha256,
      raw_json: JSON.stringify(subtrackRaw),
      archived_at: meta.now,
    }),
    row('legacy_archive', {
      id: `${meta.runId}:expenses`,
      import_run_id: meta.runId,
      source: 'expenses',
      kv_key: 'user_data',
      sha256: meta.expensesSha256,
      raw_json: JSON.stringify(expensesRaw),
      archived_at: meta.now,
    }),
    ...mapped.workDays.flatMap((d) => workDaySql(d, { ...o, source: 'subtrack' })),
    ...mapped.payments.map((p) => paymentSql(p, { ...o, source: 'subtrack' })),
    ...expenseDataSql(mapped.expenses, { ...o, source: 'expenses' }),
  ];
  const r = lit(meta.runId);
  const rollbackSql = [
    `DELETE FROM coverage_blocks WHERE work_day_id IN (SELECT id FROM work_days WHERE import_run_id = ${r});`,
    `DELETE FROM work_days WHERE import_run_id = ${r};`,
    `DELETE FROM income_payments WHERE import_run_id = ${r};`,
    `DELETE FROM recurring_skips WHERE recurring_id IN (SELECT id FROM recurring_expenses WHERE import_run_id = ${r});`,
    `DELETE FROM expenses WHERE import_run_id = ${r};`,
    `DELETE FROM recurring_expenses WHERE import_run_id = ${r};`,
    `DELETE FROM payment_methods WHERE import_run_id = ${r};`,
    `DELETE FROM expense_categories WHERE import_run_id = ${r};`,
    `UPDATE import_runs SET report_json = '{"rolledBack":true}' WHERE id = ${r};`,
    '-- legacy_archive rows are write-once by design and stay as the record of what was imported.',
  ];
  return { runId: meta.runId, ok: true, issues: [], controls: mapped.before, mapped, sql, rollbackSql };
}

/** Queries whose results must equal the plan's control totals (run against the imported DB). */
export function verificationQueries(runId: string): Record<keyof ControlTotals, string> {
  const r = lit(runId);
  return {
    jobs: `SELECT count(*) AS v FROM work_days WHERE import_run_id = ${r}`,
    payments: `SELECT count(*) AS v FROM income_payments WHERE import_run_id = ${r}`,
    expectedNetCents: `SELECT ifnull(sum(expected_net_cents), 0) AS v FROM work_days WHERE import_run_id = ${r}`,
    paymentsCents: `SELECT ifnull(sum(amount_cents), 0) AS v FROM income_payments WHERE import_run_id = ${r}`,
    expenses: `SELECT count(*) AS v FROM expenses WHERE import_run_id = ${r}`,
    expensesCents: `SELECT ifnull(sum(amount_cents), 0) AS v FROM expenses WHERE import_run_id = ${r}`,
    categories: `SELECT count(*) AS v FROM expense_categories WHERE import_run_id = ${r}`,
    paymentMethods: `SELECT count(*) AS v FROM payment_methods WHERE import_run_id = ${r}`,
    recurring: `SELECT count(*) AS v FROM recurring_expenses WHERE import_run_id = ${r}`,
  };
}
