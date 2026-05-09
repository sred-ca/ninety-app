const { test, expect } = require('./fixtures');

// Each test scopes its data with a unique title — same dev server / DATA_FILE
// is reused across e2e specs, so don't rely on emptiness, only on what *this*
// test created.

test('create a to-do via the Add To-Do modal — appears in the list', async ({ authedPage }) => {
  const title = `e2e-create-${Date.now()}`;
  await authedPage.goto('/');
  await authedPage.locator('.nav-item[data-view="issues"]').click();

  await authedPage.locator('#add-issue-btn').click();
  await expect(authedPage.locator('#issue-modal-title')).toBeVisible();

  await authedPage.locator('#issue-title').fill(title);
  await authedPage.locator('#save-issue-btn').click();

  // Modal closes; the new row is rendered.
  await expect(authedPage.locator('#issue-modal-title')).toBeHidden();
  await expect(authedPage.locator('text=' + title)).toBeVisible();
});

test('save button is disabled-on-empty: blank title focuses input instead of POSTing', async ({ authedPage }) => {
  await authedPage.goto('/');
  await authedPage.locator('.nav-item[data-view="issues"]').click();
  await authedPage.locator('#add-issue-btn').click();

  // Title is blank by default. Click save → handler short-circuits and refocuses.
  // (The handler explicitly returns without POSTing — no error, no row.)
  await authedPage.locator('#save-issue-btn').click();
  await expect(authedPage.locator('#issue-title')).toBeFocused();
  // Modal stays open since save bailed.
  await expect(authedPage.locator('#issue-modal-title')).toBeVisible();
});

test('priority dropdown lists all four tiers, including Priority 1', async ({ authedPage }) => {
  await authedPage.goto('/');
  await authedPage.locator('.nav-item[data-view="issues"]').click();
  await authedPage.locator('#add-issue-btn').click();

  const options = authedPage.locator('#issue-priority option');
  await expect(options).toHaveCount(4);
  // Priority 1 is the most-elevated tier we shipped — locking the order in
  // catches accidental removal or re-ordering.
  await expect(options.nth(0)).toHaveText('Priority 1');
  await expect(options.nth(0)).toHaveAttribute('value', 'priority_1');
});
