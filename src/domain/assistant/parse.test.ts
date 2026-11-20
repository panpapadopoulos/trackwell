import { describe, expect, it } from 'vitest';
import { normalizePeriod, resolveDateWords, resolveRange } from './parse';

const WED = '2026-11-18';

describe('resolveDateWords', () => {
  it.each([
    [undefined, WED],
    ['today', WED],
    ['Yesterday', '2026-11-17'],
    ['monday', '2026-11-16'],
    ['wednesday', WED],
    ['last wednesday', '2026-11-11'],
    ['on friday', '2026-11-13'],
    ['2026-10-02', '2026-10-02'],
    ['someday', null],
    ['2026-02-30', null],
  ])('%s → %s', (w, d) => expect(resolveDateWords(w, WED)).toBe(d));
});

describe('normalizePeriod', () => {
  it.each([
    ['1', 'P1'],
    [3, 'P3'],
    ['P7', 'P7'],
    ['period 5', 'P5'],
    ['2nd', 'P2'],
    ['first', 'P1'],
    ['seventh period', 'P7'],
    ['PLC', 'PLC'],
    ['Tutorial', 'TUT'],
    ['lunch', null],
    ['', null],
  ])('%s → %s', (t, id) => expect(normalizePeriod(t)).toBe(id));
});

describe('resolveRange', () => {
  it('months, years and the school year, capped at today', () => {
    expect(resolveRange('this_month', WED)).toEqual({ from: '2026-11-01', to: WED, label: 'November 2026' });
    expect(resolveRange('last month', WED)).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
    expect(resolveRange('2026-02', WED)).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
    expect(resolveRange('2026-12', WED)).toBeNull();
    expect(resolveRange('this_year', WED)).toMatchObject({ from: '2026-01-01', to: WED });
    expect(resolveRange('2025', WED)).toMatchObject({ from: '2025-01-01', to: '2025-12-31' });
    expect(resolveRange('school_year', WED)).toMatchObject({ from: '2026-08-01', to: WED });
    expect(resolveRange('last_30_days', WED)).toMatchObject({ from: '2026-10-20', to: WED });
    expect(resolveRange('all', WED)).toMatchObject({ to: WED });
    expect(resolveRange('next week', WED)).toBeNull();
  });
});
