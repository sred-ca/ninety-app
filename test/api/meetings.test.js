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

test('POST /api/meetings — sections_snapshot round-trips on the response', async () => {
  // The snapshot is a JSONB column in PG / opaque object in JSON mode. It
  // captures the agenda's section list at meeting-create time so future
  // edits to the agenda don't rewrite past meetings' history.
  const snapshot = [
    { name: 'Headlines',    duration_minutes: 5, sort_order: 0 },
    { name: 'IDS',          duration_minutes: 30, sort_order: 1 },
    { name: 'Conclude',     duration_minutes: 5, sort_order: 2 },
  ];
  const res = await request(app)
    .post('/api/meetings')
    .set('Cookie', asUser(ALICE))
    .send({ title: 'L10 with snapshot', sections_snapshot: snapshot });
  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.data.sections_snapshot,
    snapshot,
    'sections_snapshot must round-trip exactly through the create response',
  );
});

test('DELETE /api/meetings/:id removes the meeting', async () => {
  const m = await request(app)
    .post('/api/meetings').set('Cookie', asUser(ALICE)).send({ title: 'Gone' });
  const del = await request(app)
    .delete(`/api/meetings/${m.body.data.id}`)
    .set('Cookie', asUser(ALICE));
  assert.equal(del.body.data.deleted, true);
});
