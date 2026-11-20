import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { ChevronsLeft, ChevronsRight, LogOut, Menu, MoonStar, Plus, Sun, X } from 'lucide-react';
import { ALL_ITEMS, NAV, titleFor, type NavItem } from './nav';
import { TrackwellMark, TrackwellWordmark } from './Logo';
import { useTheme } from '../providers/theme';
import { useData, type PeriodKind } from '../providers/data';
import { SegmentedControl } from '../ui/SegmentedControl';
import { LoginPage } from '../pages/LoginPage';

const COLLAPSE_KEY = 'trackwell.sidebar.collapsed';

const PERIODS: { value: PeriodKind; label: string; short: string }[] = [
  { value: 'all', label: 'All time', short: 'All' },
  { value: 'schoolYear', label: 'School year', short: 'Year' },
  { value: 'month', label: 'Month', short: 'Month' },
  { value: 'last30', label: 'Last 30 days', short: '30d' },
];

/** Routes whose figures are scoped by the global period control. */
const PERIOD_SCOPED = new Set(['/', '/subtrack', '/expenses']);

function NavRow({
  item,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        [
          'group flex h-8 items-center gap-2.5 rounded-ctl px-2.5 text-[0.84375rem] outline-offset-0',
          isActive ? 'bg-raised text-ink' : 'text-muted hoverable hover:text-ink',
          collapsed ? 'justify-center px-0' : '',
        ].join(' ')
      }
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
      {collapsed ? (
        <span className="sr-only">{item.label}</span>
      ) : (
        <span className="truncate">{item.label}</span>
      )}
      {!collapsed && !item.ready && (
        <span className="ml-auto text-[0.6875rem] text-faint" aria-label="planned for a later phase">
          Soon
        </span>
      )}
    </NavLink>
  );
}

function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map((group, i) => (
        <div key={i} className={i > 0 ? 'mt-5 flex flex-col gap-0.5' : 'flex flex-col gap-0.5'}>
          {group.label &&
            (collapsed ? (
              <div className="mx-2.5 mb-1 border-t border-rule" aria-hidden="true" />
            ) : (
              <div className="px-2.5 pb-1 text-[0.75rem] text-faint">{group.label}</div>
            ))}
          {group.items.map((item) => (
            <NavRow key={item.to} item={item} collapsed={collapsed} {...(onNavigate ? { onNavigate } : {})} />
          ))}
        </div>
      ))}
    </nav>
  );
}

function ThemeButton() {
  const { resolved, setPreference } = useTheme();
  const next = resolved === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => setPreference(next)}
      className="pressable hoverable grid size-9 place-items-center rounded-ctl text-muted hover:text-ink"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {resolved === 'dark' ? <Sun size={17} strokeWidth={1.75} /> : <MoonStar size={17} strokeWidth={1.75} />}
    </button>
  );
}

function QuickActions() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) =>
      ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="pressable inline-flex h-9 items-center gap-1.5 rounded-full bg-primary-bg px-3.5 text-[0.84375rem] font-semibold text-primary-fg"
      >
        <Plus size={16} strokeWidth={2} aria-hidden="true" />
        <span className="max-sm:sr-only">New</span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Quick actions"
          className="absolute right-0 top-11 z-30 w-64 rounded-panel border border-rule-strong bg-surface p-1 shadow-[0_8px_24px_rgba(0,0,0,0.28)]"
          style={{ transformOrigin: 'top right' }}
        >
          {[
            ['/subtrack/assignments?new=1', 'Log a work day', 'Single or multiple coverage'],
            ['/subtrack/payments?new=1', 'Record a payment', 'Money that arrived'],
            ['/expenses/transactions?new=1', 'Add an expense', 'A purchase or bill'],
          ].map(([to, label, sub]) => (
            <Link
              key={to}
              role="menuitem"
              to={to!}
              onClick={() => setOpen(false)}
              className="hoverable flex flex-col rounded-ctl px-3 py-2"
            >
              <span className="text-[0.84375rem] text-ink">{label}</span>
              <span className="text-[0.75rem] text-faint">{sub}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function DataLabel() {
  const { choice } = useData();
  if (choice === 'api') return null;
  const text =
    choice === 'synthetic' || choice === 'one'
      ? 'Synthetic data'
      : choice === 'empty'
        ? 'Empty dataset'
        : choice === 'worst-case'
          ? 'Stress-test data'
          : choice === 'loading'
            ? 'Loading demo'
            : 'Error demo';
  return (
    <Link
      to="/settings#data"
      className="hidden h-6 shrink-0 items-center rounded-full bg-raised px-2.5 text-[0.75rem] text-muted hover:text-ink md:inline-flex"
      title="Trackwell is showing demonstration data, not real records. Change it in Settings."
    >
      {text}
    </Link>
  );
}

export function AppShell({ children }: { children?: ReactNode }) {
  const { pathname } = useLocation();
  const { period, setPeriod, status, live, signOut } = useData();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [sheet, setSheet] = useState(false);
  const title = titleFor(pathname);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);
  useEffect(() => {
    document.title = title === 'Overview' ? 'Trackwell' : `${title} · Trackwell`;
  }, [title]);
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSheet(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sheet]);

  // The backend enforces auth; this only decides what to render when the API says 401.
  if (status === 'signed-out') return <LoginPage />;
  const scoped = PERIOD_SCOPED.has(pathname);
  const primaryItems = ALL_ITEMS.filter((i) => i.primary);

  return (
    <div className="min-h-dvh bg-ground text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-ctl focus:bg-primary-bg focus:px-3 focus:py-2 focus:text-primary-fg"
      >
        Skip to content
      </a>

      {/* Desktop/tablet sidebar: ruled T-frame (one ground, 1px rules). */}
      <aside
        className={`fixed inset-y-0 left-0 z-20 hidden flex-col border-r border-rule bg-ground md:flex ${collapsed ? 'w-14' : 'w-[232px]'}`}
        aria-label="Sidebar"
      >
        <div
          className={`flex h-16 shrink-0 items-center border-b border-rule ${collapsed ? 'justify-center' : 'px-4'}`}
        >
          <Link to="/" aria-label="Trackwell, Overview" className="rounded-ctl">
            {collapsed ? <TrackwellMark size={26} title="Trackwell" /> : <TrackwellWordmark size={26} />}
          </Link>
        </div>
        <div className={`flex-1 overflow-y-auto py-4 ${collapsed ? 'px-2' : 'px-2.5'}`}>
          <SidebarNav collapsed={collapsed} />
        </div>
        <div className={`border-t border-rule p-2 ${collapsed ? 'flex justify-center' : ''}`}>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="pressable hoverable flex h-8 items-center gap-2 rounded-ctl px-2.5 text-[0.8125rem] text-faint hover:text-ink"
          >
            {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
            {!collapsed && 'Collapse'}
          </button>
          {live && (
            <button
              type="button"
              onClick={() => void signOut()}
              aria-label="Sign out"
              title="Sign out"
              className="pressable hoverable flex h-8 items-center gap-2 rounded-ctl px-2.5 text-[0.8125rem] text-faint hover:text-ink"
            >
              <LogOut size={16} aria-hidden="true" />
              {!collapsed && 'Sign out'}
            </button>
          )}
        </div>
      </aside>

      <div className={collapsed ? 'md:pl-14' : 'md:pl-[232px]'}>
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-rule bg-ground px-5 md:h-16 md:px-7">
          <button
            type="button"
            onClick={() => setSheet(true)}
            className="pressable hoverable -ml-1 grid size-10 place-items-center rounded-ctl text-muted md:hidden"
            aria-label="Open navigation"
            aria-expanded={sheet}
          >
            <Menu size={20} />
          </button>
          <h1 className="min-w-0 truncate text-[1.125rem] font-semibold tracking-[-0.01em] md:text-[1.25rem]">
            {title}
          </h1>
          <DataLabel />
          <div className="ml-auto flex items-center gap-2">
            {scoped && (
              <div className="hidden md:block">
                <SegmentedControl
                  label="Time period"
                  value={period}
                  onChange={setPeriod}
                  options={PERIODS.map((p) => ({ value: p.value, label: p.label, short: p.short }))}
                />
              </div>
            )}
            <ThemeButton />
            <QuickActions />
          </div>
        </header>

        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-[110rem] px-5 pb-28 pt-5 outline-none md:px-7 md:pb-12 md:pt-6"
        >
          {scoped && (
            <div className="mb-4 md:hidden">
              <SegmentedControl
                label="Time period"
                value={period}
                onChange={setPeriod}
                options={PERIODS.map((p) => ({ value: p.value, label: p.label, short: p.short }))}
              />
            </div>
          )}
          {children ?? <Outlet />}
        </main>
      </div>

      {/* Phone: bottom bar of primary destinations + a full navigation sheet. */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-rule bg-ground pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {primaryItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) =>
                `flex h-14 flex-col items-center justify-center gap-0.5 text-[0.6875rem] ${isActive ? 'text-ink' : 'text-faint'}`
              }
            >
              <Icon size={19} strokeWidth={1.75} aria-hidden="true" />
              {item.to === '/subtrack'
                ? 'SubTrack'
                : item.to === '/expenses'
                  ? 'Expenses'
                  : item.to === '/subtrack/schedule'
                    ? 'Today'
                    : item.label}
            </NavLink>
          );
        })}
        <button
          type="button"
          onClick={() => setSheet(true)}
          className="flex h-14 flex-col items-center justify-center gap-0.5 text-[0.6875rem] text-faint"
        >
          <Menu size={19} strokeWidth={1.75} aria-hidden="true" />
          More
        </button>
      </nav>

      {sheet && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            className="absolute inset-0 bg-black/55"
            aria-label="Close navigation"
            onClick={() => setSheet(false)}
          />
          <div className="sheet-in absolute inset-y-0 left-0 flex w-[84%] max-w-[320px] flex-col bg-ground">
            <div className="flex h-14 items-center justify-between border-b border-rule px-4">
              <TrackwellWordmark size={24} />
              <button
                type="button"
                onClick={() => setSheet(false)}
                className="pressable grid size-10 place-items-center rounded-ctl text-muted"
                aria-label="Close navigation"
                autoFocus
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <SidebarNav collapsed={false} onNavigate={() => setSheet(false)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
