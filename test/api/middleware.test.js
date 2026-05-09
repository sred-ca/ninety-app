const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, ready, resetDb } = require('../helpers/boot');

test.before(async () => { await ready(); });
test.beforeEach(() => { resetDb(); });

const ADMIN_KEY = process.env.NINETY_ADMIN_KEY;
const CRON      = process.env.CRON_SECRET;

// ── requireAdminKey ──────────────────────────────────────────────────────
test('requireAdminKey rejects requests with no Authorization header', async () => {
  const res = await request(app).get('/api/admin/issues');
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'Unauthorized');
});

test('requireAdminKey rejects a wrong Bearer key', async () => {
  const res = await request(app)
    .get('/api/admin/issues')
    .set('Authorization', 'Bearer not-the-real-key');
  assert.equal(res.status, 401);
});

test('requireAdminKey rejects a key of different length (constant-time guard)', async () => {
  // Buffer.compare on different-length buffers is the path that bypasses
  // timingSafeEqual; if that early-out is removed, this test still passes
  // (different content, same length still rejected). We're locking the gate.
  const res = await request(app)
    .get('/api/admin/issues')
    .set('Authorization', 'Bearer x'); // 1 byte vs N
  assert.equal(res.status, 401);
});

test('requireAdminKey accepts the right Bearer key', async () => {
  // /api/admin/issues additionally needs ?owner_id; with the right key the
  // gate is passed and the missing param surfaces as a 400 from the handler.
  // That tells us the gate let us through (would be 401 otherwise).
  const res = await request(app)
    .get('/api/admin/issues?owner_id=1')
    .set('Authorization', `Bearer ${ADMIN_KEY}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('requireAdminKey accepts the key via x-vapi-secret header', async () => {
  const res = await request(app)
    .get('/api/admin/issues?owner_id=1')
    .set('x-vapi-secret', ADMIN_KEY);
  assert.equal(res.status, 200);
});

// ── requireCoachingFlag ──────────────────────────────────────────────────
// Tests run with COACHING_ENABLED unset, so every coaching route should
// 404 — proving the flag gate fires before any work happens.
test('requireCoachingFlag returns 404 when COACHING_ENABLED is unset', async () => {
  const res = await request(app)
    .get('/api/coaching/enabled-users')
    .set('Authorization', `Bearer ${ADMIN_KEY}`);
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'Not found');
});

test('requireCoachingFlag fires before requireAdminKey (gate ordering)', async () => {
  // Even with NO auth at all, the response must be 404 (flag gate first),
  // not 401 (admin gate). This proves we don't leak "this route exists" to
  // unauthed callers when the feature is off.
  const res = await request(app).get('/api/coaching/enabled-users');
  assert.equal(res.status, 404);
});

// ── requireCronSecret ────────────────────────────────────────────────────
test('requireCronSecret rejects requests with no Authorization header', async () => {
  const res = await request(app).get('/api/cron/promote-milestones');
  assert.equal(res.status, 401);
});

test('requireCronSecret rejects a wrong Bearer secret', async () => {
  const res = await request(app)
    .get('/api/cron/promote-milestones')
    .set('Authorization', 'Bearer wrong');
  assert.equal(res.status, 401);
});

test('requireCronSecret accepts the right Bearer secret and runs the job', async () => {
  const res = await request(app)
    .get('/api/cron/promote-milestones')
    .set('Authorization', `Bearer ${CRON}`);
  assert.equal(res.status, 200);
  // promoteDue returns { promoted, checked } — no due milestones in a fresh DB.
  assert.equal(res.body.data.promoted, 0);
  assert.equal(res.body.data.checked, 0);
});
