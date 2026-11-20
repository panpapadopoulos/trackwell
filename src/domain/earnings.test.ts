import { describe, expect, it } from 'vitest';
import { summarizeWork } from './work/summary';
import { summarizeOverview } from './overview';
import { emptyDataset, syntheticDataset } from '../demo/synthetic';
import { PAY_SCHEDULE_V1 } from './pay/rules';
import type { IncomePayment, WorkDay } from './work/types';

const TODAY = '2026-11-18';
const day = (date: string): WorkDay => ({
  id: date,
  date,
  status: 'worked',
  employmentType: 'permanent',
  role: 'teacher',
  format: 'single',
  schoolName: 'Munster High School',
  district: 'Munster',
  dayType: 1,
  startTime: '07:15',
  endTime: '14:50',
  hours: 7.58,
  coverage: [],
});

describe('shared earnings model', () => {
  it('Overview and SubTrack report the same outstanding, upcoming and overdue figures', () => {
    const ds = syntheticDataset(TODAY);
    const w = summarizeWork(ds.work.days, ds.work.payments, { range: {} }, TODAY);
    const o = summarizeOverview(ds.work, ds.expenses, {}, TODAY);
    expect(o.expectedUnpaidCents).toBe(w.outstandingCents);
    expect(w.outstandingCents).toBe((w.upcomingCents ?? 0) + (w.overdueCents ?? 0));
    expect(w.overdueCents).toBeGreaterThan(0); // the synthetic data leaves one past payday unpaid
  });

  it('classifies by payday: overdue (past, unpaid), upcoming (future, unpaid), settled (paid)', () => {
    const days = [day('2026-10-21'), day('2026-11-04'), day('2026-11-18')]; // paydays Nov 6, Nov 20, Dec 4
    const payments: IncomePayment[] = [
      { id: 'p', date: '2026-11-06', district: 'Munster', amountCents: 11000 },
    ];
    const s = summarizeWork(days, payments, { range: {} }, '2026-11-25');
    expect(s.overdueCents).toBe(11427); // Nov 20 passed with no payment
    expect(s.upcomingCents).toBe(11427); // Dec 4
    expect(s.outstandingCents).toBe(22854);
  });

  it('a manual payday override moves a period between upcoming and overdue without touching amounts', () => {
    const days = [day('2026-11-04')]; // period Nov 2–15, rule payday Nov 20
    const cfg = { ...PAY_SCHEDULE_V1, paydayOverrides: { '2026-11-02': '2026-11-27' } };
    const before = summarizeWork(days, [], { range: {} }, '2026-11-24');
    const after = summarizeWork(days, [], { range: {} }, '2026-11-24', undefined, cfg);
    expect(before.overdueCents).toBe(11427);
    expect(after.overdueCents).toBe(0);
    expect(after.upcomingCents).toBe(11427);
    expect(after.periods[0]!.period).toMatchObject({ expectedPayday: '2026-11-27', overridden: true });
  });

  it('empty data: every earnings figure is a real zero', () => {
    const e = emptyDataset();
    const s = summarizeWork(e.work.days, e.work.payments, { range: {} }, TODAY);
    expect([s.outstandingCents, s.upcomingCents, s.overdueCents]).toEqual([0, 0, 0]);
  });
});
