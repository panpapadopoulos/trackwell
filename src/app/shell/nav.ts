import {
  Bot,
  CalendarDays,
  ChartColumn,
  Clock4,
  LayoutGrid,
  ListChecks,
  PiggyBank,
  Receipt,
  Repeat,
  Settings,
  Tags,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Built in Phase 2 (true) or an honest placeholder for a later phase. */
  ready: boolean;
  /** Shown in the phone bottom bar. */
  primary?: boolean;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  { label: null, items: [{ to: '/', label: 'Overview', icon: LayoutGrid, ready: true, primary: true }] },
  {
    label: 'SubTrack',
    items: [
      { to: '/subtrack', label: 'Dashboard', icon: ChartColumn, ready: true, primary: true },
      { to: '/subtrack/assignments', label: 'Assignments', icon: ListChecks, ready: true },
      { to: '/subtrack/calendar', label: 'Work calendar', icon: CalendarDays, ready: true },
      { to: '/subtrack/schedule', label: 'Daily schedule', icon: Clock4, ready: true, primary: true },
      { to: '/subtrack/payments', label: 'Payments', icon: Wallet, ready: true },
      { to: '/subtrack/analytics', label: 'Work analytics', icon: ChartColumn, ready: true },
    ],
  },
  {
    label: 'Expenses',
    items: [
      { to: '/expenses', label: 'Dashboard', icon: PiggyBank, ready: true, primary: true },
      { to: '/expenses/transactions', label: 'Transactions', icon: Receipt, ready: true },
      { to: '/expenses/categories', label: 'Categories', icon: Tags, ready: true },
      { to: '/expenses/budgets', label: 'Budgets', icon: PiggyBank, ready: true },
      { to: '/expenses/recurring', label: 'Recurring', icon: Repeat, ready: true },
      { to: '/expenses/analytics', label: 'Expense analytics', icon: ChartColumn, ready: true },
    ],
  },
  {
    label: null,
    items: [
      { to: '/assistant', label: 'Assistant', icon: Bot, ready: true },
      { to: '/settings', label: 'Settings', icon: Settings, ready: true },
    ],
  },
];

export const ALL_ITEMS = NAV.flatMap((g) => g.items);

export function titleFor(pathname: string): string {
  const exact = ALL_ITEMS.find((i) => i.to === pathname);
  if (exact) {
    if (exact.to === '/subtrack') return 'SubTrack';
    if (exact.to === '/expenses') return 'Expenses';
    return exact.label;
  }
  if (pathname === '/brand') return 'Brand';
  return 'Not found';
}
