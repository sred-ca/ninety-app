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

test('DELETE /api/agendas/:id removes the agenda', async () => {
  const a = await request(app)
    .post('/api/agendas').set('Cookie', asUser(ALICE)).send({ title: 'Gone' });
  const del = await request(app)
    .delete(`/api/agendas/${a.body.data.id}`)
    .set('Cookie', asUser(ALICE));
  assert.equal(del.body.data.deleted, true);
});
