import { addDays, weekday, type ISODate } from '../dates';
import { PAY_RULES_V1 } from '../pay/rules';
import type { EmploymentType, WorkDay } from './types';

export interface WeekdayDefault {
  employmentType: EmploymentType;
  /** null ⇒ chosen per assignment. */
  schoolName: string | null;
  district: string | null;
}

/**
 * The user's default week. DEFAULTS ONLY: they pre-fill forms and produce
 * `planned` projections; they never create a worked day.
 * Index 1 = Monday … 5 = Friday.
 */
export type WeeklyDefaults = Partial<Record<1 | 2 | 3 | 4 | 5, WeekdayDefault>>;

export const DEFAULT_WEEK: WeeklyDefaults = {
  1: { employmentType: 'permanent', schoolName: PAY_RULES_V1.permanentDefaultSchool, district: 'Munster' },
  2: { employmentType: 'regular', schoolName: null, district: null },
  3: { employmentType: 'permanent', schoolName: PAY_RULES_V1.permanentDefaultSchool, district: 'Munster' },
  4: { employmentType: 'regular', schoolName: null, district: null },
  5: { employmentType: 'permanent', schoolName: PAY_RULES_V1.permanentDefaultSchool, district: 'Munster' },
};

/** Weekends have no default. Legacy `getDefaultEmploymentTypeForDate` returned 'regular' there. */
export function defaultsFor(date: ISODate, week: WeeklyDefaults = DEFAULT_WEEK): WeekdayDefault | null {
  const wd = weekday(date);
  return wd >= 1 && wd <= 5 ? (week[wd as 1 | 2 | 3 | 4 | 5] ?? null) : null;
}

/**
 * Planned (projected) days for dates in [from, to] that have no saved work day.
 * Returned objects are status 'planned'. They're never persisted automatically
 * and never counted as worked or earned.
 */
export function plannedDays(
  from: ISODate,
  to: ISODate,
  existing: readonly Pick<WorkDay, 'date'>[],
  week: WeeklyDefaults = DEFAULT_WEEK,
): WorkDay[] {
  const taken = new Set(existing.map((d) => d.date));
  const out: WorkDay[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const def = defaultsFor(d, week);
    if (!def || taken.has(d)) continue;
    const permanent = def.employmentType === 'permanent';
    out.push({
      id: `planned-${d}`,
      date: d,
      status: 'planned',
      employmentType: def.employmentType,
      role: 'teacher',
      format: 'single',
      schoolName: def.schoolName ?? '',
      district: def.district ?? '',
      dayType: 1,
      startTime: permanent ? PAY_RULES_V1.permanentDefaultStart : '08:00',
      endTime: permanent ? PAY_RULES_V1.permanentDefaultEnd : '15:00',
      hours: permanent ? 7.58 : 7,
      coverage: [],
    });
  }
  return out;
}
