import { earningsFromPeriods } from '../earnings';
import { monthKey, addMonths, weekday, type ISODate, type MonthKey } from '../dates';
import { inRange, type DateRange } from '../filters';
import { sumCents, type Cents } from '../money';
import { expectedPay } from '../pay/engine';
import { payPeriodFor, paymentMatchesPeriod, type PayPeriod } from '../pay/periods';
import { PAY_RULES_V1, PAY_SCHEDULE_V1, type PayRules, type PayScheduleConfig } from '../pay/rules';
import type { EmploymentType, IncomePayment, WorkDay } from './types';

export interface WorkFilter {
  range: DateRange;
  schoolName?: string;
  employmentType?: EmploymentType;
}

export type PeriodPayStatus =
  /** A payment record exists in the period's payday window. */
  | 'paid'
  /** Expected payday is today or later. */
  | 'upcoming'
  /** Expected payday has passed and no payment record matches. */
  | 'awaiting'
  /** Before the outstanding-tracking cutoff; legacy treats it as settled under the prior arrangement. */
  | 'prior-arrangement';

export interface PeriodRow {
  period: PayPeriod;
  days: number;
  hours: number;
  expectedNetCents: Cents;
  receivedCents: Cents;
  /** Actual date(s) money arrived, when paid. */
  paymentDates: ISODate[];
  status: PeriodPayStatus;
}

export interface MonthRow {
  month: MonthKey;
  permanentDays: number;
  regularDays: number;
  permanentNetCents: Cents;
  regularNetCents: Cents;
  expectedNetCents: Cents;
  /** Always 0 while a school/type filter is active (payments cannot be scoped by either). */
  receivedCents: Cents;
}

export interface WorkSummary {
  assignments: number;
  permanentDays: number;
  regularDays: number;
  teacherJobs: number;
  aideJobs: number;
  /** Teacher records only (legacy definition). */
  fullDays: number;
  halfDays: number;
  multipleCoverageDays: number;
  coveredPeriods: number;
  hours: number;
  expectedNetCents: Cents;
  expectedGrossCents: Cents;
  /** null when a school/type filter is active: payments carry neither, so they cannot be scoped. */
  receivedCents: Cents | null;
  /** Legacy "Still Expected". null when filters make it unknowable (payments carry no school/type). */
  /** Shared model (earnings.ts): earned, unpaid, point-in-time; same figure on every dashboard. null while filtered. */
  outstandingCents: Cents | null;
  upcomingCents: Cents | null;
  overdueCents: Cents | null;
  /** Legacy SubTrack formula, shown only as a reconciliation check. */
  legacyStillExpectedCents: Cents | null;
  byEmployment: Record<EmploymentType, { days: number; netCents: Cents; grossCents: Cents }>;
  currentMonth: { month: MonthKey; expectedNetCents: Cents; receivedCents: Cents; days: number };
  nextPaycheck: PeriodRow | null;
  monthly: MonthRow[];
  periods: PeriodRow[];
  topClasses: { name: string; count: number }[];
  weekdays: { day: string; count: number }[];
  /** paidOn = actual date of the payment that settled the day's period (never the work date). */
  recent: { day: WorkDay; netCents: Cents; status: PeriodPayStatus; paidOn: ISODate | null }[];
  schools: string[];
}

function matchesFilter(d: WorkDay, f: WorkFilter): boolean {
  return (
    d.status === 'worked' &&
    inRange(d.date, f.range) &&
    (!f.schoolName || d.schoolName === f.schoolName) &&
    (!f.employmentType || d.employmentType === f.employmentType)
  );
}

/** Reconcile every period that has worked days against actual payments. Independent of view filters. */
export function reconcilePeriods(
  days: readonly WorkDay[],
  payments: readonly IncomePayment[],
  today: ISODate,
  rules: PayRules = PAY_RULES_V1,
  cfg: PayScheduleConfig = PAY_SCHEDULE_V1,
): Map<ISODate, PeriodRow> {
  const rows = new Map<ISODate, PeriodRow>();
  for (const d of days) {
    if (d.status !== 'worked') continue;
    const period = payPeriodFor(d.date, cfg);
    let row = rows.get(period.start);
    if (!row) {
      row = {
        period,
        days: 0,
        hours: 0,
        expectedNetCents: 0,
        receivedCents: 0,
        paymentDates: [],
        status: 'upcoming',
      };
      rows.set(period.start, row);
    }
    row.days += 1;
    row.hours += d.hours;
    row.expectedNetCents += expectedPay(d, rules).netCents;
  }
  for (const row of rows.values()) {
    const matched = payments.filter((p) =>
      p.payPeriodStart
        ? p.payPeriodStart === row.period.start
        : paymentMatchesPeriod(p.date, row.period, cfg),
    );
    row.receivedCents = sumCents(matched.map((p) => p.amountCents));
    row.paymentDates = matched.map((p) => p.date).sort();
    row.hours = Number(row.hours.toFixed(2));
    if (matched.length > 0) row.status = 'paid';
    else if (row.period.end < rules.outstandingTrackingStart) row.status = 'prior-arrangement';
    else if (row.period.expectedPayday >= today) row.status = 'upcoming';
    else row.status = 'awaiting';
  }
  return rows;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function summarizeWork(
  days: readonly WorkDay[],
  payments: readonly IncomePayment[],
  filter: WorkFilter,
  today: ISODate,
  rules: PayRules = PAY_RULES_V1,
  cfg: PayScheduleConfig = PAY_SCHEDULE_V1,
): WorkSummary {
  const worked = days.filter((d) => matchesFilter(d, filter));
  const paymentsInRange = payments.filter((p) => inRange(p.date, filter.range));
  const pay = new Map(worked.map((d) => [d.id, expectedPay(d, rules)]));
  const net = (d: WorkDay) => pay.get(d.id)?.netCents ?? 0;

  const byEmployment: WorkSummary['byEmployment'] = {
    permanent: { days: 0, netCents: 0, grossCents: 0 },
    regular: { days: 0, netCents: 0, grossCents: 0 },
  };
  for (const d of worked) {
    const p = pay.get(d.id)!;
    const b = byEmployment[d.employmentType];
    b.days += 1;
    b.netCents += p.netCents;
    b.grossCents += p.grossCents;
  }

  const teacher = worked.filter((d) => d.role === 'teacher');
  const filtered = Boolean(filter.schoolName || filter.employmentType);
  const cutoff = rules.outstandingTrackingStart;
  // Legacy SubTrack "Still Expected" formula, kept ONLY as a reconciliation check (see earnings.ts).
  const legacyStillExpectedCents = filtered
    ? null
    : Math.max(
        sumCents(worked.filter((d) => d.date >= cutoff).map(net)) -
          sumCents(paymentsInRange.filter((p) => p.date >= cutoff).map((p) => p.amountCents)),
        0,
      );

  // Monthly rows over the span of the filtered data.
  const monthMap = new Map<MonthKey, MonthRow>();
  const ensure = (m: MonthKey) => {
    let r = monthMap.get(m);
    if (!r) {
      r = {
        month: m,
        permanentDays: 0,
        regularDays: 0,
        permanentNetCents: 0,
        regularNetCents: 0,
        expectedNetCents: 0,
        receivedCents: 0,
      };
      monthMap.set(m, r);
    }
    return r;
  };
  for (const d of worked) {
    const r = ensure(monthKey(d.date));
    const c = net(d);
    r.expectedNetCents += c;
    if (d.employmentType === 'permanent') {
      r.permanentDays += 1;
      r.permanentNetCents += c;
    } else {
      r.regularDays += 1;
      r.regularNetCents += c;
    }
  }
  if (!filtered) for (const p of paymentsInRange) ensure(monthKey(p.date)).receivedCents += p.amountCents;
  const keys = [...monthMap.keys()].sort();
  const monthly: MonthRow[] = [];
  if (keys.length) {
    // Fill gaps so time on the x-axis stays linear (summers show as empty months).
    for (let m = keys[0]!; m <= keys[keys.length - 1]!; m = addMonths(m, 1)) monthly.push(ensure(m));
  }

  // Periods: reconciled on ALL work (payments settle whole periods), then scoped to the view.
  const reconciled = reconcilePeriods(days, payments, today, rules, cfg);
  const visibleStarts = new Set(worked.map((d) => payPeriodFor(d.date, cfg).start));
  const periods = [...reconciled.values()]
    .filter((r) => visibleStarts.has(r.period.start))
    .sort((a, b) => b.period.start.localeCompare(a.period.start));
  const earnings = earningsFromPeriods([...reconciled.values()]);
  const nextPaycheck =
    [...reconciled.values()]
      .filter((r) => r.status === 'upcoming')
      .sort((a, b) => a.period.expectedPayday.localeCompare(b.period.expectedPayday))[0] ?? null;

  // Top classes: legacy counted className per record; coverage days count each covered block.
  const classCounts = new Map<string, number>();
  let coveredPeriods = 0;
  for (const d of worked) {
    const covered = d.coverage.filter((b) => b.status === 'covered');
    coveredPeriods += covered.length;
    const names =
      d.format === 'multiple' ? covered.map((b) => b.subject || b.teacherName || '') : [d.className ?? ''];
    for (const n of names) if (n) classCounts.set(n, (classCounts.get(n) ?? 0) + 1);
  }
  const topClasses = [...classCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 5);

  const wdCounts = [0, 0, 0, 0, 0, 0, 0];
  for (const d of worked) wdCounts[weekday(d.date)]! += 1;
  const weekdays = WEEKDAYS.map((day, i) => ({ day, count: wdCounts[i]! })).filter(
    (w, i) => (i >= 1 && i <= 5) || w.count > 0,
  );

  const thisMonth = monthKey(today);
  const monthDays = days.filter((d) => d.status === 'worked' && monthKey(d.date) === thisMonth);

  const recent = [...worked]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8)
    .map((day) => {
      const row = reconciled.get(payPeriodFor(day.date, cfg).start);
      return {
        day,
        netCents: net(day),
        status: row?.status ?? 'upcoming',
        paidOn: row?.paymentDates[0] ?? null,
      };
    });

  return {
    assignments: worked.length,
    permanentDays: byEmployment.permanent.days,
    regularDays: byEmployment.regular.days,
    teacherJobs: teacher.length,
    aideJobs: worked.length - teacher.length,
    fullDays: teacher.filter((d) => d.dayType === 1).length,
    halfDays: teacher.filter((d) => d.dayType === 0.5).length,
    multipleCoverageDays: worked.filter((d) => d.format === 'multiple').length,
    coveredPeriods,
    hours: Number(worked.reduce((s, d) => s + d.hours, 0).toFixed(2)),
    expectedNetCents: sumCents(worked.map(net)),
    expectedGrossCents: sumCents(worked.map((d) => pay.get(d.id)!.grossCents)),
    receivedCents: filtered ? null : sumCents(paymentsInRange.map((p) => p.amountCents)),
    outstandingCents: filtered ? null : earnings.outstandingCents,
    upcomingCents: filtered ? null : earnings.upcomingCents,
    overdueCents: filtered ? null : earnings.overdueCents,
    legacyStillExpectedCents,
    byEmployment,
    currentMonth: {
      month: thisMonth,
      expectedNetCents: sumCents(monthDays.map((d) => expectedPay(d, rules).netCents)),
      receivedCents: sumCents(
        payments.filter((p) => monthKey(p.date) === thisMonth).map((p) => p.amountCents),
      ),
      days: monthDays.length,
    },
    nextPaycheck,
    monthly,
    periods,
    topClasses,
    weekdays,
    recent,
    schools: [...new Set(days.map((d) => d.schoolName).filter(Boolean))].sort(),
  };
}
