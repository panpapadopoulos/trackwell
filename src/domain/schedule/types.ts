import type { ISODate } from '../dates';
import type { SchoolYearKey } from '../schoolYear';

export type PeriodKind = 'class' | 'lunch' | 'passing' | 'plc' | 'pd' | 'tutorial' | 'advisory' | 'other';

export type LunchVariant = 'A' | 'B' | 'C';

export interface SchedulePeriod {
  /** Stable id, unique within a schedule (e.g. "P1", "P4a", "LUNCH-B"). */
  id: string;
  label: string;
  kind: PeriodKind;
  start: string; // HH:MM, 24h
  end: string; // HH:MM, 24h
  /**
   * Present only on rows that differ by lunch schedule. A row without a variant
   * applies to everyone; rows with a variant apply only when that lunch is selected.
   */
  lunchVariant?: LunchVariant;
  /** For split periods around lunch: the class period this segment belongs to (e.g. "P4"). */
  splitOf?: string;
}

/**
 * A bell schedule is DATA, not component logic. Status 'pending-reference' means
 * the authoritative source (the official image) hasn't been transcribed yet. The
 * app then shows the schedule's name with no times, and never guesses them.
 */
export interface BellSchedule {
  id: string;
  schoolName: string;
  schoolYear: SchoolYearKey;
  name: string; // "Traditional", "A Block", "B Block"
  status: 'verified' | 'pending-reference' | 'synthetic';
  source: string;
  lunchVariants: LunchVariant[];
  periods: SchedulePeriod[];
}

export interface ScheduleDayRule {
  schoolName: string;
  schoolYear: SchoolYearKey;
  /** 1 = Monday … 5 = Friday. */
  weekday: 1 | 2 | 3 | 4 | 5;
  scheduleId: string;
}

/** One-off change for a specific date (late start, early release, exam day). Wins over weekday rules. */
export interface ScheduleOverride {
  schoolName: string;
  date: ISODate;
  scheduleId: string;
}

export interface ScheduleRegistry {
  schedules: BellSchedule[];
  dayRules: ScheduleDayRule[];
  overrides: ScheduleOverride[];
}
