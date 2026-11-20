import { addDays, monthRange, type ISODate, type MonthKey } from './dates';
import { schoolYearLabel, schoolYearRange, type SchoolYearKey } from './schoolYear';

/** Inclusive date range; an open end means unbounded. */
export interface DateRange {
  from?: ISODate;
  to?: ISODate;
}

export type PeriodPreset =
  | { kind: 'all' }
  | { kind: 'schoolYear'; key: SchoolYearKey }
  | { kind: 'calendarYear'; year: number }
  | { kind: 'month'; key: MonthKey }
  | { kind: 'last30' }
  | { kind: 'custom'; from: ISODate; to: ISODate };

export function rangeFor(preset: PeriodPreset, today: ISODate): DateRange {
  switch (preset.kind) {
    case 'all':
      return {};
    case 'schoolYear':
      return schoolYearRange(preset.key);
    case 'calendarYear':
      return { from: `${preset.year}-01-01`, to: `${preset.year}-12-31` };
    case 'month':
      return monthRange(preset.key);
    case 'last30':
      return { from: addDays(today, -29), to: today };
    case 'custom':
      return preset.from <= preset.to
        ? { from: preset.from, to: preset.to }
        : { from: preset.to, to: preset.from };
  }
}

export function inRange(date: ISODate, range: DateRange): boolean {
  return (!range.from || date >= range.from) && (!range.to || date <= range.to);
}

export function presetLabel(preset: PeriodPreset): string {
  switch (preset.kind) {
    case 'all':
      return 'All time';
    case 'schoolYear':
      return `School year ${schoolYearLabel(preset.key)}`;
    case 'calendarYear':
      return String(preset.year);
    case 'month':
      return preset.key;
    case 'last30':
      return 'Last 30 days';
    case 'custom':
      return `${preset.from} → ${preset.to}`;
  }
}
