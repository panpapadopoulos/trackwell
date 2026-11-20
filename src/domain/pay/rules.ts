import type { ISODate } from '../dates';

/**
 * Pay rules v1 = the exact constants of legacy SubTrack `utils/payroll.ts`
 * (subtrack@def1e6a). Versioned so a future rate change never rewrites history:
 * records keep their own `payRate` snapshot, and a new version would apply by date.
 */
export interface PayRules {
  version: string;
  teacherFullDayRate: number;
  aideFullDayEstimate: number;
  standardFullDayHours: number;
  /** Rounded to cents first, as in legacy (12.71), so an assistant full day is 88.97, not 88.99. */
  aideHourlyRate: number;
  permanentGrossPerDay: number;
  permanentNetPerDay: number;
  permanentDefaultSchool: string;
  permanentDefaultStart: string;
  permanentDefaultEnd: string;
  /** Work before this date was settled under the prior arrangement and is excluded from "outstanding". */
  outstandingTrackingStart: ISODate;
}

export const PAY_RULES_V1: PayRules = {
  version: 'subtrack-legacy-v1',
  teacherFullDayRate: 105.48,
  aideFullDayEstimate: 88.99,
  standardFullDayHours: 7,
  aideHourlyRate: Number((88.99 / 7).toFixed(2)),
  permanentGrossPerDay: 130,
  permanentNetPerDay: 114.27,
  permanentDefaultSchool: 'Munster High School',
  permanentDefaultStart: '07:15',
  permanentDefaultEnd: '14:50',
  outstandingTrackingStart: '2026-08-01',
};

/**
 * Biweekly pay schedule. The anchor and 14-day length are legacy. The payday
 * offset (period end + 5 days = the Friday after the period's final Sunday) was
 * verified against all 40 historical payments (39 on that Friday's cycle position,
 * 29/40 amounts within 5% of the period's expected pay, 0 payments with no work
 * in the window) and confirmed by the user on 2026-11-18. It's still an estimate
 * until an actual payment record exists, and it never assumes holiday adjustments.
 */
export interface PayScheduleConfig {
  anchor: ISODate; // a Monday
  lengthDays: number;
  paydayOffsetDays: number; // from the period's last day
  /** A payment within this window around the expected payday settles the period. */
  matchWindowDays: { before: number; after: number };
  /** Manual payday per pay period (period start → payday), e.g. a holiday shift. */
  paydayOverrides?: Readonly<Record<string, ISODate>>;
}

export const PAY_SCHEDULE_V1: PayScheduleConfig = {
  anchor: '2024-01-01',
  lengthDays: 14,
  paydayOffsetDays: 5,
  matchWindowDays: { before: 3, after: 7 },
};
