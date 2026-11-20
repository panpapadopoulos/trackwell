import { addDays, daysBetween, formatRange, type ISODate } from '../dates';
import { PAY_SCHEDULE_V1, type PayScheduleConfig } from './rules';

export interface PayPeriod {
  /** First day (Monday). */
  start: ISODate;
  /** Last day (Sunday), inclusive. */
  end: ISODate;
  /** Expected payday: an estimate until an actual payment record exists. */
  expectedPayday: ISODate;
  /** True when the payday comes from a manual override instead of the rule. */
  overridden: boolean;
  label: string;
}

/**
 * The 14-day period containing `date`, computed with whole-calendar-day
 * arithmetic. This fixes the legacy DST defect, where period-start Mondays
 * between March and November were grouped into the previous period.
 */
export function payPeriodFor(date: ISODate, cfg: PayScheduleConfig = PAY_SCHEDULE_V1): PayPeriod {
  const offset = daysBetween(cfg.anchor, date);
  const index = Math.floor(offset / cfg.lengthDays);
  const start = addDays(cfg.anchor, index * cfg.lengthDays);
  return periodFromStart(start, cfg);
}

export function periodFromStart(start: ISODate, cfg: PayScheduleConfig = PAY_SCHEDULE_V1): PayPeriod {
  const end = addDays(start, cfg.lengthDays - 1);
  const override = cfg.paydayOverrides?.[start];
  return {
    start,
    end,
    expectedPayday: override ?? addDays(end, cfg.paydayOffsetDays),
    overridden: Boolean(override),
    label: formatRange(start, end),
  };
}

export function nextPeriod(p: PayPeriod, cfg: PayScheduleConfig = PAY_SCHEDULE_V1): PayPeriod {
  return periodFromStart(addDays(p.start, cfg.lengthDays), cfg);
}

/** Whether an actual payment date falls in the window that settles this period. */
export function paymentMatchesPeriod(
  paymentDate: ISODate,
  period: PayPeriod,
  cfg: PayScheduleConfig = PAY_SCHEDULE_V1,
): boolean {
  const d = daysBetween(period.expectedPayday, paymentDate);
  return d >= -cfg.matchWindowDays.before && d <= cfg.matchWindowDays.after;
}
