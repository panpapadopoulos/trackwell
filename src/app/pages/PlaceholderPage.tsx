import { Link, useLocation } from 'react-router';
import { Panel } from '../ui/primitives';

const PLANS: Record<string, { what: string; phase: string; items: string[] }> = {
  '/subtrack/assignments': {
    what: 'Every work day you have recorded, searchable and editable.',
    phase: 'Phase 3',
    items: [
      'Search, filters and sorting',
      'Create and edit work days (single or multiple coverage)',
      'Soft delete with undo, never permanent loss',
    ],
  },
  '/subtrack/calendar': {
    what: 'A month calendar of worked, planned and paid days.',
    phase: 'Phase 3',
    items: ['Defaults shown as planned, never as worked', 'Stamped days once their pay period is paid'],
  },
  '/subtrack/payments': {
    what: 'Actual payments received, matched to their pay periods.',
    phase: 'Phase 3',
    items: [
      'Record a payment',
      'Manual link to a pay period when the date rule doesn’t match',
      'Expected vs received per period',
    ],
  },
  '/subtrack/analytics': {
    what: 'School-year comparisons and deeper work analytics.',
    phase: 'Phase 3',
    items: ['Year-over-year earnings and work days', 'Weekday and school distribution'],
  },
  '/expenses/transactions': {
    what: 'All expense transactions with full filtering.',
    phase: 'Phase 3',
    items: [
      'Add, edit, soft delete',
      'Filter by date, category, method, amount',
      'CSV import with preview and duplicate detection',
    ],
  },
  '/expenses/categories': {
    what: 'Expense categories.',
    phase: 'Phase 3',
    items: ['Rename and recolor', 'Archive instead of delete; reassign on removal'],
  },
  '/expenses/budgets': {
    what: 'Monthly and per-category budgets.',
    phase: 'Phase 3',
    items: ['Every-month and month-specific budgets', 'Budget vs actual history'],
  },
  '/expenses/recurring': {
    what: 'Subscriptions and installment plans.',
    phase: 'Phase 3',
    items: ['Monthly and yearly plans, ongoing or fixed count', 'Deleted occurrences stay deleted'],
  },
  '/expenses/analytics': {
    what: 'Spending trends and category analysis.',
    phase: 'Phase 3',
    items: ['Trends by category', 'Year comparisons'],
  },
};

export function PlaceholderPage() {
  const { pathname } = useLocation();
  const plan = PLANS[pathname];
  if (!plan)
    return (
      <Panel title="Page not found">
        <p className="text-[0.84375rem] text-muted">
          There&rsquo;s nothing at this address.{' '}
          <Link to="/" className="text-ink underline">
            Go to the Overview
          </Link>
        </p>
      </Panel>
    );
  return (
    <Panel
      title="Not built yet"
      subtitle={`Planned for ${plan.phase}. This page is intentionally empty rather than mocked.`}
      className="max-w-[720px]"
    >
      <p className="text-[0.84375rem] text-ink">{plan.what}</p>
      <ul className="mt-3 list-disc pl-5 text-[0.84375rem] text-muted">
        {plan.items.map((i) => (
          <li key={i} className="py-0.5">
            {i}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
