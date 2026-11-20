import type { ISODate } from '../dates';
import type { Cents } from '../money';

/** Legacy code value 'aide' is kept so migrated records need no translation. UI label: "Assistant". */
export type Role = 'teacher' | 'aide';

/** Legacy 'everyday' ⇒ 'permanent'; legacy undefined ⇒ 'regular'. */
export type EmploymentType = 'permanent' | 'regular';

/** Independent of employment type: all four combinations are valid. */
export type AssignmentFormat = 'single' | 'multiple';

/** Only 'worked' counts toward worked days and income. 'planned' is a projection from defaults. */
export type WorkDayStatus = 'worked' | 'planned' | 'cancelled';

export type DayType = 1 | 0.5;

export type CoverageStatus = 'covered' | 'free' | 'planning' | 'other';

export interface CoverageBlock {
  id: string;
  /** Period id from the day's bell schedule; absent for free-form times. */
  periodId?: string;
  /** Display label when not tied to a schedule period (e.g. "Morning"). */
  label?: string;
  startTime?: string; // HH:MM
  endTime?: string; // HH:MM
  status: CoverageStatus;
  teacherName?: string;
  room?: string;
  subject?: string;
  notes?: string;
  copiedFromBlockId?: string;
}

/**
 * The PAY UNIT. Exactly one WorkDay is paid per day of work, however many
 * teachers were covered: coverage blocks describe the day, they are never paid.
 */
export interface WorkDay {
  id: string;
  date: ISODate;
  status: WorkDayStatus;
  employmentType: EmploymentType;
  role: Role;
  format: AssignmentFormat;
  schoolName: string;
  district: string;
  dayType: DayType;
  startTime: string;
  endTime: string;
  hours: number;
  /** Rate snapshot. Absent ⇒ current default for the role (legacy behavior). */
  payRate?: number;
  /** Primary class/subject for single assignments (legacy `className`). */
  className?: string;
  /** Primary teacher for single assignments (legacy `teacher`). */
  teacherName?: string;
  scheduleId?: string;
  lunchVariant?: string;
  coverage: CoverageBlock[];
  notes?: string;
  source?: { system: 'subtrack' | 'trackwell' | 'synthetic'; legacyId?: string };
  /** Server version (epoch ms) for optimistic concurrency; absent for unsaved/synthetic records. */
  updatedAt?: number;
}

export interface IncomePayment {
  id: string;
  /** Actual date the money arrived. */
  date: ISODate;
  district: string;
  /** Net amount received. */
  amountCents: Cents;
  /** Optional explicit link to the pay period it settles (manual override of date matching). */
  payPeriodStart?: ISODate;
  source?: { system: 'subtrack' | 'trackwell' | 'synthetic'; legacyId?: string };
  /** Server version (epoch ms) for optimistic concurrency; absent for unsaved/synthetic records. */
  updatedAt?: number;
}

export const ROLE_LABEL: Record<Role, string> = { teacher: 'Teacher', aide: 'Assistant' };
export const EMPLOYMENT_LABEL: Record<EmploymentType, string> = {
  permanent: 'Permanent',
  regular: 'Regular',
};
export const FORMAT_LABEL: Record<AssignmentFormat, string> = {
  single: 'Single assignment',
  multiple: 'Multiple coverage',
};
export const COVERAGE_STATUS_LABEL: Record<CoverageStatus, string> = {
  covered: 'Covered',
  free: 'Free',
  planning: 'Planning',
  other: 'Other',
};
