// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from './router';
import { ThemeProvider } from './providers/theme';
import { DataProvider, type DatasetChoice } from './providers/data';
import { count } from '@/domain/plural';

// Recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(cleanup);

/** Renders a route and waits for its lazily loaded page to replace the Suspense fallback. */
async function renderAt(path: string, data: DatasetChoice = 'synthetic') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <ThemeProvider>
      <DataProvider initial={data} today="2026-11-18">
        <RouterProvider router={router} />
      </DataProvider>
    </ThemeProvider>,
  );
  await waitFor(() => expect(document.querySelector('[role="status"][aria-label^="Loading"]')).toBeNull(), {
    timeout: 5000,
  });
  return view;
}

describe('app shell', () => {
  it('renders the Overview with one h1, labeled navigation and a skip link', async () => {
    await renderAt('/');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Overview');
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(screen.getByText('Skip to content')).toBeTruthy();
  });

  it('labels synthetic data visibly', async () => {
    await renderAt('/');
    expect(screen.getAllByText('Synthetic data').length).toBeGreaterThan(0);
  });

  it('the assistant is off on demo data (it only works on the real records, through the server)', async () => {
    await renderAt('/assistant');
    expect(screen.getByText(/off while demo data is shown/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Draft the work day/ })).toBeNull();
  });
});

describe('money states', () => {
  it('a load failure shows an error in each block, never zero amounts (legacy defect D1)', async () => {
    await renderAt('/', 'error');
    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0]!.textContent).toMatch(/Nothing was changed or saved/);
    expect(screen.queryByText('$0.00')).toBeNull();
  });

  it('loading shows skeletons marked busy, not numbers', async () => {
    await renderAt('/', 'loading');
    expect(document.querySelectorAll('[aria-busy="true"]').length).toBeGreaterThan(0);
    expect(screen.queryByText(/\$\d/)).toBeNull();
  });

  it('empty data shows real zeros and teaching empty states', async () => {
    await renderAt('/', 'empty');
    expect(screen.getByText(/No income or expenses recorded/)).toBeTruthy();
    expect(screen.getByText('0 payments · all time')).toBeTruthy();
  });

  it('expected money is announced as expected, not received', async () => {
    await renderAt('/');
    const strip = screen.getByRole('region', { name: 'Money summary' });
    expect(within(strip).getByText(/expected, not yet received/)).toBeTruthy();
    expect(within(strip).getByText('Net cash flow')).toBeTruthy();
    expect(within(strip).queryByText(/balance/i)?.textContent).toMatch(/not a balance/);
  });

  it('a single record pluralizes correctly (break-ui "One" state)', async () => {
    await renderAt('/', 'one');
    expect(screen.getByText('1 payment · all time')).toBeTruthy();
    expect(screen.getByText('1 transaction · all time')).toBeTruthy();
  });
});

describe('pages', () => {
  it('SubTrack keeps every legacy statistic', async () => {
    await renderAt('/subtrack');
    for (const label of [
      'Teacher jobs',
      'Assistant jobs',
      'Full / half days',
      'Top classes',
      'Biweekly expected pay',
      'Recent assignments',
    ])
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });

  it('Expenses shows budget, remaining and recurring, and no bank balances', async () => {
    await renderAt('/expenses');
    expect(screen.getByText('Budget vs actual')).toBeTruthy();
    expect(screen.getByText('Recurring calendar')).toBeTruthy();
    expect(screen.queryByText(/account balance|total balance/i)).toBeNull();
  });

  it('Daily schedule shows the verified MHS times for the date', async () => {
    await renderAt('/subtrack/schedule');
    expect(screen.getAllByText('A Block').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/07:15/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Times pending')).toBeNull();
  });
});

describe('count()', () => {
  it('pluralizes and groups', () => {
    expect(count(1, 'payment')).toBe('1 payment');
    expect(count(0, 'payment')).toBe('0 payments');
    expect(count(1284, 'member')).toBe('1,284 members');
  });
});
