const { test, expect } = require('./fixtures');

test('without an auth cookie, the login screen is shown', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#login-screen')).toBeVisible();
  await expect(page.locator('#app')).toBeHidden();
});

test('with a valid cookie, the app shell loads with the current user', async ({ authedPage }) => {
  await authedPage.goto('/');
  await expect(authedPage.locator('#app')).toBeVisible();
  await expect(authedPage.locator('#login-screen')).toBeHidden();
  // Sidebar shows the signed-in user's name (Logan is the seeded id=1 user).
  await expect(authedPage.locator('#sidebar-username')).toHaveText(/Logan/);
});

test('sidebar nav switches the visible view', async ({ authedPage }) => {
  await authedPage.goto('/');
  await expect(authedPage.locator('#app')).toBeVisible();

  // Click the Rocks tab — the rocks view becomes active, To-Dos becomes inactive.
  await authedPage.locator('.nav-item[data-view="rocks"]').click();
  await expect(authedPage.locator('.nav-item[data-view="rocks"]')).toHaveClass(/active/);
  // Header for the rocks page renders.
  await expect(authedPage.locator('h1', { hasText: 'Rocks' })).toBeVisible();

  // Switch back to To-Dos.
  await authedPage.locator('.nav-item[data-view="issues"]').click();
  await expect(authedPage.locator('.nav-item[data-view="issues"]')).toHaveClass(/active/);
});
