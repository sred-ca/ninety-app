const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, asUser, ready, resetDb } = require('../helpers/boot');

test.before(async () => { await ready(); });
test.beforeEach(() => { resetDb(); });

const OWNER = 1;   // Logan, role='owner' — full V/TO access
const MEMBER = 2;  // Alex, role='member' — public subset only

test('GET /api/vto returns the full row for owners', async () => {
  const res = await request(app).get('/api/vto').set('Cookie', asUser(OWNER));
  assert.equal(res.status, 200);
  // Owner gets the full shape — at minimum, fields outside the public subset.
  assert.ok(res.body.data);
});

test('GET /api/vto returns only the public subset for members without the vto tab', async () => {
  const res = await request(app).get('/api/vto').set('Cookie', asUser(MEMBER));
  assert.equal(res.status, 200);
  // Public subset has core_values, core_focus_*, one_year_*. Confirm the response
  // doesn't carry private fields (e.g. ten_year_target / quarterly_rocks aren't in
  // publicVtoSubset).
  assert.deepEqual(Object.keys(res.body.data).sort(), [
    'core_focus_niche', 'core_focus_purpose', 'core_values',
    'one_year_future_date', 'one_year_goals',
  ].sort());
});

test('PUT /api/vto — owner can update', async () => {
  const res = await request(app)
    .put('/api/vto')
    .set('Cookie', asUser(OWNER))
    .send({ core_focus_niche: 'Helping teams ship' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.core_focus_niche, 'Helping teams ship');
});

test('PUT /api/vto — member without vto-tab access is forbidden', async () => {
  const res = await request(app)
    .put('/api/vto')
    .set('Cookie', asUser(MEMBER))
    .send({ core_focus_niche: 'Trying to edit' });
  assert.equal(res.status, 403);
});
