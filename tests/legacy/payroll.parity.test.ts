/**
 * Regression parity: the new pay engine vs the VERBATIM legacy SubTrack payroll
 * (src/domain/legacy/subtrack/utils/payroll.ts, subtrack@def1e6a).
 * Runs with TZ=America/Chicago (vite.config.ts) so DST behavior is real.
 */
import { describe, expect, it } from 'vitest';
import * as legacy from '../../src/domain/legacy/subtrack/utils/payroll';
import type { Job } from '../../src/domain/legacy/subtrack/types';
import { expectedPay } from '../../src/domain/pay/engine';
import { PAY_RULES_V1 } from '../../src/domain/pay/rules';
import { payPeriodFor } from '../../src/domain/pay/periods';
import { addDays, toDayNumber, weekday } from '../../src/domain/dates';
import { schoolYearKey } from '../../src/domain/schoolYear';
import { defaultsFor } from '../../src/domain/work/defaults';
import { centsFromDollars } from '../../src/domain/money';

const roles: Array<Job['role']> = ['teacher', 'aide', undefined];
const employment: Array<Job['employmentType']> = ['everyday', 'regular', undefined];
const dayTypes: Array<Job['dayType']> = [1, 0.5];
const hours = [0, 2, 3.5, 7, 7.58, 8.25];
const rates: Array<number | undefined> = [undefined, 0, 105.48, 120, 12.71, 15.5, 99.99];

function job(o: Partial<Job>): Job {
  return {
    id: 'x',
    date: '2026-09-01',
    className: 'c',
    teacher: 't',
    school: 's',
    town: 'Munster',
    dayType: 1,
    fromTime: '08:00',
    toTime: '15:00',
    hours: 7,
    ...o,
  };
}

const toLocalISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('constants', () => {
  it('match legacy exactly', () => {
    expect(PAY_RULES_V1.teacherFullDayRate).toBe(legacy.TEACHER_FULL_DAY_RATE);
    expect(PAY_RULES_V1.aideFullDayEstimate).toBe(legacy.AIDE_FULL_DAY_ESTIMATE);
    expect(PAY_RULES_V1.standardFullDayHours).toBe(legacy.STANDARD_FULL_DAY_HOURS);
    expect(PAY_RULES_V1.aideHourlyRate).toBe(legacy.AIDE_HOURLY_RATE);
    expect(PAY_RULES_V1.permanentGrossPerDay).toBe(legacy.EVERYDAY_GROSS_PAY);
    expect(PAY_RULES_V1.permanentNetPerDay).toBe(legacy.EVERYDAY_NET_PAY);
    expect(PAY_RULES_V1.permanentDefaultSchool).toBe(legacy.EVERYDAY_DEFAULT_SCHOOL);
    expect(PAY_RULES_V1.permanentDefaultStart).toBe(legacy.EVERYDAY_DEFAULT_START_TIME);
    expect(PAY_RULES_V1.permanentDefaultEnd).toBe(legacy.EVERYDAY_DEFAULT_END_TIME);
    expect(PAY_RULES_V1.outstandingTrackingStart).toBe(legacy.CURRENT_PAY_TRACKING_START);
  });
});

describe('expected pay: every role × employment × day type × hours × rate combination', () => {
  let compared = 0;
  for (const role of roles)
    for (const employmentType of employment)
      for (const dayType of dayTypes)
        for (const h of hours)
          for (const payRate of rates) {
            const j = job({
              role,
              employmentType,
              dayType,
              hours: h,
              ...(payRate === undefined ? {} : { payRate }),
            });
            const name = `role=${role} emp=${employmentType} day=${dayType} h=${h} rate=${payRate}`;
            it(name, () => {
              const result = expectedPay({
                role: role === 'aide' ? 'aide' : 'teacher',
                employmentType: employmentType === 'everyday' ? 'permanent' : 'regular',
                dayType,
                hours: h,
                ...(payRate === undefined ? {} : { payRate }),
              });
              expect(result.netCents).toBe(centsFromDollars(legacy.calculateExpectedPay(j)));
              expect(result.grossCents).toBe(centsFromDollars(legacy.calculateExpectedGrossPay(j)));
            });
            compared++;
          }
  it('covered the full grid', () => expect(compared).toBe(3 * 3 * 2 * 6 * 7));
});

describe('calendar logic across 2024-01-01 … 2027-12-31', () => {
  const days: string[] = [];
  for (let d = '2024-01-01'; d <= '2027-12-31'; d = addDays(d, 1)) days.push(d);

  it('school-year keys are identical to legacy for every date', () => {
    for (const d of days) expect(schoolYearKey(d)).toBe(legacy.getSchoolYearKey(d));
  });

  it('weekday employment defaults match legacy Mon–Fri (weekends intentionally have no default)', () => {
    for (const d of days) {
      const wd = weekday(d);
      if (wd === 0 || wd === 6) {
        expect(defaultsFor(d)).toBeNull();
        continue;
      }
      const legacyType = legacy.getDefaultEmploymentTypeForDate(d) === 'everyday' ? 'permanent' : 'regular';
      expect(defaultsFor(d)?.employmentType).toBe(legacyType);
    }
  });

  it('new periods are well-formed: Monday start, 14 days, contain the date, aligned to the anchor', () => {
    for (const d of days) {
      const p = payPeriodFor(d);
      expect(weekday(p.start)).toBe(1);
      expect(toDayNumber(p.end) - toDayNumber(p.start)).toBe(13);
      expect(p.start <= d && d <= p.end).toBe(true);
      expect((toDayNumber(p.start) - toDayNumber('2024-01-01')) % 14).toBe(0);
      expect(weekday(p.expectedPayday)).toBe(5); // a Friday
    }
  });

  it('differs from legacy ONLY on period-start Mondays during DST (the documented defect)', () => {
    const differing = days.filter(
      (d) => toLocalISO(legacy.getBiweeklyPeriodStart(d)) !== payPeriodFor(d).start,
    );
    expect(differing.length).toBeGreaterThan(0);
    for (const d of differing) {
      expect(payPeriodFor(d).start).toBe(d); // a period's first day…
      const month = Number(d.slice(5, 7));
      expect(month >= 3 && month <= 11).toBe(true); // …inside the DST season
      // legacy put it in the previous period
      expect(toLocalISO(legacy.getBiweeklyPeriodStart(d))).toBe(addDays(d, -14));
    }
    // Phase 1 verified examples
    expect(differing).toEqual(expect.arrayContaining(['2026-08-24', '2026-09-07', '2026-10-19']));
    expect(differing).not.toContain('2026-11-02');
    expect(differing).not.toContain('2026-11-16');
  });
});
