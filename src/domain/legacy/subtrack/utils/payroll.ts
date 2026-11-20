import { Job } from '../types';

export const TEACHER_FULL_DAY_RATE = 105.48;
export const AIDE_FULL_DAY_ESTIMATE = 88.99;
export const STANDARD_FULL_DAY_HOURS = 7;
export const AIDE_HOURLY_RATE = Number((AIDE_FULL_DAY_ESTIMATE / STANDARD_FULL_DAY_HOURS).toFixed(2));

// Everyday/Permanent Substitute (Mon/Wed/Fri) flat per-day pay
export const EVERYDAY_GROSS_PAY = 130;
export const EVERYDAY_NET_PAY = 114.27;

// Everyday Substitute normally works only at this school, on this schedule
export const EVERYDAY_DEFAULT_SCHOOL = 'Munster High School';
export const EVERYDAY_DEFAULT_START_TIME = '07:15';
export const EVERYDAY_DEFAULT_END_TIME = '14:50';

// Assignments before this date are already settled from the prior arrangement;
// "still expected / outstanding" tracking starts fresh from here for 2026-27.
export const CURRENT_PAY_TRACKING_START = '2026-08-01';

export function isCurrentPayTrackingDate(dateStr: string): boolean {
  return dateStr >= CURRENT_PAY_TRACKING_START;
}

export function getJobRole(job: Pick<Job, 'role'>): 'teacher' | 'aide' {
  return job.role === 'aide' ? 'aide' : 'teacher';
}

export function getRoleLabel(job: Pick<Job, 'role'>): string {
  return getJobRole(job) === 'aide' ? 'Instructional Assistant' : 'Teacher Sub';
}

export function getDefaultPayRate(role: 'teacher' | 'aide'): number {
  return role === 'aide' ? AIDE_HOURLY_RATE : TEACHER_FULL_DAY_RATE;
}

// undefined employmentType means 'regular' for backward compatibility with existing jobs
export function getEmploymentType(job: Pick<Job, 'employmentType'>): 'regular' | 'everyday' {
  return job.employmentType === 'everyday' ? 'everyday' : 'regular';
}

export function getEmploymentTypeLabel(job: Pick<Job, 'employmentType'>): string {
  return getEmploymentType(job) === 'everyday' ? 'Everyday Sub' : 'Regular Sub';
}

export function getDefaultEmploymentTypeForDate(dateStr: string): 'regular' | 'everyday' {
  const day = toLocalDate(dateStr).getDay(); // 0=Sun, 1=Mon, ... 6=Sat
  return (day === 1 || day === 3 || day === 5) ? 'everyday' : 'regular';
}

export function calculateExpectedPay(job: Job): number {
  if (getEmploymentType(job) === 'everyday') {
    return EVERYDAY_NET_PAY;
  }

  const role = getJobRole(job);
  const rate = job.payRate || getDefaultPayRate(role);

  if (role === 'aide') {
    return Number((job.hours * rate).toFixed(2));
  }

  return Number((job.dayType * rate).toFixed(2));
}

// Gross pay is only distinct from expected (net) pay for Everyday Sub jobs;
// regular jobs have no separate gross figure in the existing payroll logic.
export function calculateExpectedGrossPay(job: Job): number {
  if (getEmploymentType(job) === 'everyday') {
    return EVERYDAY_GROSS_PAY;
  }
  return calculateExpectedPay(job);
}

export function formatCurrency(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function toLocalDate(dateStr: string): Date {
  const d = new Date(dateStr);
  return new Date(d.getTime() + d.getTimezoneOffset() * 60000);
}

export function getBiweeklyPeriodStart(dateStr: string): Date {
  const date = toLocalDate(dateStr);
  const anchor = new Date(2024, 0, 1);
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor((date.getTime() - anchor.getTime()) / dayMs);
  const periodOffset = Math.floor(diffDays / 14) * 14;
  return new Date(anchor.getTime() + periodOffset * dayMs);
}

export function getBiweeklyPeriodLabel(dateStr: string): string {
  const start = getBiweeklyPeriodStart(dateStr);
  const end = new Date(start);
  end.setDate(start.getDate() + 13);

  const format = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${format(start)} - ${format(end)}`;
}

// School year runs Aug 1 - Jul 31. Key format: "2025-26" (start year - end year short).
function schoolYearKeyForDate(date: Date): string {
  const startYear = date.getMonth() >= 7 ? date.getFullYear() : date.getFullYear() - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

export function getSchoolYearKey(dateStr: string): string {
  return schoolYearKeyForDate(toLocalDate(dateStr));
}

export function getCurrentSchoolYearKey(): string {
  return schoolYearKeyForDate(new Date());
}

export function getSchoolYearLabel(key: string): string {
  return key;
}

export function getSchoolYearRange(key: string): { start: Date; end: Date } {
  const startYear = parseInt(key.split('-')[0], 10);
  return {
    start: new Date(startYear, 7, 1),
    end: new Date(startYear + 1, 6, 31, 23, 59, 59, 999)
  };
}

export function isDateInSchoolYear(dateStr: string, key: string): boolean {
  const { start, end } = getSchoolYearRange(key);
  const d = toLocalDate(dateStr);
  return d.getTime() >= start.getTime() && d.getTime() <= end.getTime();
}
