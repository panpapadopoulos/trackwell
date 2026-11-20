import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const PASSWORD = readFileSync('.dev.password', 'utf8').trim();

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
}

const ROUTES = [
  '/',
  '/subtrack',
  '/subtrack/assignments',
  '/subtrack/calendar',
  '/subtrack/schedule',
  '/subtrack/payments',
  '/subtrack/analytics',
  '/expenses',
  '/expenses/transactions',
  '/expenses/categories',
  '/expenses/budgets',
  '/expenses/recurring',
  '/expenses/analytics',
  '/assistant',
  '/settings',
  '/brand',
];

test.describe('authentication', () => {
  test('wrong password is refused with a generic message; data API is closed', async ({ page, request }) => {
    expect((await request.get('/api/v1/snapshot')).status()).toBe(401);
    await page.goto('/');
    await page.getByLabel('Password').fill('definitely-not-it');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('That password isn’t right.')).toBeVisible();
  });

  test('sign in, sign out, and the session is gone', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByLabel('Password')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Password')).toBeVisible();
  });
});

for (const theme of ['dark', 'light'] as const)
  for (const width of [1440, 390])
    test(`a11y: every page, ${theme}, ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript((t) => localStorage.setItem('trackwell.theme', t), theme);
      await signIn(page);
      for (const route of ROUTES) {
        await page.goto(route);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(
          serious.map((v) => `${route}: ${v.id} × ${v.nodes.length} ${v.nodes[0]?.target.join(' ')}`),
        ).toEqual([]);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
          route,
        ).toBeLessThanOrEqual(0);
      }
    });

test.describe('workflows (real API, local D1)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page);
  });

  test('multiple coverage: create, pay once, block a duplicate day, edit, delete', async ({ page }) => {
    await page.goto('/subtrack/assignments?new=1');
    const sheet = page.getByRole('dialog', { name: /Log a work day/ });
    await sheet.getByLabel('Date').fill('2026-12-02'); // a Wednesday ⇒ Permanent @ MHS, A Block
    await sheet.getByRole('radio', { name: 'Multiple coverage' }).click();
    await expect(sheet.getByLabel('Bell schedule').locator('option').first()).toHaveText(
      'Automatic (A Block)',
    );
    await sheet.getByLabel('Period 1 status').selectOption('covered');
    await sheet.getByLabel('Period 1 teacher').fill('E2E Teacher A');
    await sheet.getByLabel('Period 1 room').fill('N161');
    await sheet.getByRole('button', { name: 'Copy Period 1 to the next period' }).click();
    await sheet.getByLabel('Period 3 teacher').fill('E2E Teacher B');
    await sheet.getByLabel('Period 7 status').selectOption('free');
    await expect(sheet.getByText('2 periods covered')).toBeVisible();
    await expect(sheet.getByText('$114.27')).toBeVisible(); // paid ONCE
    await sheet.getByRole('button', { name: 'Save work day' }).click();
    await expect(page.getByRole('status').getByText('Work day saved.')).toBeVisible();

    await page.getByLabel('Search').fill('E2E Teacher');
    await expect(page.getByText('1 work day')).toBeVisible();

    // A second permanent day on the same date is refused by the server.
    await page.goto('/subtrack/assignments?new=1');
    const dup = page.getByRole('dialog', { name: /Log a work day/ });
    await dup.getByLabel('Date').fill('2026-12-02');
    await dup.getByRole('button', { name: 'Save work day' }).click();
    await expect(dup.getByRole('alert')).toContainText('already saved for this date');
    await dup.getByRole('button', { name: 'Cancel' }).click();

    // Edit, then delete with confirmation.
    await page.getByLabel('Search').fill('E2E Teacher');
    await page.getByRole('button', { name: /Edit work day Dec 2/ }).click();
    const edit = page.getByRole('dialog', { name: /Edit work day/ });
    await edit.getByLabel('Period 3 room').fill('N204');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status').getByText('Work day updated.')).toBeVisible();
    await page.getByRole('button', { name: /Edit work day Dec 2/ }).click();
    await page
      .getByRole('dialog', { name: /Edit work day/ })
      .getByRole('button', { name: 'Delete' })
      .click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete this work day?' });
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Delete work day' }).click();
    await expect(page.getByText('No work days match these filters.')).toBeVisible();
  });

  test('class autocomplete: keyboard pick and free text persist in single and multiple coverage', async ({
    page,
  }) => {
    await page.goto('/subtrack/assignments?new=1');
    const sheet = page.getByRole('dialog', { name: /Log a work day/ });
    await sheet.getByLabel('Date').fill('2026-12-03'); // Thursday: regular, B Block at MHS
    await sheet.getByLabel('School').fill('Munster High School');
    // Single assignment: pick an earlier class with the keyboard.
    const cls = sheet.getByRole('combobox', { name: 'Class or subject' });
    await cls.focus();
    const list = sheet.getByRole('listbox', { name: /suggestions/i });
    await expect(list).toBeVisible();
    await cls.press('ArrowDown');
    const picked = (await list.getByRole('option').first().locator('span').first().textContent())!;
    await cls.press('Enter');
    await expect(cls).toHaveValue(picked);
    await sheet.getByLabel('Teacher covered').fill('E2E Class Teacher');
    await sheet.getByRole('button', { name: 'Save work day' }).click();
    await expect(page.getByRole('status').getByText('Work day saved.')).toBeVisible();

    await page.getByLabel('Search').fill('E2E Class Teacher');
    await page.getByRole('button', { name: /Edit work day Dec 3/ }).click();
    const edit = page.getByRole('dialog', { name: /Edit work day/ });
    await expect(edit.getByRole('combobox', { name: 'Class or subject' })).toHaveValue(picked);
    // Multiple coverage: a brand-new class typed freely.
    await edit.getByRole('radio', { name: 'Multiple coverage' }).click();
    await edit.getByLabel('Period 2 status').selectOption('covered');
    await edit.getByLabel('Period 2 teacher').fill('E2E Class Teacher');
    await edit.getByRole('combobox', { name: 'Period 2 subject' }).fill('E2E Robotics Lab');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status').getByText('Work day updated.')).toBeVisible();
    await page.getByRole('button', { name: /Edit work day Dec 3/ }).click();
    await expect(
      page.getByRole('dialog', { name: /Edit work day/ }).getByRole('combobox', { name: 'Period 2 subject' }),
    ).toHaveValue('E2E Robotics Lab');
  });

  test('payments: record, see it in history, delete', async ({ page }) => {
    await page.goto('/subtrack/payments?new=1');
    const sheet = page.getByRole('dialog', { name: 'Record a payment' });
    await sheet.getByLabel('Date received').fill('2026-12-04');
    await sheet.getByLabel('Amount received (net)').fill('123.45');
    await sheet.getByRole('button', { name: 'Record payment' }).click();
    await expect(page.getByRole('status').getByText('Payment recorded.')).toBeVisible();
    await page.getByRole('button', { name: /Edit payment of \$123\.45/ }).click();
    await page.getByRole('dialog', { name: 'Edit payment' }).getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete payment' }).click();
    await expect(page.getByRole('button', { name: /Edit payment of \$123\.45/ })).toHaveCount(0);
  });

  test('expenses: validation, add, search, delete', async ({ page }) => {
    await page.goto('/expenses/transactions?new=1');
    const sheet = page.getByRole('dialog', { name: 'Add an expense' });
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet.getByText('Required')).toBeVisible();
    await sheet.getByLabel('Merchant or description').fill('E2E Bookshop');
    await sheet.getByLabel('Amount').fill('19.99');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status').getByText('Expense added.')).toBeVisible();
    await page.getByLabel('Search').fill('E2E Bookshop');
    await expect(page.getByText('1 transaction')).toBeVisible();
    await page.getByRole('button', { name: /^Edit .*E2E Bookshop/ }).click();
    await page.getByRole('dialog', { name: 'Edit expense' }).getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete expense' }).click();
    await expect(page.getByText('No transactions match these filters.')).toBeVisible();
  });

  test('assistant: draft from a sentence, review the tool trace, confirm once, see it in Assignments', async ({
    page,
  }) => {
    await page.goto('/assistant');
    await expect(page.getByText('Mock model')).toBeVisible(); // honest label: not AI inference
    await page.getByRole('button', { name: 'Use the example' }).click();
    await page.getByRole('button', { name: 'Draft the work day' }).click();
    const draft = page.getByRole('region', { name: 'Review before saving' });
    await expect(draft).toBeVisible();
    await expect(draft.getByText('$114.27')).toBeVisible();
    await expect(draft.getByRole('cell', { name: 'Mrs. Jones' })).toBeVisible();
    const trace = page.getByRole('region', { name: 'How the assistant got there' });
    for (const tool of [
      'get_employment_defaults',
      'resolve_schedule',
      'search_teachers',
      'propose_work_day',
      'compute_pay',
    ])
      await expect(trace.getByText(tool, { exact: true })).toBeVisible();
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);

    await draft.getByRole('button', { name: 'Save work day' }).click();
    const saved = page.getByRole('region', { name: 'Saved and verified' });
    await expect(saved).toBeVisible();
    await expect(saved.getByText('Stored pay equals expectedPay()')).toBeVisible();

    await saved.getByRole('link', { name: 'Open Assignments' }).click();
    await page.getByLabel('Search').fill('Mrs. Jones');
    await expect(page.getByText('1 work day')).toBeVisible();
  });

  test('assistant: finance question answered from the database', async ({ page }) => {
    await page.goto('/assistant');
    await page.getByRole('radio', { name: 'Ask about money' }).click();
    await page.getByLabel('Your question').fill('How much did I spend last month?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    const answer = page.getByRole('region', { name: 'Answer' });
    await expect(answer.getByText(/^You spent \$[\d,]+\.\d\d across \d+ expenses? in /)).toBeVisible();
  });

  test('settings: employment defaults are editable and persist', async ({ page }) => {
    await page.goto('/settings');
    const panel = page.getByRole('region', { name: 'Employment defaults' });
    const tuesday = panel.getByRole('group', { name: 'Tuesday' });
    await tuesday.getByLabel('Type').selectOption('permanent');
    await panel.getByRole('button', { name: 'Save defaults' }).click();
    await expect(panel.getByRole('alert')).toContainText('Some days need attention'); // permanent needs a school
    await tuesday.getByLabel('School').fill('Munster High School');
    await panel.getByRole('button', { name: 'Save defaults' }).click();
    await expect(page.getByRole('status').getByText(/Employment defaults saved/)).toBeVisible();
    await page.reload();
    const again = page
      .getByRole('region', { name: 'Employment defaults' })
      .getByRole('group', { name: 'Tuesday' });
    await expect(again.getByLabel('Type')).toHaveValue('permanent');
    // Restore the default so other tests see the standard week.
    await again.getByLabel('Type').selectOption('regular');
    await again.getByLabel('School').fill('');
    await page.getByRole('button', { name: 'Save defaults' }).click();
    await expect(page.getByRole('status').getByText(/Employment defaults saved/)).toBeVisible();
  });

  test('period control is a keyboard radio group', async ({ page }) => {
    const group = page.getByRole('radiogroup', { name: 'Time period' });
    await group.getByRole('radio', { name: 'All time' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(group.getByRole('radio', { name: 'School year' })).toHaveAttribute('aria-checked', 'true');
  });

  test('larger default font size scales the interface (rem-based type)', async ({ page }) => {
    const base = await page
      .getByRole('heading', { level: 1 })
      .evaluate((h) => parseFloat(getComputedStyle(h).fontSize));
    await page.evaluate(() => (document.documentElement.style.fontSize = '125%'));
    const scaled = await page
      .getByRole('heading', { level: 1 })
      .evaluate((h) => parseFloat(getComputedStyle(h).fontSize));
    expect(scaled / base).toBeCloseTo(1.25, 1);
  });
});
