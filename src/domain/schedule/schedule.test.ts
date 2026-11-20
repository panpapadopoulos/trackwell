import { describe, expect, it } from 'vitest';
import { DEFAULT_REGISTRY, DEMO_SCHEDULE } from './registry';
import { periodsForLunch, resolveSchedule, validateSchedule } from './resolve';
import type { BellSchedule } from './types';

const MHS = 'Munster High School';

describe('MHS 2026–27 weekday mapping', () => {
  const week: Record<string, string> = {
    '2026-11-16': 'Traditional', // Mon
    '2026-11-17': 'Traditional', // Tue
    '2026-11-18': 'A Block', // Wed
    '2026-11-19': 'B Block', // Thu
    '2026-11-20': 'Traditional', // Fri
  };
  for (const [date, name] of Object.entries(week))
    it(`${date} → ${name}`, () =>
      expect(resolveSchedule(DEFAULT_REGISTRY, MHS, date)?.schedule.name).toBe(name));

  it('weekends and other school years have no schedule', () => {
    expect(resolveSchedule(DEFAULT_REGISTRY, MHS, '2026-11-21')).toBeNull();
    expect(resolveSchedule(DEFAULT_REGISTRY, MHS, '2027-08-16')).toBeNull();
  });

  it('manual choice and date overrides take precedence', () => {
    const reg = {
      ...DEFAULT_REGISTRY,
      overrides: [{ schoolName: MHS, date: '2026-11-18', scheduleId: 'mhs-2026-27-b-block' }],
    };
    expect(resolveSchedule(reg, MHS, '2026-11-18')).toMatchObject({
      reason: 'override',
      schedule: { name: 'B Block' },
    });
    expect(resolveSchedule(reg, MHS, '2026-11-18', 'mhs-2026-27-traditional')).toMatchObject({
      reason: 'manual',
    });
  });
});

describe('schedule validation', () => {
  it('the synthetic demo schedule is valid and lunch-specific', () => {
    expect(validateSchedule(DEMO_SCHEDULE)).toEqual([]);
    expect(periodsForLunch(DEMO_SCHEDULE, 'B').map((p) => p.id)).toEqual([
      'P1',
      'P2',
      'TUT',
      'P3',
      'P4a-B',
      'LUNCH-B',
      'P4b-B',
      'P5',
      'P6',
      'PLC',
    ]);
  });
  it('detects overlaps, bad times and duplicate ids', () => {
    const bad: BellSchedule = {
      ...DEMO_SCHEDULE,
      periods: [
        { id: 'A', label: 'A', kind: 'class', start: '08:00', end: '09:00' },
        { id: 'A', label: 'B', kind: 'class', start: '08:30', end: '09:30' },
        { id: 'C', label: 'C', kind: 'class', start: '10:00', end: '09:00' },
        { id: 'D', label: 'D', kind: 'class', start: '25:00', end: '26:00' },
      ],
    };
    const problems = validateSchedule(bad).map((i) => i.problem);
    expect(problems).toContain('duplicate id');
    expect(problems.some((p) => p.startsWith('overlaps'))).toBe(true);
    expect(problems).toContain('ends before it starts');
    expect(problems).toContain('invalid time');
  });
});
