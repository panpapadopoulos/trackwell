import { describe, expect, it } from 'vitest';
import { expectedPay, hoursBetween } from './engine';
import { payPeriodFor, paymentMatchesPeriod } from './periods';
import type { CoverageBlock, WorkDay } from '../work/types';

const base: WorkDay = {
  id: 'd1',
  date: '2026-11-18',
  status: 'worked',
  employmentType: 'permanent',
  role: 'teacher',
  format: 'single',
  schoolName: 'Munster High School',
  district: 'Munster',
  dayType: 1,
  startTime: '07:15',
  endTime: '14:50',
  hours: 7.58,
  coverage: [],
};

const block = (i: number, status: CoverageBlock['status'] = 'covered'): CoverageBlock => ({
  id: `b${i}`,
  periodId: `P${i}`,
  status,
  teacherName: `Teacher ${i}`,
  room: `N${100 + i}`,
});

describe('expectedPay: Phase 1 characterization values', () => {
  const cases: Array<[string, Partial<WorkDay>, number, number]> = [
    ['teacher regular full', { employmentType: 'regular' }, 10548, 10548],
    ['teacher regular half', { employmentType: 'regular', dayType: 0.5 }, 5274, 5274],
    ['teacher regular payRate 120', { employmentType: 'regular', payRate: 120 }, 12000, 12000],
    ['assistant regular 7h', { employmentType: 'regular', role: 'aide', hours: 7 }, 8897, 8897],
    ['assistant regular 3.5h', { employmentType: 'regular', role: 'aide', hours: 3.5 }, 4448, 4448],
    [
      'assistant payRate 0 falls back',
      { employmentType: 'regular', role: 'aide', hours: 7, payRate: 0 },
      8897,
      8897,
    ],
    ['permanent teacher half 2h', { dayType: 0.5, hours: 2 }, 11427, 13000],
    ['permanent assistant 3h', { role: 'aide', hours: 3 }, 11427, 13000],
  ];
  for (const [name, o, net, gross] of cases)
    it(name, () => {
      const r = expectedPay({ ...base, ...o });
      expect(r.netCents).toBe(net);
      expect(r.grossCents).toBe(gross);
    });
});

describe('Multiple Coverage never multiplies daily pay', () => {
  for (const employmentType of ['permanent', 'regular'] as const)
    for (const role of ['teacher', 'aide'] as const)
      for (const dayType of [1, 0.5] as const)
        it(`${employmentType}/${role}/${dayType}: 7 blocks pay the same as a single assignment`, () => {
          const single = { ...base, employmentType, role, dayType };
          const multi: WorkDay = {
            ...single,
            format: 'multiple',
            coverage: [
              block(1),
              block(2, 'free'),
              block(3),
              block(4),
              block(5, 'free'),
              block(6),
              block(7, 'planning'),
            ],
          };
          expect(expectedPay(multi)).toEqual(expectedPay(single));
        });

  it('all four employment-type × format combinations are representable', () => {
    for (const employmentType of ['permanent', 'regular'] as const)
      for (const format of ['single', 'multiple'] as const) {
        const d: WorkDay = {
          ...base,
          employmentType,
          format,
          coverage: format === 'multiple' ? [block(1)] : [],
        };
        expect(expectedPay(d).netCents).toBeGreaterThan(0);
      }
  });
});

describe('hoursBetween', () => {
  it('matches the legacy form: permanent default day is 7.58 h, wraps midnight', () => {
    expect(hoursBetween('07:15', '14:50')).toBe(7.58);
    expect(hoursBetween('08:00', '15:00')).toBe(7);
    expect(hoursBetween('22:00', '01:30')).toBe(3.5);
  });
});

describe('pay periods (DST-safe) and paydays', () => {
  it('2026-08-24 (a DST period-start Monday) is in its own period, not the previous one', () => {
    const p = payPeriodFor('2026-08-24');
    expect(p.start).toBe('2026-08-24');
    expect(p.end).toBe('2026-09-06');
    expect(p.label).toBe('Aug 24 – Sep 6');
  });

  it('is stable across the spring-forward transition (2026-03-08)', () => {
    expect(payPeriodFor('2026-03-07').start).toBe('2026-02-23');
    expect(payPeriodFor('2026-03-08').start).toBe('2026-02-23');
    expect(payPeriodFor('2026-03-09').start).toBe('2026-03-09');
    expect(payPeriodFor('2026-03-22').start).toBe('2026-03-09');
  });

  it('is stable across the fall-back transition (2026-11-01)', () => {
    expect(payPeriodFor('2026-10-31').start).toBe('2026-10-19');
    expect(payPeriodFor('2026-11-01').start).toBe('2026-10-19');
    expect(payPeriodFor('2026-11-02').start).toBe('2026-11-02');
  });

  it('payday is the Friday after the period ends (end + 5 days)', () => {
    const p = payPeriodFor('2026-11-18');
    expect(p).toMatchObject({ start: '2026-11-16', end: '2026-11-29', expectedPayday: '2026-12-04' });
  });

  it('does not alter the date or pay of the work itself', () => {
    const before = { ...base, date: '2026-08-24' };
    const pay = expectedPay(before);
    payPeriodFor(before.date);
    expect(before.date).toBe('2026-08-24');
    expect(expectedPay(before)).toEqual(pay);
  });

  it('payment matching window: 3 days before to 7 days after the expected payday', () => {
    const p = payPeriodFor('2026-11-18'); // payday Dec 4
    expect(paymentMatchesPeriod('2026-12-01', p)).toBe(true);
    expect(paymentMatchesPeriod('2026-11-30', p)).toBe(false);
    expect(paymentMatchesPeriod('2026-12-11', p)).toBe(true);
    expect(paymentMatchesPeriod('2026-12-12', p)).toBe(false);
  });
});
