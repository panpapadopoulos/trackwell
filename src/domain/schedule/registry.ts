import { MHS, MHS_A_BLOCK, MHS_B_BLOCK, MHS_TRADITIONAL } from './mhs-2026-27';
import type { BellSchedule, ScheduleDayRule, ScheduleRegistry } from './types';

/** Munster High School 2026–27, transcribed from the official image (see mhs-2026-27.ts). */
const SY = '2026-27';
export const MHS_2026_27: BellSchedule[] = [MHS_TRADITIONAL, MHS_A_BLOCK, MHS_B_BLOCK];

const mhsRule = (weekday: ScheduleDayRule['weekday'], scheduleId: string): ScheduleDayRule => ({
  schoolName: MHS,
  schoolYear: SY,
  weekday,
  scheduleId,
});

export const MHS_2026_27_RULES: ScheduleDayRule[] = [
  mhsRule(1, 'mhs-2026-27-traditional'),
  mhsRule(2, 'mhs-2026-27-traditional'),
  mhsRule(3, 'mhs-2026-27-a-block'),
  mhsRule(4, 'mhs-2026-27-b-block'),
  mhsRule(5, 'mhs-2026-27-traditional'),
];

/**
 * SYNTHETIC demo schedule for a fictional school, used only to build and test
 * the timetable UI (period lengths, a split period around A/B/C lunches,
 * tutorial and PLC rows). These are NOT Munster High School times.
 */
export const DEMO_SCHOOL = 'Lakeview Demo High School';
export const DEMO_SCHEDULE: BellSchedule = {
  id: 'demo-traditional',
  schoolName: DEMO_SCHOOL,
  schoolYear: SY,
  name: 'Traditional (demo)',
  status: 'synthetic',
  source: 'Synthetic: invented for UI development',
  lunchVariants: ['A', 'B', 'C'],
  periods: [
    { id: 'P1', label: 'Period 1', kind: 'class', start: '07:30', end: '08:20' },
    { id: 'P2', label: 'Period 2', kind: 'class', start: '08:25', end: '09:15' },
    { id: 'TUT', label: 'Tutorial', kind: 'tutorial', start: '09:20', end: '09:50' },
    { id: 'P3', label: 'Period 3', kind: 'class', start: '09:55', end: '10:45' },
    { id: 'LUNCH-A', label: 'A Lunch', kind: 'lunch', start: '10:50', end: '11:20', lunchVariant: 'A' },
    {
      id: 'P4a-A',
      label: 'Period 4',
      kind: 'class',
      start: '11:25',
      end: '12:45',
      lunchVariant: 'A',
      splitOf: 'P4',
    },
    {
      id: 'P4a-B',
      label: 'Period 4 (1st half)',
      kind: 'class',
      start: '10:50',
      end: '11:30',
      lunchVariant: 'B',
      splitOf: 'P4',
    },
    { id: 'LUNCH-B', label: 'B Lunch', kind: 'lunch', start: '11:35', end: '12:05', lunchVariant: 'B' },
    {
      id: 'P4b-B',
      label: 'Period 4 (2nd half)',
      kind: 'class',
      start: '12:10',
      end: '12:45',
      lunchVariant: 'B',
      splitOf: 'P4',
    },
    {
      id: 'P4a-C',
      label: 'Period 4',
      kind: 'class',
      start: '10:50',
      end: '12:10',
      lunchVariant: 'C',
      splitOf: 'P4',
    },
    { id: 'LUNCH-C', label: 'C Lunch', kind: 'lunch', start: '12:15', end: '12:45', lunchVariant: 'C' },
    { id: 'P5', label: 'Period 5', kind: 'class', start: '12:50', end: '13:40' },
    { id: 'P6', label: 'Period 6', kind: 'class', start: '13:45', end: '14:35' },
    { id: 'PLC', label: 'PLC', kind: 'plc', start: '14:40', end: '15:10' },
  ],
};

const demoRule = (weekday: ScheduleDayRule['weekday']): ScheduleDayRule => ({
  schoolName: DEMO_SCHOOL,
  schoolYear: SY,
  weekday,
  scheduleId: DEMO_SCHEDULE.id,
});

export const DEFAULT_REGISTRY: ScheduleRegistry = {
  schedules: [...MHS_2026_27, DEMO_SCHEDULE],
  dayRules: [...MHS_2026_27_RULES, demoRule(1), demoRule(2), demoRule(3), demoRule(4), demoRule(5)],
  overrides: [],
};
