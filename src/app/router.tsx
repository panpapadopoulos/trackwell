import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, isRouteErrorResponse, useRouteError } from 'react-router';
import { AppShell } from './shell/AppShell';
import { BlockBoundary, Panel, SkeletonLines } from './ui/primitives';
const OverviewPage = lazy(() => import('./pages/OverviewPage').then((m) => ({ default: m.OverviewPage })));
const SubtrackPage = lazy(() => import('./pages/SubtrackPage').then((m) => ({ default: m.SubtrackPage })));
const ExpensesPage = lazy(() => import('./pages/ExpensesPage').then((m) => ({ default: m.ExpensesPage })));
const SchedulePage = lazy(() => import('./pages/SchedulePage').then((m) => ({ default: m.SchedulePage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const PlaceholderPage = lazy(() =>
  import('./pages/PlaceholderPage').then((m) => ({ default: m.PlaceholderPage })),
);
const AssignmentsPage = lazy(() =>
  import('./pages/AssignmentsPage').then((m) => ({ default: m.AssignmentsPage })),
);
const PaymentsPage = lazy(() => import('./pages/PaymentsPage').then((m) => ({ default: m.PaymentsPage })));
const TransactionsPage = lazy(() =>
  import('./pages/ExpenseManagement').then((m) => ({ default: m.TransactionsPage })),
);
const CategoriesPage = lazy(() =>
  import('./pages/ExpenseManagement').then((m) => ({ default: m.CategoriesPage })),
);
const RecurringPage = lazy(() =>
  import('./pages/ExpenseManagement').then((m) => ({ default: m.RecurringPage })),
);
const BudgetsPage = lazy(() => import('./pages/ExpenseManagement').then((m) => ({ default: m.BudgetsPage })));
const CalendarPage = lazy(() => import('./pages/AnalyticsPages').then((m) => ({ default: m.CalendarPage })));
const WorkAnalyticsPage = lazy(() =>
  import('./pages/AnalyticsPages').then((m) => ({ default: m.WorkAnalyticsPage })),
);
const ExpenseAnalyticsPage = lazy(() =>
  import('./pages/AnalyticsPages').then((m) => ({ default: m.ExpenseAnalyticsPage })),
);
const AssistantPage = lazy(() => import('./pages/AssistantPage').then((m) => ({ default: m.AssistantPage })));
const BrandPage = lazy(() => import('./pages/BrandPage').then((m) => ({ default: m.BrandPage })));

function RouteError() {
  const err = useRouteError();
  const message = isRouteErrorResponse(err)
    ? `${err.status} ${err.statusText}`
    : 'Something went wrong while showing this page.';
  return (
    <AppShell>
      <Panel title="This page couldn’t be shown">
        <p role="alert" className="text-[0.84375rem] text-muted">
          {message} Nothing was changed or saved. Reload to try again.
        </p>
      </Panel>
    </AppShell>
  );
}

/** Page-level boundary: a page that fails to render shows an error, never empty numbers. */
const guard = (title: string, el: ReactNode) => (
  <BlockBoundary title={title}>
    <Suspense
      fallback={
        <div
          className="rounded-panel bg-surface p-5"
          role="status"
          aria-busy="true"
          aria-label={`Loading ${title}`}
        >
          <SkeletonLines rows={5} />
        </div>
      }
    >
      {el}
    </Suspense>
  </BlockBoundary>
);

export const routes = [
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: guard('Overview', <OverviewPage />) },
      { path: 'subtrack', element: guard('SubTrack', <SubtrackPage />) },
      { path: 'subtrack/schedule', element: guard('Daily schedule', <SchedulePage />) },
      { path: 'subtrack/assignments', element: guard('Assignments', <AssignmentsPage />) },
      { path: 'subtrack/calendar', element: guard('Work calendar', <CalendarPage />) },
      { path: 'subtrack/payments', element: guard('Payments', <PaymentsPage />) },
      { path: 'subtrack/analytics', element: guard('Work analytics', <WorkAnalyticsPage />) },
      { path: 'expenses/transactions', element: guard('Transactions', <TransactionsPage />) },
      { path: 'expenses/categories', element: guard('Categories', <CategoriesPage />) },
      { path: 'expenses/budgets', element: guard('Budgets', <BudgetsPage />) },
      { path: 'expenses/recurring', element: guard('Recurring', <RecurringPage />) },
      { path: 'expenses/analytics', element: guard('Expense analytics', <ExpenseAnalyticsPage />) },
      { path: 'expenses', element: guard('Expenses', <ExpensesPage />) },
      { path: 'assistant', element: guard('Assistant', <AssistantPage />) },
      { path: 'settings', element: guard('Settings', <SettingsPage />) },
      { path: 'brand', element: guard('Brand', <BrandPage />) },
      { path: '*', element: guard('Page', <PlaceholderPage />) },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
