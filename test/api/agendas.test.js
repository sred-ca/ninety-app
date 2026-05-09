const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, asUser, ready, resetDb } = require('../helpers/boot');

test.before(async () => { await ready(); });
test.beforeEach(() => { resetDb(); });

const ALICE = 1;

test('GET /api/agendas requires auth', async () => {
  const res = await request(app).get('/api/agendas');
  assert.equal(res.status, 401);
});

test('POST /api/agendas creates an agenda', async () => {
  const res = await request(app)
    .post('/api/agendas')
    .set('Cookie', asUser(ALICE))
    .send({ title: 'Weekly L10' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.title, 'Weekly L10');
});

test('POST /api/agendas rejects missing title', async () => {
  const res = await request(app)
    .post('/api/agendas')
    .set('Cookie', asUser(ALICE))
    .send({});
  assert.equal(res.status, 400);
});

test('PUT /api/agendas/:id updates the title', async () => {
  const a = await request(app)
    .post('/api/agendas').set('Cookie', asUser(ALICE)).send({ title: 'Old' });
  const res = await request(app)
    .put(`/api/agendas/${a.body.data.id}`)
    .set('Cookie', asUser(ALICE))
    .send({ title: 'New' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.title, 'New');
});

test('agenda sections — create, list, update, delete', async () => {
  const a = await request(app)
    .post('/api/agendas').set('Cookie', asUser(ALICE)).send({ title: 'A' });
  const aid = a.body.data.id;

  const sec = await request(app)
    .post(`/api/agendas/${aid}/sections`)
    .set('Cookie', asUser(ALICE))
    .send({ name: 'Headlines', duration_minutes: 5, sort_order: 0 });
  assert.equal(sec.status, 200);
  assert.equal(sec.body.data.name, 'Headlines');

  const list = await request(app).get(`/api/agendas/${aid}/sections`).set('Cookie', asUser(ALICE));
  assert.equal(list.body.data.length, 1);

  const upd = await request(app)
    .put(`/api/agenda-sections/${sec.body.data.id}`)
    .set('Cookie', asUser(ALICE))
    .send({ duration_minutes: 10 });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.data.duration_minutes, 10);

  const del = await request(app)
    .delete(`/api/agenda-sections/${sec.body.data.id}`)
    .set('Cookie', asUser(ALICE));
  assert.equal(del.body.data.deleted, true);
});

test('agenda sections — listed in sort_order ascending', async () => {
  const a = await request(app)
    .post('/api/agendas').set('Cookie', asUser(ALICE)).send({ title: 'Ordered agenda' });
  const aid = a.body.data.id;

  // Add three sections OUT of natural ordering.
  for (const [name, sort_order] of [['Third', 30], ['First', 10], ['Second', 20]]) {
    await request(app)
      .post(`/api/agendas/${aid}/sections`)
      .set('Cookie', asUser(ALICE))
      .send({ name, duration_minutes: 5, sort_order });
  }
  const list = await request(app)
    .get(`/api/agendas/${aid}/sections`)
    .set('Cookie', asUser(ALICE));
  assert.deepEqual(
    list.body.data.map(s => s.name),
    ['First', 'Second', 'Third'],
    'sections must be returned in sort_order ascending'
  );
});

test('agenda section update — sort_order change re-orders the list', async () => {
  const a = await request(app)
    .post('/api/agendas').set('Cookie', asUser(ALICE)).send({ title: 'Reorder me' });
  const aid = a.body.data.id;
  const s1 = await request(app)
    .post(`/api/agendas/${aid}/sections`).set('Cookie', asUser(ALICE))
    .send({ name: 'A', sort_order: 10 });
  const s2 = await request(app)
    .post(`/api/agendas/${aid}/sections`).set('Cookie', asUser(ALICE))
    .send({ name: 'B', sort_order: 20 });

  // Move B before A.
  await request(app)
    .put(`/api/agenda-sections/${s2.body.data.id}`)
    .set('Cookie', asUser(ALICE))
    .send({ sort_order: 5 });

  const list = await request(app)
    .get(`/api/agendas/${aid}/sections`)
    .set('Cookie', asUser(ALICE));
  assert.deepEqual(list.body.data.map(s => s.name), ['B', 'A']);
});

test('DELETE /api/agendas/:id removes the agenda', async () => {
  const a = await request(app)
    .post('/api/agendas').set('Cookie', asUser(ALICE)).send({ title: 'Gone' });
  const del = await request(app)
    .delete(`/api/agendas/${a.body.data.id}`)
    .set('Cookie', asUser(ALICE));
  assert.equal(del.body.data.deleted, true);
});
