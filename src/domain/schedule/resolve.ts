import { weekday, type ISODate } from '../dates';
import { schoolYearKey } from '../schoolYear';
import type { BellSchedule, LunchVariant, SchedulePeriod, ScheduleRegistry } from './types';

export interface ResolvedSchedule {
  schedule: BellSchedule;
  reason: 'override' | 'weekday-default' | 'manual';
}

/**
 * Which bell schedule applies at a school on a date. Precedence:
 * manual choice > date override > weekday rule for that school year > none.
 */
export function resolveSchedule(
  registry: ScheduleRegistry,
  schoolName: string,
  date: ISODate,
  manualScheduleId?: string,
): ResolvedSchedule | null {
  const byId = (id: string) => registry.schedules.find((s) => s.id === id);
  if (manualScheduleId) {
    const s = byId(manualScheduleId);
    if (s) return { schedule: s, reason: 'manual' };
  }
  const override = registry.overrides.find((o) => o.schoolName === schoolName && o.date === date);
  if (override) {
    const s = byId(override.scheduleId);
    if (s) return { schedule: s, reason: 'override' };
  }
  const wd = weekday(date);
  const sy = schoolYearKey(date);
  const rule = registry.dayRules.find(
    (r) => r.schoolName === schoolName && r.schoolYear === sy && r.weekday === wd,
  );
  const s = rule && byId(rule.scheduleId);
  return s ? { schedule: s, reason: 'weekday-default' } : null;
}

/** The periods a person on `lunch` actually experiences, in time order. */
export function periodsForLunch(schedule: BellSchedule, lunch?: LunchVariant): SchedulePeriod[] {
  return schedule.periods
    .filter((p) => !p.lunchVariant || p.lunchVariant === (lunch ?? schedule.lunchVariants[0]))
    .sort((a, b) => a.start.localeCompare(b.start));
}

export function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

export interface ScheduleIssue {
  periodId: string;
  problem: string;
}

/** Structural validation applied to every schedule definition (and to future transcriptions). */
export function validateSchedule(schedule: BellSchedule): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];
  const ids = new Set<string>();
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (const p of schedule.periods) {
    if (ids.has(p.id)) issues.push({ periodId: p.id, problem: 'duplicate id' });
    ids.add(p.id);
    if (!time.test(p.start) || !time.test(p.end)) issues.push({ periodId: p.id, problem: 'invalid time' });
    else if (minutes(p.end) <= minutes(p.start))
      issues.push({ periodId: p.id, problem: 'ends before it starts' });
    if (p.lunchVariant && !schedule.lunchVariants.includes(p.lunchVariant))
      issues.push({ periodId: p.id, problem: `unknown lunch variant ${p.lunchVariant}` });
  }
  const variants = schedule.lunchVariants.length ? schedule.lunchVariants : [undefined];
  for (const v of variants) {
    const seq = periodsForLunch(schedule, v);
    for (let i = 1; i < seq.length; i++) {
      const prev = seq[i - 1]!;
      const cur = seq[i]!;
      if (minutes(cur.start) < minutes(prev.end))
        issues.push({ periodId: cur.id, problem: `overlaps ${prev.id}${v ? ` on ${v} lunch` : ''}` });
    }
  }
  if (schedule.status !== 'pending-reference' && schedule.periods.length === 0)
    issues.push({ periodId: '-', problem: 'no periods' });
  return issues;
}
