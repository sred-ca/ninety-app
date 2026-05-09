const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, ready, resetDb } = require('../helpers/boot-coaching');
const { userQueries, coachingQueries } = require('../../database');

test.before(async () => { await ready(); });
test.beforeEach(() => { resetDb(); });

const ADMIN_KEY = process.env.NINETY_ADMIN_KEY;
const ALICE = 1;
const ROUTE = '/api/coaching/vapi-assistant-request';

const samplePayload = (phone) => ({
  message: {
    type: 'assistant-request',
    call: { customer: { number: phone } },
  },
});

// ── requireWebhookAuth ───────────────────────────────────────────────────

test('webhook rejects requests with no auth token', async () => {
  const res = await request(app).post(ROUTE).send(samplePayload('+14165551234'));
  assert.equal(res.status, 401);
});

test('webhook accepts the token via Authorization Bearer', async () => {
  const res = await request(app)
    .post(ROUTE)
    .set('Authorization', `Bearer ${ADMIN_KEY}`)
    .send({});
  // No phone in payload → should still 200 with the "talk to your admin" handoff,
  // proving the auth gate let us through.
  assert.equal(res.status, 200);
  assert.match(res.body?.assistant?.firstMessage || '', /talk to your admin|set up yet/i);
});

test('webhook accepts the token via x-vapi-secret header', async () => {
  const res = await request(app)
    .post(ROUTE)
    .set('x-vapi-secret', ADMIN_KEY)
    .send({});
  assert.equal(res.status, 200);
});

test('webhook accepts the token via ?token query string (VAPI fallback path)', async () => {
  // requireWebhookAuth supports query-string token because some VAPI integrations
  // can't set custom headers — that's a real and documented surface.
  const res = await request(app)
    .post(`${ROUTE}?token=${encodeURIComponent(ADMIN_KEY)}`)
    .send({});
  assert.equal(res.status, 200);
});

test('webhook rejects a wrong token', async () => {
  const res = await request(app)
    .post(ROUTE)
    .set('Authorization', 'Bearer not-the-real-key')
    .send(samplePayload('+14165551234'));
  assert.equal(res.status, 401);
});

// ── Payload handling (post-auth) ─────────────────────────────────────────

test('webhook returns generic handoff when phone is missing', async () => {
  const res = await request(app)
    .post(ROUTE)
    .set('Authorization', `Bearer ${ADMIN_KEY}`)
    .send({ message: { type: 'assistant-request', call: {} } });
  assert.equal(res.status, 200);
  assert.match(res.body.assistant.firstMessage, /set up yet|admin/i);
});

test('webhook returns generic handoff for an unknown phone', async () => {
  const res = await request(app)
    .post(ROUTE)
    .set('Authorization', `Bearer ${ADMIN_KEY}`)
    .send(samplePayload('+19999999999'));
  assert.equal(res.status, 200);
  // Must NOT include any user metadata since no user was matched.
  assert.equal(res.body.assistantOverrides, undefined);
});

test('webhook returns generic handoff when user has coaching disabled', async () => {
  await userQueries.updateCoachingSettings(ALICE, {
    coaching_enabled: false,
    coaching_phone: '+14165552222',
  });
  const res = await request(app)
    .post(ROUTE)
    .set('Authorization', `Bearer ${ADMIN_KEY}`)
    .send(samplePayload('+14165552222'));
  assert.equal(res.status, 200);
  // Disabled users get the same generic handoff as unknowns — no leak that
  // the phone exists in our DB.
  assert.equal(res.body.assistantOverrides, undefined);
});

test('webhook returns generic handoff when user has no assistant prompt yet', async () => {
  await userQueries.updateCoachingSettings(ALICE, {
    coaching_enabled: true,
    coaching_phone: '+14165553333',
  });
  // No setAssistantPrompt call → getAssistantPrompt returns null → handoff.
  const res = await request(app)
    .post(ROUTE)
    .set('Authorization', `Bearer ${ADMIN_KEY}`)
    .send(samplePayload('+14165553333'));
  assert.equal(res.status, 200);
  assert.equal(res.body.assistantOverrides, undefined);
});

test('webhook returns Stella overrides when phone matches an enabled user with a prompt', async () => {
  await userQueries.updateCoachingSettings(ALICE, {
    coaching_enabled: true,
    coaching_phone: '+14165554444',
  });
  await coachingQueries.setAssistantPrompt(ALICE, 'You are Stella for Logan…');
  const res = await request(app)
    .post(ROUTE)
    .set('Authorization', `Bearer ${ADMIN_KEY}`)
    .send(samplePayload('+14165554444'));
  assert.equal(res.status, 200);
  assert.ok(res.body.assistantOverrides, 'override block must be present');
  // Critical: model.provider MUST be set or VAPI rejects the request and
  // silently falls back to the base assistant — exactly the regression the
  // route's comment warns about.
  assert.equal(res.body.assistantOverrides.model.provider, 'anthropic');
  assert.equal(res.body.assistantOverrides.model.messages[0].role, 'system');
  assert.match(res.body.assistantOverrides.model.messages[0].content, /Stella/);
  assert.equal(res.body.assistantOverrides.metadata.coaching_user_id, ALICE);
});

test('webhook accepts call.from as a phone-source fallback', async () => {
  // Some VAPI payloads use call.from instead of call.customer.number.
  await userQueries.updateCoachingSettings(ALICE, {
    coaching_enabled: true,
    coaching_phone: '+14165555555',
  });
  await coachingQueries.setAssistantPrompt(ALICE, 'You are Stella…');
  const res = await request(app)
    .post(ROUTE)
    .set('Authorization', `Bearer ${ADMIN_KEY}`)
    .send({ message: { call: { from: '+14165555555' } } });
  assert.equal(res.status, 200);
  assert.ok(res.body.assistantOverrides, 'fallback path must resolve user');
});
