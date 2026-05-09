const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDb } = require('../helpers/boot');
const { rockQueries } = require('../../database');

test.beforeEach(() => { resetDb(); });

test('rockQueries.create sets defaults', async () => {
  const r = await rockQueries.create({ title: 'X', quarter: 'Q1 2026' });
  assert.equal(r.status, 'not_started', 'status defaults to not_started');
  assert.equal(r.progress, 0);
});

test('rockQueries.getAll filters by quarter', async () => {
  await rockQueries.create({ title: 'Q1 rock', quarter: 'Q1 2026' });
  await rockQueries.create({ title: 'Q2 rock', quarter: 'Q2 2026' });
  const q1 = await rockQueries.getAll('Q1 2026');
  assert.equal(q1.length, 1);
  assert.equal(q1[0].title, 'Q1 rock');
});

test('rockQueries.update persists progress + status changes', async () => {
  const created = await rockQueries.create({ title: 'X', quarter: 'Q1 2026' });
  const updated = await rockQueries.update(created.id, { progress: 50, status: 'on_track' });
  assert.equal(updated.progress, 50);
  assert.equal(updated.status, 'on_track');
});

test('rockQueries.delete removes the rock', async () => {
  const r = await rockQueries.create({ title: 'Doomed', quarter: 'Q1 2026' });
  await rockQueries.delete(r.id);
  const after = await rockQueries.getById(r.id);
  assert.equal(after, null);
});

test('rockQueries.quarters returns distinct quarters', async () => {
  await rockQueries.create({ title: 'A', quarter: 'Q1 2026' });
  await rockQueries.create({ title: 'B', quarter: 'Q1 2026' });
  await rockQueries.create({ title: 'C', quarter: 'Q2 2026' });
  const qs = await rockQueries.quarters();
  assert.deepEqual([...qs].sort(), ['Q1 2026', 'Q2 2026']);
});
