const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDb } = require('../helpers/boot');
const { issueQueries } = require('../../database');

test.beforeEach(() => { resetDb(); });

test('issueQueries.create defaults', async () => {
  const i = await issueQueries.create({ title: 'Pick a CRM' });
  assert.equal(i.title, 'Pick a CRM');
  assert.equal(i.status, 'in_progress', 'status defaults to in_progress');
  assert.equal(i.priority, 'medium', 'priority defaults to medium');
  assert.equal(i.archived, false);
  assert.equal(i.private, false);
});

test('issueQueries.getById round-trips', async () => {
  const created = await issueQueries.create({ title: 'X', owner_id: 1 });
  const fetched = await issueQueries.getById(created.id);
  assert.equal(fetched.id, created.id);
  assert.equal(fetched.title, 'X');
  assert.equal(fetched.owner_id, 1);
});

test('issueQueries.update mutates only allowed fields', async () => {
  const created = await issueQueries.create({ title: 'Original' });
  const updated = await issueQueries.update(created.id, { title: 'Updated', status: 'waiting_for' });
  assert.equal(updated.title, 'Updated');
  assert.equal(updated.status, 'waiting_for');
});

test('issueQueries.delete removes the row', async () => {
  const created = await issueQueries.create({ title: 'Doomed' });
  await issueQueries.delete(created.id);
  const after = await issueQueries.getById(created.id);
  assert.equal(after, null);
});

test('private issues hidden from non-owner via getById', async () => {
  const created = await issueQueries.create({ title: 'Sensitive', owner_id: 1, private: true });
  const asOwner    = await issueQueries.getById(created.id, 1);
  const asOther    = await issueQueries.getById(created.id, 2);
  const asInternal = await issueQueries.getById(created.id); // no currentUserId — bypass
  assert.ok(asOwner);
  assert.equal(asOther, null);
  assert.ok(asInternal);
});

test('hasActivePriority1', async (t) => {
  await t.test('returns false on an empty store', async () => {
    resetDb();
    assert.equal(await issueQueries.hasActivePriority1(1, null), false);
  });

  await t.test('returns true when owner has an active P1', async () => {
    resetDb();
    await issueQueries.create({ title: 'Top', owner_id: 1, priority: 'priority_1' });
    assert.equal(await issueQueries.hasActivePriority1(1, null), true);
  });

  await t.test('returns false when the only P1 is solved', async () => {
    resetDb();
    const i = await issueQueries.create({ title: 'Done', owner_id: 1, priority: 'priority_1' });
    await issueQueries.update(i.id, { status: 'solved' });
    assert.equal(await issueQueries.hasActivePriority1(1, null), false);
  });

  await t.test('returns false when the only P1 is archived', async () => {
    resetDb();
    const i = await issueQueries.create({ title: 'Shelved', owner_id: 1, priority: 'priority_1' });
    await issueQueries.update(i.id, { archived: true });
    assert.equal(await issueQueries.hasActivePriority1(1, null), false);
  });

  await t.test('respects excludeIssueId so a row updating itself is allowed', async () => {
    resetDb();
    const i = await issueQueries.create({ title: 'Self', owner_id: 1, priority: 'priority_1' });
    assert.equal(await issueQueries.hasActivePriority1(1, i.id), false);
    assert.equal(await issueQueries.hasActivePriority1(1, null), true);
  });

  await t.test('is per-owner — User A having a P1 does not block User B', async () => {
    resetDb();
    await issueQueries.create({ title: 'A', owner_id: 1, priority: 'priority_1' });
    assert.equal(await issueQueries.hasActivePriority1(2, null), false);
  });

  await t.test('ignores rows whose priority is not P1', async () => {
    resetDb();
    await issueQueries.create({ title: 'High', owner_id: 1, priority: 'high' });
    assert.equal(await issueQueries.hasActivePriority1(1, null), false);
  });
});
