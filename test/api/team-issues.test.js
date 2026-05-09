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

test('team-issue rank — assigning rank=1 to a second row demotes the first', async () => {
  // Documenting the contract: setRank is exclusive — only one row per rank.
  // If this changes (e.g. ties allowed), this test will fail and prompt a
  // deliberate update.
  const a = await request(app)
    .post('/api/team-issues').set('Cookie', asUser(ALICE))
    .send({ title: 'A', horizon: 'short_term' });
  const b = await request(app)
    .post('/api/team-issues').set('Cookie', asUser(ALICE))
    .send({ title: 'B', horizon: 'short_term' });
  await request(app)
    .put(`/api/team-issues/${a.body.data.id}/rank`).set('Cookie', asUser(ALICE))
    .send({ rank: 1 });
  await request(app)
    .put(`/api/team-issues/${b.body.data.id}/rank`).set('Cookie', asUser(ALICE))
    .send({ rank: 1 });
  const list = await request(app)
    .get('/api/team-issues').set('Cookie', asUser(ALICE));
  const top1s = list.body.data.filter(i => i.top_rank === 1);
  assert.equal(top1s.length, 1,
    'at most one team issue may carry rank=1; assigning to a second must displace the first');
  assert.equal(top1s[0].id, b.body.data.id, 'most recent rank=1 wins');
});

test('team-issue rank — null clears an existing rank', async () => {
  const a = await request(app)
    .post('/api/team-issues').set('Cookie', asUser(ALICE))
    .send({ title: 'A', horizon: 'short_term' });
  await request(app)
    .put(`/api/team-issues/${a.body.data.id}/rank`).set('Cookie', asUser(ALICE))
    .send({ rank: 2 });
  await request(app)
    .put(`/api/team-issues/${a.body.data.id}/rank`).set('Cookie', asUser(ALICE))
    .send({ rank: null });
  const list = await request(app)
    .get('/api/team-issues').set('Cookie', asUser(ALICE));
  const refreshed = list.body.data.find(i => i.id === a.body.data.id);
  assert.equal(refreshed.top_rank, null);
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
