import { sumCents, type Cents } from './money';
import type { PeriodRow } from './work/summary';

/**
 * THE shared earnings model, used by Overview, SubTrack and Payments so no two
 * screens can disagree.
 *
 *  - Outstanding earnings = earned compensation not yet paid
 *                         = upcoming + overdue  (periods with worked days and no matching payment)
 *  - Upcoming expected paychecks = unpaid periods whose expected payday is today or later
 *  - Overdue payments = unpaid periods whose expected payday has passed
 *
 * Point-in-time: independent of the dashboard's date range. Periods that ended
 * before the 2026-08-01 tracking start are "prior arrangement" (settled under the
 * old setup) and excluded, exactly as legacy SubTrack did.
 *
 * Reconciliation limitation: a period counts as settled once ANY payment matches
 * it (by date window or explicit link). If the payment is smaller or larger than
 * expected (deductions, adjustments), the difference is reported as a VARIANCE,
 * not as outstanding money. Legacy "Still Expected" (expected since cutoff minus
 * payments since cutoff) is kept beside it as a check; the two differ by
 * exactly that variance plus unmatched payments.
 */
export interface EarningsStatus {
  outstandingCents: Cents;
  upcomingCents: Cents;
  overdueCents: Cents;
  upcoming: PeriodRow[];
  overdue: PeriodRow[];
  /** Σ (received − expected) over paid periods; negative = paid less than expected. */
  paidVarianceCents: Cents;
}

export function earningsFromPeriods(rows: readonly PeriodRow[]): EarningsStatus {
  const upcoming = rows
    .filter((r) => r.status === 'upcoming')
    .sort((a, b) => a.period.expectedPayday.localeCompare(b.period.expectedPayday));
  const overdue = rows
    .filter((r) => r.status === 'awaiting')
    .sort((a, b) => a.period.expectedPayday.localeCompare(b.period.expectedPayday));
  const upcomingCents = sumCents(upcoming.map((r) => r.expectedNetCents));
  const overdueCents = sumCents(overdue.map((r) => r.expectedNetCents));
  return {
    outstandingCents: upcomingCents + overdueCents,
    upcomingCents,
    overdueCents,
    upcoming,
    overdue,
    paidVarianceCents: sumCents(
      rows.filter((r) => r.status === 'paid').map((r) => r.receivedCents - r.expectedNetCents),
    ),
  };
}
