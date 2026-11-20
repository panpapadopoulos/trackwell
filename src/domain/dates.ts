/**
 * Civil-date arithmetic on ISO `YYYY-MM-DD` strings.
 *
 * Every calculation counts whole calendar days through `Date.UTC`, so it is
 * independent of the machine's time zone and of daylight-saving transitions.
 * (The legacy biweekly code subtracted local midnights and lost an hour across
 * DST, mis-bucketing period-start Mondays. See docs/adr/0004-dst-safe-pay-periods.md.)
 */

export type ISODate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string') return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function parts(iso: ISODate): [number, number, number] {
  const m = ISO_RE.exec(iso);
  if (!m) throw new RangeError(`Not an ISO date: ${iso}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Whole days since 1970-01-01. */
export function toDayNumber(iso: ISODate): number {
  const [y, m, d] = parts(iso);
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

export function fromDayNumber(day: number): ISODate {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addDays(iso: ISODate, days: number): ISODate {
  return fromDayNumber(toDayNumber(iso) + days);
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return toDayNumber(to) - toDayNumber(from);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(iso: ISODate): number {
  return (((toDayNumber(iso) + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
}

export type MonthKey = string; // YYYY-MM

export function monthKey(iso: ISODate): MonthKey {
  return iso.slice(0, 7);
}

export function addMonths(key: MonthKey, months: number): MonthKey {
  const [y, m] = key.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function monthRange(key: MonthKey): { from: ISODate; to: ISODate } {
  const [y, m] = key.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${key}-01`, to: `${key}-${String(last).padStart(2, '0')}` };
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Today's civil date in the given IANA zone (default: the user's, America/Chicago). */
export function todayISO(now: Date = new Date(), timeZone = 'America/Chicago'): ISODate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

function asUTCDate(iso: ISODate): Date {
  return new Date(toDayNumber(iso) * MS_PER_DAY);
}

/** "Nov 16" */
export function formatShort(iso: ISODate): string {
  return fmt({ month: 'short', day: 'numeric' }).format(asUTCDate(iso));
}

/** "Nov 16, 2026" */
export function formatMedium(iso: ISODate): string {
  return fmt({ month: 'short', day: 'numeric', year: 'numeric' }).format(asUTCDate(iso));
}

/** "Monday, November 16, 2026" (screen-reader friendly). */
export function formatLong(iso: ISODate): string {
  return fmt({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(asUTCDate(iso));
}

/** "Mon" */
export function formatWeekdayShort(iso: ISODate): string {
  return fmt({ weekday: 'short' }).format(asUTCDate(iso));
}

/** "Nov '26" for a month key. */
export function formatMonthKey(key: MonthKey, style: 'short' | 'long' = 'short'): string {
  const d = asUTCDate(`${key}-01`);
  if (style === 'long') return fmt({ month: 'long', year: 'numeric' }).format(d);
  return `${fmt({ month: 'short' }).format(d)} '${key.slice(2, 4)}`;
}

/** "Nov 16 – 29" or "Oct 19 – Nov 1" */
export function formatRange(from: ISODate, to: ISODate): string {
  const sameMonth = monthKey(from) === monthKey(to);
  return sameMonth
    ? `${formatShort(from)} – ${Number(to.slice(8))}`
    : `${formatShort(from)} – ${formatShort(to)}`;
}
