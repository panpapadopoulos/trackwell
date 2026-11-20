import { periodsForLunch } from './resolve';
import type { BellSchedule, LunchVariant } from './types';

export interface ClassRow {
  /** Period id stored on coverage blocks: split periods use their class period ("P5"). */
  id: string;
  label: string;
  start: string;
  end: string;
}

/**
 * One row per class period for a lunch variant, in time order. Split periods
 * (before/after lunch) merge into their class period; lunch and passing rows are
 * dropped. The work-day editor and the assistant both use this, so a period the
 * assistant proposes is exactly a row the editor shows.
 */
export function classRows(schedule: BellSchedule, lunch?: LunchVariant): ClassRow[] {
  const rows = new Map<string, ClassRow>();
  for (const p of periodsForLunch(schedule, lunch)) {
    if (p.kind === 'lunch' || p.kind === 'passing') continue;
    const key = p.splitOf ?? p.id;
    const existing = rows.get(key);
    if (existing) existing.end = p.end;
    else
      rows.set(key, {
        id: key,
        label: p.label.replace(/ \((before|after) lunch\)$/, ''),
        start: p.start,
        end: p.end,
      });
  }
  return [...rows.values()];
}
