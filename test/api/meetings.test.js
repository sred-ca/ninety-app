const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, asUser, ready, resetDb } = require('../helpers/boot');

test.before(async () => { await ready(); });
test.beforeEach(() => { resetDb(); });

const ALICE = 1, BOB = 2;

test('GET /api/meetings requires auth', async () => {
  const res = await request(app).get('/api/meetings');
  assert.equal(res.status, 401);
});

test('POST /api/meetings creates a meeting', async () => {
  const res = await request(app)
    .post('/api/meetings')
    .set('Cookie', asUser(ALICE))
    .send({ title: 'L10 - May 8' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.title, 'L10 - May 8');
  assert.equal(res.body.data.status, 'upcoming', 'meetings start in upcoming');
});

test('POST /api/meetings rejects missing title', async () => {
  const res = await request(app)
    .post('/api/meetings')
    .set('Cookie', asUser(ALICE))
    .send({});
  assert.equal(res.status, 400);
});

test('PUT /api/meetings/:id rejects unknown status', async () => {
  const m = await request(app)
    .post('/api/meetings').set('Cookie', asUser(ALICE)).send({ title: 'X' });
  const res = await request(app)
    .put(`/api/meetings/${m.body.data.id}`)
    .set('Cookie', asUser(ALICE))
    .send({ status: 'cancelled' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /status must be one of/);
});

test('PUT /api/meetings/:id transitions to in_progress', async () => {
  const m = await request(app)
    .post('/api/meetings').set('Cookie', asUser(ALICE)).send({ title: 'X' });
  const res = await request(app)
    .put(`/api/meetings/${m.body.data.id}`)
    .set('Cookie', asUser(ALICE))
    .send({ status: 'in_progress' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'in_progress');
});

test('PUT /api/meetings/:id/attendees — frozen once meeting is in_progress', async () => {
  const m = await request(app)
    .post('/api/meetings').set('Cookie', asUser(ALICE)).send({ title: 'X' });
  const id = m.body.data.id;
  await request(app)
    .put(`/api/meetings/${id}`).set('Cookie', asUser(ALICE)).send({ status: 'in_progress' });
  const res = await request(app)
    .put(`/api/meetings/${id}/attendees`)
    .set('Cookie', asUser(ALICE))
    .send({ userIds: [ALICE, BOB] });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /upcoming meetings/);
});

test('PUT /api/meetings/:id/attendees — sets the list while upcoming', async () => {
  const m = await request(app)
    .post('/api/meetings').set('Cookie', asUser(ALICE)).send({ title: 'X' });
  const res = await request(app)
    .put(`/api/meetings/${m.body.data.id}/attendees`)
    .set('Cookie', asUser(ALICE))
    .send({ userIds: [ALICE, BOB] });
  assert.equal(res.status, 200);
});

test('DELETE /api/meetings/:id removes the meeting', async () => {
  const m = await request(app)
    .post('/api/meetings').set('Cookie', asUser(ALICE)).send({ title: 'Gone' });
  const del = await request(app)
    .delete(`/api/meetings/${m.body.data.id}`)
    .set('Cookie', asUser(ALICE));
  assert.equal(del.body.data.deleted, true);
});
