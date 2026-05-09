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
