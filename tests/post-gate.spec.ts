import { expect, test } from '@playwright/test';

// Posting: a signed-out visitor is asked to sign in before the post form's first step.

test('post page asks a signed-out visitor to sign in', async ({ page }) => {
  await page.goto('/post.html');

  await expect(page.getByRole('heading', { name: 'Sign in to post a listing' })).toBeVisible();
  await expect(page.locator('[data-post-signin]')).toBeVisible();
});
