import { expect, test } from '@playwright/test';

// Opening a room: the room page shows a live listing's details, says plainly when a listing is
// unknown or taken down, and keeps old links to ended listings readable.

test('room page shows the listing details', async ({ page }) => {
  await page.goto('/room.html?room=71000001');

  await expect(page.locator('.titlebar h1')).toContainText('E2 Apartments');
  await expect(page.locator('.titlebar h1')).toContainText('Private room in a 2-bed');
  await expect(page.locator('.titlebar .t-sub')).toContainText('Downtown Evanston');
  await expect(page.locator('.bk-pr b')).toHaveText('$950');
  await expect(page.getByRole('button', { name: 'Copy listing number 71000001' })).toBeVisible();
});

test('unknown listing number says it could not be found', async ({ page }) => {
  await page.goto('/room.html?room=99999999');

  await expect(page.locator('.st-box h1')).toHaveText(/couldn.t find this listing/);
});

test('taken-down listing says it is no longer available', async ({ page }) => {
  await page.goto('/room.html?room=73000003');

  await expect(page.locator('.st-box h1')).toHaveText('This listing is no longer available');
});

test('ended listing still opens, marked Ended, without Message', async ({ page }) => {
  await page.goto('/room.html?room=74000004');

  await expect(page.locator('.titlebar h1')).toContainText('Old Hall');
  await expect(page.locator('.titlebar .t-end')).toHaveText('Ended');
  await expect(page.locator('.dock')).toContainText('Search rooms');
  await expect(page.locator('.dock [data-msg]')).toHaveCount(0);
});
