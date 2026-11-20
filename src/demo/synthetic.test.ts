import { describe, expect, it } from 'vitest';
import { emptyDataset, syntheticDataset, worstCaseDataset } from './synthetic';
import { expectedPay } from '../domain/pay/engine';
import { payPeriodFor } from '../domain/pay/periods';
import { summarizeWork } from '../domain/work/summary';
import { summarizeOverview } from '../domain/overview';

const TODAY = '2026-11-18';

describe('synthetic dataset', () => {
  const ds = syntheticDataset(TODAY);

  it('is deterministic', () => {
    expect(JSON.stringify(syntheticDataset(TODAY))).toBe(JSON.stringify(ds));
  });

  it('is labeled synthetic and contains no future worked days', () => {
    expect(ds.kind).toBe('synthetic');
    expect(ds.work.days.every((d) => d.source?.system === 'synthetic')).toBe(true);
    expect(ds.work.days.every((d) => d.date < TODAY)).toBe(true);
  });

  it('never has two paid permanent days on one date', () => {
    const dates = ds.work.days.filter((d) => d.employmentType === 'permanent').map((d) => d.date);
    expect(new Set(dates).size).toBe(dates.length);
  });

  it('payments reconcile: each paid period received what the engine expected (minus small deductions)', () => {
    const byPeriod = new Map<string, number>();
    for (const d of ds.work.days) {
      const k = `${payPeriodFor(d.date).start}|${d.district}`;
      byPeriod.set(k, (byPeriod.get(k) ?? 0) + expectedPay(d).netCents);
    }
    for (const p of ds.work.payments) {
      const expected = byPeriod.get(p.id.replace('pay-', ''))!;
      expect(p.amountCents).toBeLessThanOrEqual(expected);
      expect(expected - p.amountCents).toBeLessThanOrEqual(1500);
    }
  });

  it('exercises every UI state: multiple coverage, awaiting and upcoming paydays, budgets', () => {
    const s = summarizeWork(ds.work.days, ds.work.payments, { range: {} }, TODAY);
    expect(s.multipleCoverageDays).toBeGreaterThan(5);
    expect(s.periods.some((p) => p.status === 'awaiting')).toBe(true);
    expect(s.nextPaycheck).not.toBeNull();
    expect(s.aideJobs).toBeGreaterThan(0);
    expect(s.halfDays).toBeGreaterThan(0);
    const o = summarizeOverview(ds.work, ds.expenses, {}, TODAY);
    expect(o.receivedCents).toBeGreaterThan(0);
    expect(o.netCashFlowCents).toBe(o.receivedCents - o.expensesCents);
    expect(o.upcomingRecurring.length).toBeGreaterThan(0);
  });

  it('empty and worst-case variants are well-formed', () => {
    const e = emptyDataset();
    const s = summarizeWork(e.work.days, e.work.payments, { range: {} }, TODAY);
    expect(s.assignments).toBe(0);
    expect(s.nextPaycheck).toBeNull();
    const w = worstCaseDataset(TODAY);
    expect(w.expenses.expenses.length).toBeGreaterThan(3000);
  });
});
