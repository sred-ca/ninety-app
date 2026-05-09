const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, asUser, ready, resetDb } = require('../helpers/boot');

test.before(async () => { await ready(); });
test.beforeEach(() => { resetDb(); });

const OWNER = 1, MEMBER = 2;

test('GET /api/admin/tab-access — member is forbidden', async () => {
  const res = await request(app).get('/api/admin/tab-access').set('Cookie', asUser(MEMBER));
  assert.equal(res.status, 403);
});

test('GET /api/admin/tab-access — owner sees the matrix', async () => {
  const res = await request(app).get('/api/admin/tab-access').set('Cookie', asUser(OWNER));
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data.assignable_tabs));
  assert.ok(Array.isArray(res.body.data.users));
});

test('PUT /api/admin/tab-access/:userId — rejects non-array body', async () => {
  const res = await request(app)
    .put(`/api/admin/tab-access/${MEMBER}`)
    .set('Cookie', asUser(OWNER))
    .send({ tabs: 'not-an-array' });
  assert.equal(res.status, 400);
});

test('PUT /api/admin/tab-access/:userId — rejects unknown tab name', async () => {
  const res = await request(app)
    .put(`/api/admin/tab-access/${MEMBER}`)
    .set('Cookie', asUser(OWNER))
    .send({ tabs: ['definitely-not-a-tab'] });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /unknown tab/);
});
