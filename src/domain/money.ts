/**
 * Money is stored and summed as integer cents. Conversion from a dollar float
 * goes through `toFixed(2)`, the same rounding the legacy SubTrack payroll
 * applied per record, so every per-record value is identical to legacy and
 * totals are exact (no floating drift).
 */
export type Cents = number;

export function centsFromDollars(dollars: number): Cents {
  if (!Number.isFinite(dollars)) throw new RangeError('Amount must be finite');
  return Math.round(Number(dollars.toFixed(2)) * 100);
}

export function dollarsFromCents(cents: Cents): number {
  return cents / 100;
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usdWhole = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const usdCompact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

export interface FormatMoneyOptions {
  /** Prefix "+" on positive values (for flows/deltas). */
  signed?: boolean;
  /** Drop cents (axis labels). */
  whole?: boolean;
  /** $1.2K style (tight axis labels only, never for primary figures). */
  compact?: boolean;
}

/** Uses a true minus sign (U+2212) for negatives, so figures align and read correctly. */
export function formatMoney(cents: Cents, opts: FormatMoneyOptions = {}): string {
  const abs = Math.abs(cents) / 100;
  const f = opts.compact ? usdCompact : opts.whole ? usdWhole : usd;
  const body = f.format(abs);
  if (cents < 0) return `−${body}`;
  if (opts.signed && cents > 0) return `+${body}`;
  return body;
}
