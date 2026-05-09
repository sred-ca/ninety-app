const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, asUser, ready, resetDb } = require('../helpers/boot');

test.before(async () => { await ready(); });
test.beforeEach(() => { resetDb(); });

const ALICE = 1;

test('GET /api/team-issues requires auth', async () => {
  const res = await request(app).get('/api/team-issues');
  assert.equal(res.status, 401);
});

test('POST /api/team-issues creates with horizon', async () => {
  const res = await request(app)
    .post('/api/team-issues')
    .set('Cookie', asUser(ALICE))
    .send({ title: 'Team blocker', horizon: 'short_term' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.title, 'Team blocker');
  assert.equal(res.body.data.horizon, 'short_term');
});

test('POST /api/team-issues rejects unknown horizon', async () => {
  const res = await request(app)
    .post('/api/team-issues')
    .set('Cookie', asUser(ALICE))
    .send({ title: 'X', horizon: 'medium_term' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /horizon must be one of/);
});

test('GET /api/team-issues filters by horizon', async () => {
  await request(app).post('/api/team-issues').set('Cookie', asUser(ALICE))
    .send({ title: 'Now',  horizon: 'short_term' });
  await request(app).post('/api/team-issues').set('Cookie', asUser(ALICE))
    .send({ title: 'Soon', horizon: 'long_term' });
  const res = await request(app)
    .get('/api/team-issues?horizon=short_term')
    .set('Cookie', asUser(ALICE));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].title, 'Now');
});

test('PUT /api/team-issues/:id/rank — rejects out-of-range rank', async () => {
  const created = await request(app)
    .post('/api/team-issues')
    .set('Cookie', asUser(ALICE))
    .send({ title: 'X', horizon: 'short_term' });
  const res = await request(app)
    .put(`/api/team-issues/${created.body.data.id}/rank`)
    .set('Cookie', asUser(ALICE))
    .send({ rank: 5 });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /rank must be null or an integer 1-3/);
});

test('PUT /api/team-issues/:id/rank — accepts a valid rank', async () => {
  const created = await request(app)
    .post('/api/team-issues')
    .set('Cookie', asUser(ALICE))
    .send({ title: 'X', horizon: 'short_term' });
  const res = await request(app)
    .put(`/api/team-issues/${created.body.data.id}/rank`)
    .set('Cookie', asUser(ALICE))
    .send({ rank: 2 });
  assert.equal(res.status, 200);
});

test('DELETE /api/team-issues/:id removes the row', async () => {
  const created = await request(app)
    .post('/api/team-issues')
    .set('Cookie', asUser(ALICE))
    .send({ title: 'Gone', horizon: 'short_term' });
  const del = await request(app)
    .delete(`/api/team-issues/${created.body.data.id}`)
    .set('Cookie', asUser(ALICE));
  assert.equal(del.status, 200);
  assert.equal(del.body.data.deleted, true);
});
