/**
 * Deterministic interpretation of the words a model (or the user) passes to the
 * assistant's tools. The model never does date arithmetic or period mapping:
 * it forwards words, and these functions decide.
 */
import {
  addDays,
  addMonths,
  formatLong,
  formatMonthKey,
  isISODate,
  monthRange,
  weekday,
  type ISODate,
} from '../dates';
import { schoolYearKey, schoolYearLabel, schoolYearRange } from '../schoolYear';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** "today", "yesterday", "monday"/"last monday" (most recent, today included), or YYYY-MM-DD. */
export function resolveDateWords(words: string | undefined, today: ISODate): ISODate | null {
  const w = (words ?? 'today')
    .trim()
    .toLowerCase()
    .replace(/^on\s+/, '')
    .replace(/[.!?]$/, '');
  if (!w || w === 'today' || w === 'this morning' || w === 'tonight') return today;
  if (w === 'yesterday') return addDays(today, -1);
  if (isISODate(w)) return w;
  const m = /^(last\s+|this\s+|past\s+)?([a-z]+)$/.exec(w);
  if (m) {
    const idx = WEEKDAYS.indexOf(m[2]!);
    if (idx >= 0) {
      let back = (weekday(today) - idx + 7) % 7;
      if (back === 0 && m[1]?.startsWith('last')) back = 7;
      return addDays(today, -back);
    }
  }
  return null;
}

export const WEEKDAY_NAME = (d: ISODate) => WEEKDAYS[weekday(d)]!.replace(/^./, (c) => c.toUpperCase());

const ORDINALS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
};

/**
 * "1", 1, "P1", "period 1", "1st", "first", "first period" → "P1".
 * "PLC", "PD", "tutorial" → their schedule ids. Unknown → null.
 */
export function normalizePeriod(token: string | number): string | null {
  const t = String(token)
    .trim()
    .toLowerCase()
    .replace(/\bperiods?\b/g, '')
    .replace(/\s+/g, '');
  if (!t) return null;
  if (t === 'plc') return 'PLC';
  if (t === 'pd' || t === 'professionaldevelopment') return 'PD';
  if (t === 'tut' || t === 'tutorial') return 'TUT';
  const num = /^p?(\d{1,2})(st|nd|rd|th)?$/.exec(t);
  if (num) return `P${Number(num[1])}`;
  if (ORDINALS[t]) return `P${ORDINALS[t]}`;
  return null;
}

export interface NamedRange {
  from: ISODate;
  to: ISODate;
  label: string;
}

/**
 * Finance periods: this_month, last_month, YYYY-MM, this_year, last_year, YYYY,
 * school_year, last_30_days, all. Ranges end at today at most.
 */
export function resolveRange(period: string, today: ISODate): NamedRange | null {
  const p = period
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const cap = (to: ISODate) => (to > today ? today : to);
  const month = (key: string): NamedRange => {
    const r = monthRange(key);
    return { from: r.from, to: cap(r.to), label: formatMonthKey(key, 'long') };
  };
  const thisMonth = today.slice(0, 7);
  if (p === 'this_month') return month(thisMonth);
  if (p === 'last_month') return month(addMonths(thisMonth, -1));
  if (/^\d{4}_(0[1-9]|1[0-2])$/.test(p)) {
    const key = p.replace('_', '-');
    return key > thisMonth ? null : month(key);
  }
  const year = (y: number): NamedRange | null =>
    `${y}-01-01` > today ? null : { from: `${y}-01-01`, to: cap(`${y}-12-31`), label: String(y) };
  if (p === 'this_year') return year(Number(today.slice(0, 4)));
  if (p === 'last_year') return year(Number(today.slice(0, 4)) - 1);
  if (/^\d{4}$/.test(p)) return year(Number(p));
  if (p === 'school_year') {
    const key = schoolYearKey(today);
    return { from: schoolYearRange(key).from, to: today, label: `the ${schoolYearLabel(key)} school year` };
  }
  if (p === 'last_30_days')
    return { from: addDays(today, -29), to: today, label: `the last 30 days (to ${formatLong(today)})` };
  if (p === 'all' || p === 'all_time') return { from: '1900-01-01', to: today, label: 'all time' };
  return null;
}
