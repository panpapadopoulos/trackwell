import { describe, expect, it } from 'vitest';
import { summarizeWork } from './summary';
import { plannedDays } from './defaults';
import type { IncomePayment, WorkDay } from './types';

let n = 0;
function day(date: string, o: Partial<WorkDay> = {}): WorkDay {
  n += 1;
  return {
    id: `w${n}`,
    date,
    status: 'worked',
    employmentType: 'regular',
    role: 'teacher',
    format: 'single',
    schoolName: 'Eads Elementary',
    district: 'Munster',
    dayType: 1,
    startTime: '08:00',
    endTime: '15:00',
    hours: 7,
    className: 'Grade 3',
    coverage: [],
    ...o,
  };
}
const pay = (date: string, cents: number): IncomePayment => ({
  id: `p${date}`,
  date,
  district: 'Munster',
  amountCents: cents,
});

const TODAY = '2026-11-18';
const days: WorkDay[] = [
  // 2025-26: prior arrangement era (before the 2026-08-01 cutoff)
  day('2026-03-10', { className: 'Math' }),
  day('2026-03-11', { dayType: 0.5, className: 'Math' }),
  day('2026-03-12', { role: 'aide', hours: 6, className: 'Resource' }),
  // 2026-27
  day('2026-10-20', {
    employmentType: 'permanent',
    schoolName: 'Munster High School',
    className: 'Chemistry',
  }),
  day('2026-10-21', {
    employmentType: 'permanent',
    schoolName: 'Munster High School',
    format: 'multiple',
    coverage: [
      {
        id: 'a',
        periodId: 'P1',
        status: 'covered',
        teacherName: 'Johnson',
        subject: 'Biology',
        room: 'N161',
      },
      { id: 'b', periodId: 'P2', status: 'free' },
      { id: 'c', periodId: 'P3', status: 'covered', teacherName: 'Smith', subject: 'Algebra', room: 'N204' },
      { id: 'd', periodId: 'P4', status: 'covered', teacherName: 'Smith', subject: 'Algebra', room: 'N204' },
    ],
  }),
  day('2026-11-17'),
  day('2026-11-19', { status: 'planned' }), // projection: must never count
];
const payments = [pay('2026-03-27', 21096 + 8897 - 1), pay('2026-11-06', 22854)];

describe('summarizeWork', () => {
  const s = summarizeWork(days, payments, { range: {} }, TODAY);

  it('counts only worked days; a multiple-coverage day is ONE assignment', () => {
    expect(s.assignments).toBe(6);
    expect(s.permanentDays).toBe(2);
    expect(s.regularDays).toBe(4);
    expect(s.multipleCoverageDays).toBe(1);
    expect(s.coveredPeriods).toBe(3);
  });

  it('keeps legacy secondary stats (full/half count teacher records only)', () => {
    expect(s.teacherJobs).toBe(5);
    expect(s.aideJobs).toBe(1);
    expect(s.fullDays).toBe(4);
    expect(s.halfDays).toBe(1);
  });

  it('expected gross/net and per-employment earnings', () => {
    // regular: 105.48 + 52.74 + 6h*12.71=76.26 + 105.48 ; permanent: 2 × 114.27
    expect(s.byEmployment.regular.netCents).toBe(10548 + 5274 + 7626 + 10548);
    expect(s.byEmployment.permanent.netCents).toBe(2 * 11427);
    expect(s.byEmployment.permanent.grossCents).toBe(2 * 13000);
    expect(s.expectedNetCents).toBe(10548 + 5274 + 7626 + 10548 + 2 * 11427);
    expect(s.receivedCents).toBe(payments[0]!.amountCents + payments[1]!.amountCents);
  });

  it('outstanding = upcoming + overdue unpaid periods; the legacy formula is kept as a separate check', () => {
    expect(s.outstandingCents).toBe(10548); // the Nov 16–29 period, payday Dec 4, no payment yet
    expect(s.upcomingCents).toBe(10548);
    expect(s.overdueCents).toBe(0);
    expect(s.legacyStillExpectedCents).toBe(Math.max(2 * 11427 + 10548 - 22854, 0));
  });

  it('outstanding and received are unknowable (null) when a school/type filter is applied', () => {
    const f = summarizeWork(days, payments, { range: {}, employmentType: 'permanent' }, TODAY);
    expect(f.outstandingCents).toBeNull();
    expect(f.receivedCents).toBeNull();
    expect(f.assignments).toBe(2);
  });

  it('reconciles periods against actual payments and finds the next paycheck', () => {
    const oct = s.periods.find((p) => p.period.start === '2026-10-19')!;
    expect(oct.status).toBe('paid');
    expect(oct.paymentDates).toEqual(['2026-11-06']);
    const nov = s.periods.find((p) => p.period.start === '2026-11-16')!;
    expect(nov.status).toBe('upcoming');
    expect(s.nextPaycheck?.period.expectedPayday).toBe('2026-12-04');
    expect(s.nextPaycheck?.expectedNetCents).toBe(10548);
    expect(s.recent[0]?.status).toBe('upcoming');
  });

  it('top classes count covered blocks for coverage days and className for single days', () => {
    expect(s.topClasses[0]).toEqual({ name: 'Algebra', count: 2 });
    expect(s.topClasses.find((c) => c.name === 'Math')?.count).toBe(2);
  });

  it('monthly series is gap-filled so summer months exist with zeros', () => {
    expect(s.monthly.map((m) => m.month)).toContain('2026-07');
    expect(s.monthly.find((m) => m.month === '2026-07')?.expectedNetCents).toBe(0);
  });

  it('school-year filter scopes everything to Aug 1 – Jul 31', () => {
    const sy = summarizeWork(days, payments, { range: { from: '2025-08-01', to: '2026-07-31' } }, TODAY);
    expect(sy.assignments).toBe(3);
    // outstanding is point-in-time (what is owed today), independent of the range
    expect(sy.outstandingCents).toBe(s.outstandingCents);
    expect(sy.legacyStillExpectedCents).toBe(0);
  });
});

describe('employment defaults', () => {
  it('produce planned (never worked) days and skip dates that already have work', () => {
    const planned = plannedDays('2026-11-16', '2026-11-22', [{ date: '2026-11-17' }]);
    expect(planned.map((d) => d.date)).toEqual(['2026-11-16', '2026-11-18', '2026-11-19', '2026-11-20']);
    expect(planned.every((d) => d.status === 'planned')).toBe(true);
    expect(planned[0]).toMatchObject({ employmentType: 'permanent', schoolName: 'Munster High School' });
    expect(planned[2]).toMatchObject({ employmentType: 'regular', schoolName: '' });
  });
});
