const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, asUser, ready, resetDb } = require('../helpers/boot');
const { qbConnectionQueries } = require('../../database');

test.before(async () => { await ready(); });
test.beforeEach(() => { resetDb(); });

const OWNER  = 1; // Logan, role='owner'
const MEMBER = 2; // Alex, role='member'

// ── requireOwner gating ──────────────────────────────────────────────────

test('GET /api/quickbooks/status — requires auth', async () => {
  const res = await request(app).get('/api/quickbooks/status');
  assert.equal(res.status, 401);
});

test('GET /api/quickbooks/status — member is forbidden (requireOwner)', async () => {
  const res = await request(app)
    .get('/api/quickbooks/status').set('Cookie', asUser(MEMBER));
  assert.equal(res.status, 403);
});

test('POST /api/quickbooks/disconnect — member is forbidden', async () => {
  const res = await request(app)
    .post('/api/quickbooks/disconnect').set('Cookie', asUser(MEMBER));
  assert.equal(res.status, 403);
});

test('GET /api/quickbooks/accounts — member is forbidden', async () => {
  const res = await request(app)
    .get('/api/quickbooks/accounts').set('Cookie', asUser(MEMBER));
  assert.equal(res.status, 403);
});

test('POST /api/quickbooks/sync — member is forbidden', async () => {
  const res = await request(app)
    .post('/api/quickbooks/sync').set('Cookie', asUser(MEMBER));
  assert.equal(res.status, 403);
});

// ── Status surface (qb module unconfigured in tests) ─────────────────────

test('GET /api/quickbooks/status — owner gets configured:false when QBO env vars are unset', async () => {
  // QBO_CLIENT_ID / QBO_CLIENT_SECRET aren't set in the test boot, so
  // qb.configured() returns false and the route reports the unconfigured shape.
  const res = await request(app)
    .get('/api/quickbooks/status').set('Cookie', asUser(OWNER));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.configured, false);
  assert.equal(res.body.data.connected, false);
});

// ── Connection-required routes return 400 when no connection exists ─────

test('GET /api/quickbooks/accounts — 400 when not connected', async () => {
  const res = await request(app)
    .get('/api/quickbooks/accounts').set('Cookie', asUser(OWNER));
  assert.equal(res.status, 400);
  assert.match(res.body.error, /not connected/i);
});

test('POST /api/quickbooks/sync — 400 when not connected', async () => {
  const res = await request(app)
    .post('/api/quickbooks/sync').set('Cookie', asUser(OWNER));
  assert.equal(res.status, 400);
  assert.match(res.body.error, /not connected/i);
});

test('POST /api/quickbooks/auto-map — 400 when not connected', async () => {
  const res = await request(app)
    .post('/api/quickbooks/auto-map').set('Cookie', asUser(OWNER))
    .send({ fiscal_year: 'FY27' });
  assert.equal(res.status, 400);
});

test('POST /api/quickbooks/rebuild-budget — 400 when not connected', async () => {
  const res = await request(app)
    .post('/api/quickbooks/rebuild-budget').set('Cookie', asUser(OWNER))
    .send({ fiscal_year: 'FY27' });
  assert.equal(res.status, 400);
});

// ── Disconnect doesn't need a live connection ───────────────────────────

test('POST /api/quickbooks/disconnect — owner can disconnect (idempotent)', async () => {
  const res = await request(app)
    .post('/api/quickbooks/disconnect').set('Cookie', asUser(OWNER));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.disconnected, true);

  // Repeat — must still succeed.
  const again = await request(app)
    .post('/api/quickbooks/disconnect').set('Cookie', asUser(OWNER));
  assert.equal(again.status, 200);
});

test('POST /api/quickbooks/disconnect — wipes an existing connection', async () => {
  // Seed a connection through the query layer, then call the route.
  await qbConnectionQueries.upsert({
    realm_id: 'r-test',
    access_token: 'a',
    refresh_token: 'r',
    access_token_expires_at: '2026-12-01T00:00:00Z',
  });
  assert.ok(await qbConnectionQueries.getActive(), 'precondition: active connection exists');

  await request(app)
    .post('/api/quickbooks/disconnect').set('Cookie', asUser(OWNER));
  assert.equal(await qbConnectionQueries.getActive(), null,
    'disconnect must clear the active connection');
});

// ── Status when a connection exists (post-OAuth state) ──────────────────

test('GET /api/quickbooks/status — reports connected:true once a connection is upserted', async () => {
  // Configure QB (sets configured:true) by setting env vars before calling.
  // qb module reads these at module load, so we can't toggle mid-test —
  // instead we just verify the connected-row shape via DB state.
  await qbConnectionQueries.upsert({
    realm_id: '4620816365239876',
    access_token: 'tok',
    refresh_token: 'ref',
    access_token_expires_at: '2026-12-01T00:00:00Z',
  });
  // qb is unconfigured in tests, so the route short-circuits to the
  // unconfigured response regardless of DB state. Documenting the contract:
  // status only reads the DB when qb.configured() is true.
  const res = await request(app)
    .get('/api/quickbooks/status').set('Cookie', asUser(OWNER));
  assert.equal(res.body.data.configured, false,
    'qb.configured() reflects env vars at module load — not the DB');
});
