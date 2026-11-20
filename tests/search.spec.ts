import { expect, test, type Locator, type Page } from '@playwright/test';

function day(offset: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  const part = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}`;
}

async function chooseDate(dialog: Locator, date: string): Promise<void> {
  const target = dialog.locator(`[data-wp-d="${date}"]`);
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const targetMonth = Number(date.slice(5, 7)) - 1;
  const targetYear = Number(date.slice(0, 4));

  for (let attempt = 0; attempt < 15; attempt += 1) {
    if (await target.count()) {
      await expect(target).toBeEnabled();
      await target.press('Enter');
      return;
    }

    const [monthName, yearText] = (await dialog.locator('[data-wp-mt]').innerText()).split(' ');
    const currentMonth = months.indexOf(monthName);
    const currentYear = Number(yearText);
    const delta = (targetYear - currentYear) * 12 + targetMonth - currentMonth;
    const direction = delta > 0 ? 'Next month' : 'Previous month';
    await dialog.getByRole('button', { name: direction }).press('Enter');
  }

  throw new Error(`Could not navigate the date picker to ${date}`);
}

async function chooseCampus(page: Page, name: string, id: string): Promise<void> {
  const campus = page.locator('#bar4 .s-camp[role="button"]');
  await campus.click();
  await campus.press('ArrowDown');
  await campus.press('Enter');
  await expect(page.locator('#aCamp')).toHaveValue(id);
  await expect(page.locator('#bar4 [data-v="camp"]')).toHaveText(name);
}

async function chooseStay(page: Page, start: string, end: string): Promise<void> {
  await page.locator('#aWhen').click();
  const dialog = page.getByRole('dialog', { name: 'Choose your dates' });
  await chooseDate(dialog, start);
  await chooseDate(dialog, end);
  await dialog.getByRole('button', { name: 'Done' }).click();
}

async function chooseBudget(page: Page, price: string): Promise<void> {
  await page.locator('#aBud').click();
  const dialog = page.getByRole('dialog', { name: "Most you'd pay a month" });
  await dialog.getByRole('button', { name: price, exact: true }).press('Enter');
  await dialog.getByRole('button', { name: 'Done' }).press('Enter');
  await expect(page.locator('#aBud')).toContainText(`Up to ${price}`);
}

async function submitSearch(page: Page): Promise<void> {
  await page.locator('#bar4').getByRole('button', { name: 'Find rooms' }).click();
}

test.describe('homepage room search', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#bar4')).toBeVisible();
    // The listing controls appear once the seeded rooms have loaded.
    await expect(page.locator('#cxNearBox [data-rmwhere]')).toBeVisible();
  });

  test('shows rooms that match the chosen campus, dates, and budget', async ({ page }) => {
    await chooseCampus(page, 'Northwestern · Evanston', 'nu-evn');
    await chooseStay(page, day(35), day(95));
    await chooseBudget(page, '$1,200');
    await submitSearch(page);

    const results = page.locator('#res .cx-card');
    await expect(results).toHaveCount(1);
    await expect(results).toHaveAccessibleName(
      /E2 Apartments, Private room.*Downtown Evanston, \$950 a month/,
    );
  });

  test('offers a housing request when no rooms match the search', async ({ page }) => {
    await chooseCampus(page, 'Northwestern · Evanston', 'nu-evn');
    // Both seeded Evanston listings end before this requested stay begins.
    await chooseStay(page, day(205), day(255));
    await chooseBudget(page, '$1,200');
    await submitSearch(page);

    const resultSection = page.locator('#res');
    await expect(
      resultSection.getByRole('heading', { name: 'Nothing lines up with these dates yet' }),
    ).toBeVisible();
    await expect(resultSection.locator('.cx-card')).toHaveCount(0);

    const requestButton = resultSection.getByRole('button', { name: 'Create a housing request' });
    await expect(requestButton).toBeVisible();
    await requestButton.click();
    await expect(page).toHaveURL(/request\.html/);
  });
});
