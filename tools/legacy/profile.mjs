#!/usr/bin/env node
/**
 * Read-only structural profiler for legacy SubTrack / Expenses backups.
 *
 * PRIVACY CONTRACT: this script prints ONLY structure and aggregate counts:
 * field names, value types, presence counts, id-format shapes, duplicate and
 * orphan counts, and rule pass rates. It never prints record values, names,
 * merchants, notes, dates, or money amounts/totals. Backups are opened
 * read-only and are never written.
 *
 * Usage: node tools/legacy/profile.mjs <subtrack-backup.json> <expenses-backup.json>
 */
import { readFileSync } from 'node:fs';

const [subtrackPath, expensesPath] = process.argv.slice(2);
if (!subtrackPath || !expensesPath) {
  console.error('usage: profile.mjs <subtrack-backup.json> <expenses-backup.json>');
  process.exit(2);
}

const load = (p) => JSON.parse(readFileSync(p, 'utf8'));

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/** Field name -> { present, types } across a record array. */
function fieldSurvey(records) {
  const out = {};
  for (const r of records) {
    for (const [k, v] of Object.entries(r)) {
      out[k] ??= { present: 0, types: new Set() };
      out[k].present += 1;
      out[k].types.add(typeOf(v));
    }
  }
  return Object.fromEntries(
    Object.entries(out).map(([k, v]) => [k, `${v.present}/${records.length} ${[...v.types].join('|')}`]),
  );
}

/** Shape of an id without revealing it: "a9" = 9 alnum chars, "job-n-f" = CSV import pattern. */
function idShape(id) {
  if (typeof id !== 'string') return typeOf(id);
  if (/^job-\d+-0\.\d+$/.test(id)) return 'job-<line>-<float>';
  if (/^pay-\d+-0\.\d+$/.test(id)) return 'pay-<line>-<float>';
  if (/^[a-z0-9]+$/.test(id)) return `alnum${id.length}`;
  return `other${id.length}`;
}

function countBy(records, fn) {
  const m = {};
  for (const r of records) {
    const k = String(fn(r));
    m[k] = (m[k] ?? 0) + 1;
  }
  return m;
}

function duplicates(values) {
  const seen = new Set();
  let dup = 0;
  for (const v of values) {
    if (seen.has(v)) dup += 1;
    seen.add(v);
  }
  return dup;
}

const isoDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const schoolYear = (s) => {
  const [y, m] = s.split('-').map(Number);
  const start = m >= 8 ? y : y - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
};

// ---------- SubTrack ----------
const st = load(subtrackPath);
const jobs = Array.isArray(st.jobs) ? st.jobs : [];
const payments = Array.isArray(st.payments) ? st.payments : [];

const report = { subtrack: {}, expenses: {}, payday: {} };
report.subtrack.topLevelKeys = Object.keys(st);
report.subtrack.counts = { jobs: jobs.length, payments: payments.length };
report.subtrack.jobFields = fieldSurvey(jobs);
report.subtrack.paymentFields = fieldSurvey(payments);
report.subtrack.jobIdShapes = countBy(jobs, (j) => idShape(j.id));
report.subtrack.paymentIdShapes = countBy(payments, (p) => idShape(p.id));
report.subtrack.duplicateIds = {
  jobs: duplicates(jobs.map((j) => j.id)),
  payments: duplicates(payments.map((p) => p.id)),
};
report.subtrack.role = countBy(jobs, (j) => j.role ?? '(absent)');
report.subtrack.employmentType = countBy(jobs, (j) => j.employmentType ?? '(absent)');
report.subtrack.dayType = countBy(jobs, (j) => j.dayType);
report.subtrack.payRatePresent = countBy(jobs, (j) => (j.payRate ? 'set' : 'absent/0'));
report.subtrack.districtCardinality = new Set(jobs.map((j) => j.town)).size;
report.subtrack.schoolCardinality = new Set(jobs.map((j) => j.school)).size;
report.subtrack.teacherCardinality = new Set(jobs.map((j) => j.teacher)).size;
report.subtrack.nonIsoDates = {
  jobs: jobs.filter((j) => !isoDate(j.date)).length,
  payments: payments.filter((p) => !isoDate(p.date)).length,
};
report.subtrack.timeFormat = countBy(jobs, (j) =>
  /^\d{2}:\d{2}$/.test(j.fromTime ?? '') && /^\d{2}:\d{2}$/.test(j.toTime ?? '') ? 'HH:MM' : 'other',
);
report.subtrack.jobsPerSchoolYear = countBy(
  jobs.filter((j) => isoDate(j.date)),
  (j) => schoolYear(j.date),
);
report.subtrack.paymentsPerSchoolYear = countBy(
  payments.filter((p) => isoDate(p.date)),
  (p) => schoolYear(p.date),
);
report.subtrack.contentDuplicateJobs = duplicates(
  jobs.map((j) =>
    [j.date, j.teacher, j.className, j.school, j.role ?? '', j.employmentType ?? ''].join('\u0001'),
  ),
);
report.subtrack.workdaysWithMultipleRecords = Object.values(countBy(jobs, (j) => j.date)).filter(
  (n) => n > 1,
).length;
report.subtrack.everydayDatesWithMultipleRecords = Object.values(
  countBy(
    jobs.filter((j) => j.employmentType === 'everyday'),
    (j) => j.date,
  ),
).filter((n) => n > 1).length;
report.subtrack.negativeOrZeroPayments = payments.filter((p) => !(p.amount > 0)).length;

// ---------- Expenses ----------
const ex = load(expensesPath);
const expenses = ex.expenses ?? [];
const categories = ex.categories ?? [];
const accounts = ex.accounts ?? [];
const recurring = ex.recurringExpenses ?? [];
report.expenses.topLevelKeys = Object.keys(ex);
report.expenses.counts = {
  expenses: expenses.length,
  categories: categories.length,
  accounts: accounts.length,
  recurringExpenses: recurring.length,
  syncedPaymentIds: ex.subtrackSync?.syncedPaymentIds?.length ?? '(absent)',
};
report.expenses.expenseFields = fieldSurvey(expenses);
report.expenses.categoryFields = fieldSurvey(categories);
report.expenses.accountFields = fieldSurvey(accounts);
report.expenses.recurringFields = fieldSurvey(recurring);
report.expenses.subtrackSyncKeys = ex.subtrackSync ? Object.keys(ex.subtrackSync) : '(absent)';
const catIds = new Set(categories.map((c) => c.id));
const accIds = new Set(accounts.map((a) => a.id));
const recIds = new Set(recurring.map((r) => r.id));
report.expenses.orphans = {
  expenseCategory: expenses.filter((e) => !catIds.has(e.categoryId)).length,
  expenseAccount: expenses.filter((e) => !accIds.has(e.accountId)).length,
  expenseRecurring: expenses.filter((e) => e.recurringId && !recIds.has(e.recurringId)).length,
  recurringCategory: recurring.filter((r) => !catIds.has(r.categoryId)).length,
  recurringAccount: recurring.filter((r) => !accIds.has(r.accountId)).length,
};
report.expenses.duplicateIds = {
  expenses: duplicates(expenses.map((e) => e.id)),
  categories: duplicates(categories.map((c) => c.id)),
  accounts: duplicates(accounts.map((a) => a.id)),
  recurring: duplicates(recurring.map((r) => r.id)),
};
report.expenses.contentDuplicateExpenses = duplicates(
  expenses.map((e) => [e.date, e.merchant, e.amount, e.accountId].join('\u0001')),
);
report.expenses.nonIsoDates = expenses.filter((e) => !isoDate(e.date)).length;
report.expenses.nonPositiveAmounts = expenses.filter((e) => !(e.amount > 0)).length;
report.expenses.generatedFromRecurring = expenses.filter((e) => e.recurringId).length;
report.expenses.recurringFrequency = countBy(recurring, (r) => r.frequency);
report.expenses.recurringActive = countBy(recurring, (r) => r.active);
report.expenses.accountsWithNonZeroBalance = accounts.filter((a) => a.balance).length;
report.expenses.expensesPerYear = countBy(
  expenses.filter((e) => isoDate(e.date)),
  (e) => e.date.slice(0, 4),
);
const syncIds = new Set(ex.subtrackSync?.syncedPaymentIds ?? []);
report.expenses.syncedIdsMatchingSubtrackPayments = payments.filter((p) => syncIds.has(p.id)).length;
report.expenses.expenseIdsCollidingWithSubtrackIds = expenses.filter(
  (e) => jobs.some((j) => j.id === e.id) || payments.some((p) => p.id === e.id),
).length;

// ---------- Payday rule verification (aggregate only) ----------
// Candidate rule: biweekly periods anchored Mon 2024-01-01 (Mon..Sun, 14 days);
// payday = second Friday after the period's last day (Sunday) = periodEnd + 12 days.
const DAY = 86_400_000;
const utc = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const ANCHOR = Date.UTC(2024, 0, 1);
const datedPayments = payments.filter((p) => isoDate(p.date));
const weekday = countBy(
  datedPayments,
  (p) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(utc(p.date)).getUTCDay()],
);
// offset of payment date within the 14-day cycle, relative to period starts
const cycleOffset = countBy(datedPayments, (p) => {
  const days = Math.round((utc(p.date) - ANCHOR) / DAY);
  return ((days % 14) + 14) % 14;
});
// rule: payday = periodStart + 13 (end) + 12 = periodStart + 25 => offset (25 % 14) = 11 in cycle
const matchesRule = datedPayments.filter((p) => {
  const days = Math.round((utc(p.date) - ANCHOR) / DAY);
  return ((days % 14) + 14) % 14 === 11;
}).length;
const byEra = (pred) => {
  const set = datedPayments.filter(pred);
  const ok = set.filter((p) => {
    const days = Math.round((utc(p.date) - ANCHOR) / DAY);
    return ((days % 14) + 14) % 14 === 11;
  }).length;
  return `${ok}/${set.length}`;
};
report.payday = {
  paymentsConsidered: datedPayments.length,
  weekdayDistribution: weekday,
  cycleOffsetDistribution: cycleOffset,
  matchesSecondFridayAfterPeriodEnd: `${matchesRule}/${datedPayments.length}`,
  matchesBeforeAug2026: byEra((p) => p.date < '2026-08-01'),
  matchesFromAug2026: byEra((p) => p.date >= '2026-08-01'),
  matchesByDistrictCount: Object.fromEntries(
    [...new Set(datedPayments.map((p) => p.town))].map((t, i) => [
      `district#${i + 1}`,
      byEra((p) => p.town === t),
    ]),
  ),
};

console.log(JSON.stringify(report, null, 2));
