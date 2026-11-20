/**
 * Validates the entered MHS 2026–27 schedules against an independent,
 * row-by-row transcription of the official image, kept in the image's own
 * 12-hour format and printed row order (../references/mhs-bell-schedule-2026-27.png).
 */
import { describe, expect, it } from 'vitest';
import { MHS_A_BLOCK, MHS_B_BLOCK, MHS_TRADITIONAL } from './mhs-2026-27';
import { DEFAULT_REGISTRY } from './registry';
import { periodsForLunch, resolveSchedule, validateSchedule } from './resolve';
import type { BellSchedule } from './types';

type Row = [label: string, start: string, end: string];
// Exactly as printed, top to bottom, column by column.
const IMAGE: Record<string, Row[]> = {
  Traditional: [
    ['PLC TIME', '7:15 AM', '7:55 AM'],
    ['1', '8:00 AM', '8:47 AM'],
    ['2', '8:54 AM', '9:41 AM'],
    ['3', '9:48 AM', '10:35 AM'],
    ['4', '10:42 AM', '11:29 AM'],
    ['Lunch A', '11:29 AM', '11:59 AM'],
    ['Class 5', '12:04 PM', '1:02 PM'],
    ['Class (5)', '11:36 AM', '12:01 PM'],
    ['Lunch B', '12:01 PM', '12:31 PM'],
    ['Class (5)', '12:36 PM', '1:02 PM'],
    ['Class 5', '11:36 AM', '12:32 PM'],
    ['Lunch C', '12:32 PM', '1:02 PM'],
    ['6', '1:09 PM', '1:56 PM'],
    ['7', '2:03 PM', '2:50 PM'],
  ],
  'A Block': [
    ['PLC TIME', '7:15 AM', '7:55 AM'],
    ['1', '8:00 AM', '9:29 AM'],
    ['3', '9:36 AM', '11:06 AM'],
    ['Lunch A', '11:13 AM', '11:43 AM'],
    ['Class 5', '11:48 AM', '1:13 PM'],
    ['Class (5)', '11:13 AM', '11:58 AM'],
    ['Lunch B', '11:58 AM', '12:28 PM'],
    ['Class (5)', '12:33 PM', '1:13 PM'],
    ['Class 5', '11:13 AM', '12:39 PM'],
    ['Lunch C', '12:43 PM', '1:13 PM'],
    ['7', '1:20 PM', '2:50 PM'],
  ],
  'B Block': [
    ['PD TIME', '7:15 AM', '8:15 AM'],
    ['2', '8:20 AM', '9:55 AM'],
    ['Tutorial', '10:02 AM', '10:52 AM'],
    ['Lunch A', '10:59 AM', '11:29 AM'],
    ['Class 4', '11:34 AM', '1:08 PM'],
    ['Class (4)', '10:59 AM', '11:46 AM'],
    ['Lunch B', '11:46 AM', '12:16 PM'],
    ['Class (4)', '12:21 PM', '1:08 PM'],
    ['Class 4', '10:59 AM', '12:38 PM'],
    ['Lunch C', '12:38 PM', '1:08 PM'],
    ['6', '1:15 PM', '2:50 PM'],
  ],
};

function to24(t: string): string {
  const m = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(t);
  if (!m) throw new Error(`bad time ${t}`);
  let h = Number(m[1]) % 12;
  if (m[3] === 'PM') h += 12;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

const SCHEDULES: Array<[string, BellSchedule]> = [
  ['Traditional', MHS_TRADITIONAL],
  ['A Block', MHS_A_BLOCK],
  ['B Block', MHS_B_BLOCK],
];

describe('MHS 2026–27 matches the official image row by row', () => {
  for (const [name, schedule] of SCHEDULES) {
    it(`${name}: every start/end time equals the printed value, in printed order`, () => {
      const printed = IMAGE[name]!;
      expect(schedule.periods).toHaveLength(printed.length);
      schedule.periods.forEach((period, i) => {
        const [label, start, end] = printed[i]!;
        expect([period.start, period.end], `${name} row ${i + 1} (${label})`).toEqual([
          to24(start),
          to24(end),
        ]);
      });
    });
    it(`${name}: is structurally valid with A/B/C lunches`, () => {
      expect(schedule.status).toBe('verified');
      expect(validateSchedule(schedule)).toEqual([]);
      expect(schedule.lunchVariants).toEqual(['A', 'B', 'C']);
    });
  }

  it('every lunch variant yields exactly one lunch and the split class covers the same window', () => {
    for (const [, s] of SCHEDULES)
      for (const v of ['A', 'B', 'C'] as const) {
        const seq = periodsForLunch(s, v);
        expect(seq.filter((x) => x.kind === 'lunch')).toHaveLength(1);
        const split = seq.filter((x) => x.splitOf);
        expect(split.length).toBeGreaterThanOrEqual(1);
        // the split class period always ends with the lunch window (13:02 / 13:13 / 13:08)
        const windowEnd = {
          'mhs-2026-27-traditional': '13:02',
          'mhs-2026-27-a-block': '13:13',
          'mhs-2026-27-b-block': '13:08',
        }[s.id];
        expect(seq.some((x) => x.end === windowEnd)).toBe(true);
      }
  });

  it('has PLC (Traditional, A Block), PD and Tutorial (B Block) exactly where printed', () => {
    expect(MHS_TRADITIONAL.periods.filter((x) => x.kind === 'plc')).toHaveLength(1);
    expect(MHS_A_BLOCK.periods.filter((x) => x.kind === 'plc')).toHaveLength(1);
    expect(MHS_B_BLOCK.periods.filter((x) => x.kind === 'pd').map((x) => [x.start, x.end])).toEqual([
      ['07:15', '08:15'],
    ]);
    expect(MHS_B_BLOCK.periods.filter((x) => x.kind === 'tutorial').map((x) => [x.start, x.end])).toEqual([
      ['10:02', '10:52'],
    ]);
    expect(MHS_TRADITIONAL.periods.some((x) => x.kind === 'tutorial')).toBe(false);
  });

  it('every day starts 07:15 and ends 14:50 (the permanent default hours)', () => {
    for (const [, s] of SCHEDULES) {
      expect(s.periods[0]!.start).toBe('07:15');
      expect(s.periods[s.periods.length - 1]!.end).toBe('14:50');
    }
  });

  it('weekday mapping: Mon/Tue/Fri Traditional, Wed A Block, Thu B Block', () => {
    const r = (d: string) => resolveSchedule(DEFAULT_REGISTRY, 'Munster High School', d)?.schedule.name;
    expect(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'].map(r)).toEqual([
      'Traditional',
      'Traditional',
      'A Block',
      'B Block',
      'Traditional',
    ]);
  });
});
