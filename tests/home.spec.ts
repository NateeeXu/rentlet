import { expect, test } from '@playwright/test';

// Browsing rooms: the homepage's All rooms section lists every live room at the campus,
// whatever the search above says — and hides listings that are taken down or ended.

test('All rooms shows the live listings, newest first', async ({ page }) => {
  await page.goto('/?rooms=1');

  const cards = page.locator('#rmGrid article.cx-card[data-code]');
  await expect(cards).toHaveCount(2);
  // STUDIO was seeded newer than E2_ROOM, and the default sort is newest first.
  await expect(cards.nth(0)).toHaveAttribute('data-code', '72000002');
  await expect(cards.nth(1)).toHaveAttribute('data-code', '71000001');

  await expect(cards.nth(0)).toHaveAccessibleName(/Entire studio.*North Evanston.*\$1,400 a month/);
  await expect(cards.nth(1)).toHaveAccessibleName(/E2 Apartments.*Downtown Evanston.*\$950 a month/);
});

test('All rooms hides taken-down and ended listings', async ({ page }) => {
  await page.goto('/?rooms=1');

  await expect(page.locator('#rmGrid article.cx-card[data-code]')).toHaveCount(2);
  await expect(page.locator('#rmGrid [data-code="73000003"]')).toHaveCount(0);
  await expect(page.locator('#rmGrid [data-code="74000004"]')).toHaveCount(0);
});

test('clicking a room card opens its room page', async ({ page }) => {
  await page.goto('/?rooms=1');

  await page.locator('#rmGrid [data-code="71000001"]').click();

  await expect(page).toHaveURL(/room\.html\?room=71000001/);
  await expect(page.locator('.titlebar h1')).toContainText('E2 Apartments');
});
