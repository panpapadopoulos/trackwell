import { centsFromDollars, type Cents } from '../money';
import type { Role, WorkDay } from '../work/types';
import { PAY_RULES_V1, type PayRules } from './rules';

/**
 * Fields that determine pay. Deliberately excludes `coverage`, `format`,
 * `status` and everything else, so a Multiple Coverage day can't be paid more
 * than once: the type system won't even hand coverage to the calculator.
 */
export type PayInputs = Pick<WorkDay, 'employmentType' | 'role' | 'dayType' | 'hours' | 'payRate'>;

export type PayBasis = 'permanent-flat' | 'teacher-day-fraction' | 'aide-hourly';

export interface PayResult {
  netCents: Cents;
  grossCents: Cents;
  basis: PayBasis;
  /** Effective rate used ($/day for teacher, $/hour for aide, $/day flat for permanent). */
  rate: number;
  rulesVersion: string;
}

export function defaultRate(role: Role, rules: PayRules = PAY_RULES_V1): number {
  return role === 'aide' ? rules.aideHourlyRate : rules.teacherFullDayRate;
}

/**
 * Expected pay for ONE work day. Identical to legacy `calculateExpectedPay` /
 * `calculateExpectedGrossPay`:
 *  1. permanent (legacy "everyday") ⇒ flat net/gross per day; role, day type, hours, rate ignored
 *  2. otherwise rate = payRate || default(role)   (a falsy rate, including 0, falls back)
 *     - assistant ⇒ round2(hours × rate)
 *     - teacher   ⇒ round2(dayType × rate)
 *  Gross equals net for regular work (legacy had no separate gross figure).
 */
export function expectedPay(day: PayInputs, rules: PayRules = PAY_RULES_V1): PayResult {
  if (day.employmentType === 'permanent') {
    return {
      netCents: centsFromDollars(rules.permanentNetPerDay),
      grossCents: centsFromDollars(rules.permanentGrossPerDay),
      basis: 'permanent-flat',
      rate: rules.permanentNetPerDay,
      rulesVersion: rules.version,
    };
  }
  const rate = day.payRate || defaultRate(day.role, rules);
  const dollars =
    day.role === 'aide' ? Number((day.hours * rate).toFixed(2)) : Number((day.dayType * rate).toFixed(2));
  const cents = centsFromDollars(dollars);
  return {
    netCents: cents,
    grossCents: cents,
    basis: day.role === 'aide' ? 'aide-hourly' : 'teacher-day-fraction',
    rate,
    rulesVersion: rules.version,
  };
}

/** Hours between HH:MM times, wrapping past midnight, rounded to 2 dp (legacy form behavior). */
export function hoursBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number) as [number, number];
  const [eh, em] = end.split(':').map(Number) as [number, number];
  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes < 0) minutes += 24 * 60;
  return Number((minutes / 60).toFixed(2));
}
