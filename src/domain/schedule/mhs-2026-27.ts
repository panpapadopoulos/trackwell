import type { BellSchedule, SchedulePeriod } from './types';

/**
 * Munster High School, 2026–27. Transcribed from the official image:
 *   https://resources.finalsite.net/images/f_auto,q_auto,t_image_size_4/v1785769684/munsterus/xg7ygolz5n4ysuenrwxz/2026-27BellSchedule_1.png
 *   local copy: ../references/mhs-bell-schedule-2026-27.png (sha256 98f12067faad9ff0…, 1200×870)
 *
 * Every time is exactly as printed (converted to 24-hour HH:MM). Printed quirks
 * are kept, not "corrected":
 *  - Traditional: Lunch A starts 11:29, the same minute Period 4 ends (no passing time).
 *  - A Block: on Lunch C, Class 5 ends 12:39 and Lunch C starts 12:43 (4-minute gap).
 * Periods without a lunch variant apply to everyone; "Class (n)" in the image is a
 * class period split around a lunch, modelled with `splitOf`.
 */
export const MHS = 'Munster High School';
export const MHS_SOURCE = 'Official MHS 2026–27 bell schedule image (finalsite), transcribed 2026-11-18';

const p = (
  id: string,
  label: string,
  kind: SchedulePeriod['kind'],
  start: string,
  end: string,
  extra: Partial<SchedulePeriod> = {},
): SchedulePeriod => ({ id, label, kind, start, end, ...extra });

export const MHS_TRADITIONAL: BellSchedule = {
  id: 'mhs-2026-27-traditional',
  schoolName: MHS,
  schoolYear: '2026-27',
  name: 'Traditional',
  status: 'verified',
  source: MHS_SOURCE,
  lunchVariants: ['A', 'B', 'C'],
  periods: [
    p('PLC', 'PLC', 'plc', '07:15', '07:55'),
    p('P1', 'Period 1', 'class', '08:00', '08:47'),
    p('P2', 'Period 2', 'class', '08:54', '09:41'),
    p('P3', 'Period 3', 'class', '09:48', '10:35'),
    p('P4', 'Period 4', 'class', '10:42', '11:29'),
    p('LUNCH-A', 'Lunch A', 'lunch', '11:29', '11:59', { lunchVariant: 'A' }),
    p('P5-A', 'Period 5', 'class', '12:04', '13:02', { lunchVariant: 'A', splitOf: 'P5' }),
    p('P5a-B', 'Period 5 (before lunch)', 'class', '11:36', '12:01', { lunchVariant: 'B', splitOf: 'P5' }),
    p('LUNCH-B', 'Lunch B', 'lunch', '12:01', '12:31', { lunchVariant: 'B' }),
    p('P5b-B', 'Period 5 (after lunch)', 'class', '12:36', '13:02', { lunchVariant: 'B', splitOf: 'P5' }),
    p('P5-C', 'Period 5', 'class', '11:36', '12:32', { lunchVariant: 'C', splitOf: 'P5' }),
    p('LUNCH-C', 'Lunch C', 'lunch', '12:32', '13:02', { lunchVariant: 'C' }),
    p('P6', 'Period 6', 'class', '13:09', '13:56'),
    p('P7', 'Period 7', 'class', '14:03', '14:50'),
  ],
};

export const MHS_A_BLOCK: BellSchedule = {
  id: 'mhs-2026-27-a-block',
  schoolName: MHS,
  schoolYear: '2026-27',
  name: 'A Block',
  status: 'verified',
  source: MHS_SOURCE,
  lunchVariants: ['A', 'B', 'C'],
  periods: [
    p('PLC', 'PLC', 'plc', '07:15', '07:55'),
    p('P1', 'Period 1', 'class', '08:00', '09:29'),
    p('P3', 'Period 3', 'class', '09:36', '11:06'),
    p('LUNCH-A', 'Lunch A', 'lunch', '11:13', '11:43', { lunchVariant: 'A' }),
    p('P5-A', 'Period 5', 'class', '11:48', '13:13', { lunchVariant: 'A', splitOf: 'P5' }),
    p('P5a-B', 'Period 5 (before lunch)', 'class', '11:13', '11:58', { lunchVariant: 'B', splitOf: 'P5' }),
    p('LUNCH-B', 'Lunch B', 'lunch', '11:58', '12:28', { lunchVariant: 'B' }),
    p('P5b-B', 'Period 5 (after lunch)', 'class', '12:33', '13:13', { lunchVariant: 'B', splitOf: 'P5' }),
    p('P5-C', 'Period 5', 'class', '11:13', '12:39', { lunchVariant: 'C', splitOf: 'P5' }),
    p('LUNCH-C', 'Lunch C', 'lunch', '12:43', '13:13', { lunchVariant: 'C' }),
    p('P7', 'Period 7', 'class', '13:20', '14:50'),
  ],
};

export const MHS_B_BLOCK: BellSchedule = {
  id: 'mhs-2026-27-b-block',
  schoolName: MHS,
  schoolYear: '2026-27',
  name: 'B Block',
  status: 'verified',
  source: MHS_SOURCE,
  lunchVariants: ['A', 'B', 'C'],
  periods: [
    p('PD', 'PD', 'pd', '07:15', '08:15'),
    p('P2', 'Period 2', 'class', '08:20', '09:55'),
    p('TUT', 'Tutorial', 'tutorial', '10:02', '10:52'),
    p('LUNCH-A', 'Lunch A', 'lunch', '10:59', '11:29', { lunchVariant: 'A' }),
    p('P4-A', 'Period 4', 'class', '11:34', '13:08', { lunchVariant: 'A', splitOf: 'P4' }),
    p('P4a-B', 'Period 4 (before lunch)', 'class', '10:59', '11:46', { lunchVariant: 'B', splitOf: 'P4' }),
    p('LUNCH-B', 'Lunch B', 'lunch', '11:46', '12:16', { lunchVariant: 'B' }),
    p('P4b-B', 'Period 4 (after lunch)', 'class', '12:21', '13:08', { lunchVariant: 'B', splitOf: 'P4' }),
    p('P4-C', 'Period 4', 'class', '10:59', '12:38', { lunchVariant: 'C', splitOf: 'P4' }),
    p('LUNCH-C', 'Lunch C', 'lunch', '12:38', '13:08', { lunchVariant: 'C' }),
    p('P6', 'Period 6', 'class', '13:15', '14:50'),
  ],
};
