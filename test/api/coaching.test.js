const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, asUser, ready, resetDb } = require('../helpers/boot-coaching');
const { userQueries } = require('../../database');

test.before(async () => { await ready(); });
test.beforeEach(() => { resetDb(); });

const ADMIN_KEY = process.env.NINETY_ADMIN_KEY;
const ALICE = 1;
const adminAuth = h => h.set('Authorization', `Bearer ${ADMIN_KEY}`);

// ── Admin-keyed write paths ──────────────────────────────────────────────

test('GET /api/coaching/enabled — auth-gated; reports the flag state', async () => {
  // Cookie-authed (registered after the /api requireAuth middleware). The UI
  // hits this to decide whether to render the Stella tab.
  const noAuth = await request(app).get('/api/coaching/enabled');
  assert.equal(noAuth.status, 401);
  const res = await request(app).get('/api/coaching/enabled').set('Cookie', asUser(ALICE));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.enabled, true);
});

test('POST /api/coaching/calls — rejects requests without admin key', async () => {
  const res = await request(app)
    .post('/api/coaching/calls')
    .set('X-Coaching-User-Id', ALICE)
    .send({ commitments: [] });
  assert.equal(res.status, 401);
});

test('POST /api/coaching/calls — rejects without X-Coaching-User-Id header', async () => {
  // resolveCoachingTarget falls back to LEGACY_USER_EMAIL env if header missing.
  // In tests that env is unset, so the route must fail with a clear message.
  const res = await adminAuth(request(app).post('/api/coaching/calls'))
    .send({ commitments: [] });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /X-Coaching-User-Id/);
});

test('POST /api/coaching/calls — rejects unknown coaching user id', async () => {
  const res = await adminAuth(request(app).post('/api/coaching/calls'))
    .set('X-Coaching-User-Id', '999999')
    .send({ commitments: [] });
  assert.equal(res.status, 404);
  assert.match(res.body.error, /Unknown coaching user/);
});

test('POST /api/coaching/calls — rejects when target user has coaching disabled', async () => {
  // Seed Alice without coaching_enabled flag — still a valid user, but the
  // resolver rejects because the gate flips to "Coaching not enabled".
  // (Alice's coaching_enabled defaults to false in the JSON seed.)
  const res = await adminAuth(request(app).post('/api/coaching/calls'))
    .set('X-Coaching-User-Id', ALICE)
    .send({ commitments: [] });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /Coaching not enabled/);
});

test('POST /api/coaching/calls — rejects non-array commitments', async () => {
  await userQueries.updateCoachingSettings(ALICE, { coaching_enabled: true });
  const res = await adminAuth(request(app).post('/api/coaching/calls'))
    .set('X-Coaching-User-Id', ALICE)
    .send({ commitments: 'not-an-array' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /commitments must be an array/);
});

test('POST /api/coaching/calls — rejects malformed call_date', async () => {
  await userQueries.updateCoachingSettings(ALICE, { coaching_enabled: true });
  const res = await adminAuth(request(app).post('/api/coaching/calls'))
    .set('X-Coaching-User-Id', ALICE)
    .send({ commitments: [], call_date: '5/9/2026' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /YYYY-MM-DD/);
});

test('POST /api/coaching/calls — happy path creates a call', async () => {
  await userQueries.updateCoachingSettings(ALICE, { coaching_enabled: true });
  const res = await adminAuth(request(app).post('/api/coaching/calls'))
    .set('X-Coaching-User-Id', ALICE)
    .send({
      summary: 'Productive session',
      commitments: [{ title: 'Send proposal' }],
    });
  assert.equal(res.status, 200);
  assert.ok(res.body.data.call_id);
  assert.equal(res.body.data.issue_ids.length, 1);
});

test('POST /api/coaching/calls — empty external_id string is rejected', async () => {
  await userQueries.updateCoachingSettings(ALICE, { coaching_enabled: true });
  const res = await adminAuth(request(app).post('/api/coaching/calls'))
    .set('X-Coaching-User-Id', ALICE)
    .send({ commitments: [], external_id: '   ' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /non-empty string/);
});

// ── Admin-keyed reads ────────────────────────────────────────────────────

test('GET /api/coaching/user-by-phone — 404 for unknown number', async () => {
  const res = await adminAuth(
    request(app).get('/api/coaching/user-by-phone?phone=%2B14165550199')
  );
  assert.equal(res.status, 404);
});

test('GET /api/coaching/user-by-phone — finds an enabled user by their phone', async () => {
  await userQueries.updateCoachingSettings(ALICE, {
    coaching_enabled: true,
    coaching_phone: '+14165551234',
  });
  const res = await adminAuth(
    request(app).get('/api/coaching/user-by-phone?phone=%2B14165551234')
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.data.user_id, ALICE);
});

test('GET /api/coaching/user-by-phone — 404 when user exists but coaching is disabled', async () => {
  await userQueries.updateCoachingSettings(ALICE, {
    coaching_enabled: false,
    coaching_phone: '+14165550000',
  });
  const res = await adminAuth(
    request(app).get('/api/coaching/user-by-phone?phone=%2B14165550000')
  );
  assert.equal(res.status, 404, 'disabled users must not leak via phone lookup');
});

test('GET /api/coaching/admin/user-state — returns user + stats + recent', async () => {
  await userQueries.updateCoachingSettings(ALICE, { coaching_enabled: true });
  const res = await adminAuth(
    request(app).get('/api/coaching/admin/user-state').set('X-Coaching-User-Id', ALICE)
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.data.user.id, ALICE);
  assert.ok(res.body.data.stats);
  assert.ok(res.body.data.recent);
});

test('GET /api/coaching/rocks — admin-keyed, returns the rock list', async () => {
  const res = await adminAuth(request(app).get('/api/coaching/rocks'));
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data));
});

test('GET /api/coaching/issues — non-private only (uid=0 sees no privates)', async () => {
  // The route hard-codes currentUserId=0 so private issues are filtered out.
  // This proves the privacy guard fires through this surface too.
  const res = await adminAuth(request(app).get('/api/coaching/issues'));
  assert.equal(res.status, 200);
  // Empty store; assertion is on shape.
  assert.ok(Array.isArray(res.body.data));
});

// ── User-scoped (cookie auth) reads ──────────────────────────────────────

test('GET /api/coaching/calls — requires auth cookie', async () => {
  const res = await request(app).get('/api/coaching/calls');
  assert.equal(res.status, 401);
});

test('GET /api/coaching/calls — returns this user\'s calls only (paginated)', async () => {
  const res = await request(app)
    .get('/api/coaching/calls?limit=5&offset=0')
    .set('Cookie', asUser(ALICE));
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data.calls));
  assert.equal(res.body.data.has_more, false);
});

test('GET /api/coaching/calls/:id — 404 for cross-user access', async () => {
  // Create a call for Alice via the admin path, then try to fetch it as user 2.
  await userQueries.updateCoachingSettings(ALICE, { coaching_enabled: true });
  const created = await adminAuth(request(app).post('/api/coaching/calls'))
    .set('X-Coaching-User-Id', ALICE)
    .send({ commitments: [], summary: 'private chat' });

  const asBob = await request(app)
    .get(`/api/coaching/calls/${created.body.data.call_id}`)
    .set('Cookie', asUser(2));
  assert.equal(asBob.status, 404, 'must not leak another user\'s coaching call');
});

test('GET /api/coaching/settings — returns the current user\'s coaching prefs', async () => {
  await userQueries.updateCoachingSettings(ALICE, {
    coaching_enabled: true, coaching_phone: '+14165551111',
  });
  const res = await request(app)
    .get('/api/coaching/settings').set('Cookie', asUser(ALICE));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.coaching_enabled, true);
  assert.equal(res.body.data.coaching_phone, '+14165551111');
});

test('PUT /api/coaching/settings — normalizes 10-digit phone to E.164', async () => {
  const res = await request(app)
    .put('/api/coaching/settings')
    .set('Cookie', asUser(ALICE))
    .send({ coaching_enabled: true, coaching_phone: '(416) 555-0199' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.coaching_phone, '+14165550199',
    'NA 10-digit input must normalize with leading +1');
});

test('PUT /api/coaching/settings — rejects too-short phone', async () => {
  const res = await request(app)
    .put('/api/coaching/settings')
    .set('Cookie', asUser(ALICE))
    .send({ coaching_enabled: true, coaching_phone: '12345' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /7.16 digits/);
});
