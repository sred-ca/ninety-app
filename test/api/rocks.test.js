const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, asUser, ready, resetDb } = require('../helpers/boot');

test.before(async () => { await ready(); });
test.beforeEach(() => { resetDb(); });

const ALICE = 1;

test('GET /api/rocks requires auth', async () => {
  const res = await request(app).get('/api/rocks');
  assert.equal(res.status, 401);
});

test('GET /api/rocks returns [] when empty', async () => {
  const res = await request(app).get('/api/rocks').set('Cookie', asUser(ALICE));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, []);
});

test('POST /api/rocks creates with required fields', async () => {
  const res = await request(app)
    .post('/api/rocks')
    .set('Cookie', asUser(ALICE))
    .send({ title: 'Ship CRM', quarter: 'Q2 2026', owner_id: ALICE });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.title, 'Ship CRM');
  assert.equal(res.body.data.quarter, 'Q2 2026');
});

test('POST /api/rocks rejects missing title', async () => {
  const res = await request(app)
    .post('/api/rocks')
    .set('Cookie', asUser(ALICE))
    .send({ quarter: 'Q2 2026' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /title/i);
});

test('POST /api/rocks rejects missing quarter', async () => {
  const res = await request(app)
    .post('/api/rocks')
    .set('Cookie', asUser(ALICE))
    .send({ title: 'X' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /quarter/i);
});

test('POST /api/rocks rejects unknown status', async () => {
  const res = await request(app)
    .post('/api/rocks')
    .set('Cookie', asUser(ALICE))
    .send({ title: 'X', quarter: 'Q1 2026', status: 'fictional' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /status must be one of/);
});

test('PUT /api/rocks/:id updates progress', async () => {
  const created = await request(app)
    .post('/api/rocks')
    .set('Cookie', asUser(ALICE))
    .send({ title: 'X', quarter: 'Q1 2026' });
  const res = await request(app)
    .put(`/api/rocks/${created.body.data.id}`)
    .set('Cookie', asUser(ALICE))
    .send({ progress: 75, status: 'on_track' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.progress, 75);
  assert.equal(res.body.data.status, 'on_track');
});

test('DELETE /api/rocks/:id removes the rock', async () => {
  const created = await request(app)
    .post('/api/rocks')
    .set('Cookie', asUser(ALICE))
    .send({ title: 'Doomed', quarter: 'Q1 2026' });
  const id = created.body.data.id;
  const del = await request(app).delete(`/api/rocks/${id}`).set('Cookie', asUser(ALICE));
  assert.equal(del.status, 200);
  assert.equal(del.body.data.deleted, true);
});

test('POST /api/rocks/:rockId/milestones creates a milestone', async () => {
  const rock = await request(app)
    .post('/api/rocks')
    .set('Cookie', asUser(ALICE))
    .send({ title: 'Big rock', quarter: 'Q1 2026' });
  const res = await request(app)
    .post(`/api/rocks/${rock.body.data.id}/milestones`)
    .set('Cookie', asUser(ALICE))
    .send({ title: 'Step 1', due_date: '2026-06-01' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.title, 'Step 1');
});

test('POST milestone — rejects missing title', async () => {
  const rock = await request(app)
    .post('/api/rocks')
    .set('Cookie', asUser(ALICE))
    .send({ title: 'Big rock', quarter: 'Q1 2026' });
  const res = await request(app)
    .post(`/api/rocks/${rock.body.data.id}/milestones`)
    .set('Cookie', asUser(ALICE))
    .send({ due_date: '2026-06-01' });
  assert.equal(res.status, 400);
});

test('PUT /api/rocks/:id — progress=200 stored as-is (route does NOT clamp)', async () => {
  // Documenting current behavior: the route does no bounds-checking on
  // progress. If clamping is added later, this test should fail and be
  // updated — exactly the regression signal we want.
  const created = await request(app)
    .post('/api/rocks')
    .set('Cookie', asUser(ALICE))
    .send({ title: 'X', quarter: 'Q1 2026' });
  const res = await request(app)
    .put(`/api/rocks/${created.body.data.id}`)
    .set('Cookie', asUser(ALICE))
    .send({ progress: 200 });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.progress, 200);
});

test('rock status — each STATUS_ROCK value round-trips on PUT', async () => {
  // Tests that the validator accepts every documented value. Catches enum
  // drift if STATUS_ROCK is changed in server.js but the API contract isn't.
  const created = await request(app)
    .post('/api/rocks')
    .set('Cookie', asUser(ALICE))
    .send({ title: 'X', quarter: 'Q1 2026' });
  const id = created.body.data.id;
  for (const status of ['not_started', 'on_track', 'off_track', 'done']) {
    const res = await request(app)
      .put(`/api/rocks/${id}`).set('Cookie', asUser(ALICE)).send({ status });
    assert.equal(res.status, 200, `status ${status} must round-trip`);
    assert.equal(res.body.data.status, status);
  }
});

test('DELETE /api/rocks/:id cascades to milestones', async () => {
  const rock = await request(app)
    .post('/api/rocks')
    .set('Cookie', asUser(ALICE))
    .send({ title: 'Doomed rock', quarter: 'Q1 2026' });
  const rockId = rock.body.data.id;
  const m = await request(app)
    .post(`/api/rocks/${rockId}/milestones`)
    .set('Cookie', asUser(ALICE))
    .send({ title: 'Will get orphaned?', due_date: '2026-06-01' });
  assert.equal(m.status, 200);

  await request(app).delete(`/api/rocks/${rockId}`).set('Cookie', asUser(ALICE));

  // Re-fetch milestones for that rock — should be empty (cascade-deleted).
  const after = await request(app)
    .get(`/api/rocks/${rockId}/milestones`)
    .set('Cookie', asUser(ALICE));
  assert.deepEqual(after.body.data, [], 'milestones must be removed when their rock is deleted');
});
