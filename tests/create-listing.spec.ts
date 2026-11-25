import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Acceptance test: creating a listing
//
//   Given that the user is signed in and wants to create a listing
//   When the user fills in all the required steps and submits it
//   Then the listing should be available for all other users to see.
//
// Needs the Firebase emulators (auth, firestore, storage) and the app started with VITE_USE_EMULATORS=true,
// so nothing touches the real rentlet-nu project. Run it with `npm run em:e2e`.

// A 1x1 PNG, so the required bedroom photo can be "uploaded" without a fixture file.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

// The post form's calendar chips are hardcoded to the 2026-27 academic year (post.html PRESETS), and move-in
// can't be in the past. This is the last chip, "Until my lease ends" (2026-12-20 to 2027-08-31).
// After 20 Dec 2026 it fails with "Move-in can't be before today": update PRESETS and this index together.
const LAST_DATE_CHIP = -1;

async function newVisitor(browser: Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  // Never call the real (production) Cloud Functions: address suggestions, map tiles, walking routes.
  // The app copes without them, as the README says.
  await ctx.route(/cloudfunctions\.net|\/api\/(route|shuttle)|\/tiles\//, (route) => route.abort());
  return ctx;
}

// The Storage emulator hands out http://localhost:9199/... download links, but the room page only shows photos
// whose link is https (src/lib/listingView.ts httpsUrl), so a listing with only emulator photos reads as "not found"
// to a visitor. Production links are always https. After publishing, swap the emulator's origin for the real
// Firebase Storage one (same path and token) so the stored listing looks like it would in production. The photo was
// still really uploaded and published through the form; only the link's origin changes.
async function useProductionPhotoLinks(code: string) {
  expect(process.env.FIRESTORE_EMULATOR_HOST, 'run this through `npm run test:e2e` so the Firestore emulator is set').toBeTruthy();
  const app = getApps().find((a) => a.name === 'create-listing-e2e') ?? initializeApp({ projectId: 'rentlet-nu' }, 'create-listing-e2e');
  const ref = getFirestore(app).collection('listings').doc(code);

  const photos: string[] = (await ref.get()).get('photos');
  expect(photos?.length, 'the published listing has the uploaded photo').toBeGreaterThan(0);
  expect(photos[0], 'the photo was uploaded to the Storage emulator').toMatch(/^http:\/\/(localhost|127\.0\.0\.1):\d+\/v0\/b\/.+\/o\/listings%2F/);

  await ref.update({
    photos: photos.map((p) => p.replace(/^http:\/\/(localhost|127\.0\.0\.1):\d+/, 'https://firebasestorage.googleapis.com')),
  });
}

// Rentlet only has "Sign in with Google". With the Auth emulator that opens the emulator's fake Google window.
async function signInWithFakeGoogle(page: Page) {
  const popupPromise = page.waitForEvent('popup');
  await page.locator('[data-post-signin]').click();
  const popup = await popupPromise;

  await popup.getByText('Add new account').click();
  await popup.getByRole('button', { name: /auto-generate/i }).click();
  await popup.getByRole('button', { name: /sign in with/i }).click();
  // the emulator closes its window itself once the account is chosen
  await popup.waitForEvent('close');
}

// Click Next and check we landed on the step we expected (stops a skipped step from sending the test off course).
async function next(page: Page, nextHeading: string) {
  await page.locator('[data-next]').click();
  await expect(page.locator('h2.q')).toHaveText(nextHeading);
}

test('a listing published by a signed-in user is visible to other users', async ({ browser }) => {
  // ---------- Given: the user is signed in and wants to create a listing ----------
  const hostCtx = await newVisitor(browser);
  // the campus is picked on the homepage and remembered for the post form; start with Northwestern · Evanston chosen
  await hostCtx.addInitScript(() => {
    try {
      sessionStorage.setItem('cs-plan', JSON.stringify({ school: 'nu-evn' }));
    } catch {
      /* not available on some pages (e.g. the emulator's sign-in window) */
    }
  });
  const host = await hostCtx.newPage();

  await host.goto('/post.html');
  await expect(host.getByRole('heading', { name: 'Sign in to post a listing' })).toBeVisible();
  await signInWithFakeGoogle(host);
  await expect(host.locator('h2.q')).toHaveText('What are you leaving?');

  // ---------- When: they fill in every required step and publish ----------
  // 1. What are you leaving?
  await host.locator('[data-set="subletType:sublet"]').click();
  await next(host, 'Where is it?');

  // 2. Where is it? (campus is already chosen; building and website are optional)
  await host.locator('[data-f="addr"]').fill('733 Colfax St, Evanston');
  await host.locator('[data-one="shuttle:unknown"]').click();
  await next(host, 'When is it free?');

  // 3. When is it free?
  await host.locator('[data-dates]').nth(LAST_DATE_CHIP).click();
  await next(host, 'Money');

  // 4. Money
  await host.locator('[data-num="rent"]').fill('950');
  await host.locator('[data-set="dep:none"]').click();
  await next(host, 'The room');

  // 5. The room
  await host.locator('[data-set="unit:room"]').click();
  await host.locator('[data-set="layout:2B1B"]').click();
  await host.locator('[data-one="bath:private"]').click();
  await next(host, 'Who lives there?');

  // 6. Who lives there?
  await host.locator('[data-set="hasRoommates:no"]').click();
  await next(host, 'In the building'); // 7. nothing required
  await next(host, 'What stays?');

  // 8. What stays?
  await host.locator('[data-one="furn:none"]').click();
  await next(host, 'House rules'); // 9. nothing required
  await next(host, 'Photos');

  // 10. Photos: at least one of the bedroom
  await host.locator('input[data-area="bedroom"]').setInputFiles({ name: 'bedroom.png', mimeType: 'image/png', buffer: PNG });
  await expect(host.locator('.ph.has')).toHaveCount(1);
  await next(host, 'Prove it’s yours');

  // 11. Prove it's yours
  await host.locator('[data-set="proof:student"]').click();
  await next(host, 'Check and publish');

  // 12. Check and publish
  await host.locator('[data-next]').click(); // the button reads "Publish" on this step
  await expect(host.getByRole('heading', { name: 'Your listing is live' })).toBeVisible({ timeout: 30_000 });

  const live = await host.locator('.a-q.done .hint').innerText();
  const code = live.match(/#(\d{8})/)?.[1];
  expect(code, 'the confirmation shows the 8-digit listing number').toBeTruthy();

  await useProductionPhotoLinks(code!);

  // ---------- Then: other users can see the listing ----------
  // A brand-new browser session, signed out, so it shares nothing with the host (anyone may browse active listings).
  const visitorCtx = await newVisitor(browser);
  const visitor = await visitorCtx.newPage();
  await visitor.goto(`/room.html?room=${code}`);

  await expect(visitor.getByRole('button', { name: `Copy listing number ${code}` })).toBeVisible();
  await expect(visitor.locator('.titlebar h1')).toContainText('Private room in a 2-bed');
  await expect(visitor.locator('.bk-pr b')).toHaveText('$950');

  await hostCtx.close();
  await visitorCtx.close();
});
