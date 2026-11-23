import { expect, test, type Page } from '@playwright/test';

// Saving rooms: only signed-in visitors have a Saved list, so these specs sign in through the Auth
// emulator's stand-in Google window (the same popup the app opens, served by the emulator), never a
// real Google account. Each spec signs in as its own new user, so specs running in parallel never
// share a Saved list.

const ROOM = '71000001'; // E2 Apartments, live (seed.ts)

function newStudent() {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return { email: `saver-${id}@u.northwestern.edu`, name: 'Riley Saver' };
}

// Runs `open`, which makes the app open Google sign-in, and completes the emulator's sign-in window.
async function signInThrough(page: Page, open: () => Promise<void>, who = newStudent()) {
  const popupOpened = page.waitForEvent('popup');
  await test.step('press the button that opens Google sign-in', open);
  const popup = await test.step('wait for the sign-in window', () => popupOpened);
  // The emulator's sign-in page wires up its buttons once its script has loaded. On a slow CI runner
  // a click that lands earlier does nothing and the account form never opens, so wait for the page,
  // and press again until the form is there.
  await test.step('open the new-account form', async () => {
    await popup.waitForLoadState('load');
    await expect(async () => {
      await popup.getByRole('button', { name: 'Add new account' }).click({ timeout: 5000 });
      await expect(popup.getByLabel('Email')).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 30_000 });
  });
  await popup.getByLabel('Email').fill(who.email);
  await popup.getByLabel('Display name').fill(who.name);
  // Listen before clicking: the window closes as soon as sign-in finishes, which on a busy machine
  // can be before the click call returns, and a 'close' that has already happened is never seen.
  const closed = popup.waitForEvent('close');
  await popup.getByRole('button', { name: 'Sign in with Google.com' }).click();
  await test.step('wait for the sign-in window to close', () => closed);
  return who;
}

// Opens the room page and waits until it has finished loading and shows Save, as a person sees it
// before pressing anything.
async function openRoom(page: Page) {
  await test.step('open the room page', async () => {
    await page.goto(`/room.html?room=${ROOM}`);
    await expect(page.locator('.titlebar h1')).toContainText('E2 Apartments');
    await expect(saveButton(page)).toHaveAttribute('aria-pressed', /true|false/);
    await page.waitForFunction(() => 'Rentlet' in window);
  });
}

const saveButton = (page: Page) => page.locator(`.titlebar [data-rl-save="room:${ROOM}"]`);
const savedCards = (page: Page) => page.locator('main .cx-card');

test('saving a room while signed out asks for sign-in, then saves it', async ({ page }) => {
  // Given a signed-out visitor on a live room's page
  await openRoom(page);
  await expect(saveButton(page)).toHaveAttribute('aria-pressed', 'false');

  // When they press Save and sign in with Google
  await signInThrough(page, () => saveButton(page).click());

  // Then the room is saved
  await expect(saveButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(saveButton(page)).toContainText('Saved');
});

test('a saved room is listed on the Saved page and stays there', async ({ page }) => {
  // Given a signed-in visitor who saved a live room
  await openRoom(page);
  await signInThrough(page, () => saveButton(page).click());
  await expect(saveButton(page)).toHaveAttribute('aria-pressed', 'true');

  // When they open the Saved page
  await page.goto('/saved.html');

  // Then that room is listed, and still is after a reload
  const card = page.locator(`main .cx-card[data-saved="${ROOM}"]`);
  await expect(savedCards(page)).toHaveCount(1);
  await expect(card).toContainText('$950 / mo');
  await expect(card).toContainText('Downtown Evanston');
  await expect(card.getByRole('link')).toHaveAttribute('href', `room.html?room=${ROOM}`);
  await page.reload();
  await expect(savedCards(page)).toHaveCount(1);
  await expect(card).toContainText('$950 / mo');
});

test('removing a save takes the room off the Saved page', async ({ page }) => {
  // Given a signed-in visitor with one saved room
  await openRoom(page);
  await signInThrough(page, () => saveButton(page).click());
  await expect(saveButton(page)).toHaveAttribute('aria-pressed', 'true');

  // When they press Saved again to remove it
  await saveButton(page).click();
  await expect(saveButton(page)).toHaveAttribute('aria-pressed', 'false');

  // Then the Saved page has no rooms
  await page.goto('/saved.html');
  await expect(page.getByText('Rooms you save show up here.')).toBeVisible();
  await expect(savedCards(page)).toHaveCount(0);
});
