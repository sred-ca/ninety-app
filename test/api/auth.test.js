const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, asUser, ready, resetDb } = require('../helpers/boot');

test.before(async () => { await ready(); });
test.beforeEach(() => { resetDb(); });

const OWNER = 1;  // Logan, role='owner' per the JSON-mode boot backfill
const MEMBER = 2; // Alex

test('GET /api/me returns null when no cookie is sent', async () => {
  const res = await request(app).get('/api/me');
  assert.equal(res.status, 200);
  assert.equal(res.body.data, null, '/api/me opts out of requireAuth and returns null on missing cookie');
});

test('GET /api/me returns the user when the cookie is valid', async () => {
  const res = await request(app).get('/api/me').set('Cookie', asUser(OWNER));
  assert.equal(res.status, 200);
  assert.ok(res.body.data);
  assert.equal(res.body.data.id, OWNER);
  assert.equal(res.body.data.role, 'owner');
});

test('GET /api/me ignores tampered cookie signatures', async () => {
  const cookie = asUser(OWNER).replace(/.$/, 'X'); // mangle the last char
  const res = await request(app).get('/api/me').set('Cookie', cookie);
  // /api/me uses readAuthCookie directly and treats invalid as logged-out
  assert.equal(res.body.data, null);
});

test('GET /api/users requires auth (401 without cookie)', async () => {
  const res = await request(app).get('/api/users');
  assert.equal(res.status, 401);
});

test('GET /api/users returns the user list for an authed caller', async () => {
  const res = await request(app).get('/api/users').set('Cookie', asUser(MEMBER));
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data));
  assert.ok(res.body.data.length >= 5, 'seeded users should be present');
});

test('POST /api/users — member is forbidden (requireOwner)', async () => {
  const res = await request(app)
    .post('/api/users')
    .set('Cookie', asUser(MEMBER))
    .send({ name: 'New User' });
  assert.equal(res.status, 403);
});

test('POST /api/users — owner can create', async () => {
  const res = await request(app)
    .post('/api/users')
    .set('Cookie', asUser(OWNER))
    .send({ name: 'New User', color: '#ff1493' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.name, 'New User');
});
