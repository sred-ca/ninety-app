const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, asUser, ready, resetDb } = require('../helpers/boot');
const { vtoQueries } = require('../../database');

test.before(async () => { await ready(); });
test.beforeEach(() => { resetDb(); });

const ALICE = 1;

// We stub global.fetch per-test so the route never makes a real Anthropic call.
// The route uses fetch directly (not the SDK), so this is the cleanest seam.
const realFetch = global.fetch;
function stubFetch(responseBody, ok = true, status = 200) {
  global.fetch = async () => ({
    ok,
    status,
    json:  async () => responseBody,
    text:  async () => typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody),
  });
}
test.afterEach(() => { global.fetch = realFetch; });

function anthropicTextResponse(text) {
  return { content: [{ type: 'text', text }] };
}

test('POST /api/rocks/assist requires auth', async () => {
  const res = await request(app).post('/api/rocks/assist').send({ messages: [] });
  assert.equal(res.status, 401);
});

test('POST /api/rocks/assist — cold start (no messages) returns the opener without calling Anthropic', async () => {
  let called = false;
  global.fetch = async () => { called = true; throw new Error('should not be called'); };
  const res = await request(app)
    .post('/api/rocks/assist')
    .set('Cookie', asUser(ALICE))
    .send({ messages: [] });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.done, false);
  assert.match(res.body.data.message, /shape this rock/i);
  assert.equal(called, false, 'cold start must skip the network call');
});

test('POST /api/rocks/assist — rejects when user turn cap exceeded (>10)', async () => {
  // 11 user turns = over the cap of 10
  const messages = Array.from({ length: 11 }, (_, i) => ({ role: 'user', content: `msg ${i}` }));
  const res = await request(app)
    .post('/api/rocks/assist')
    .set('Cookie', asUser(ALICE))
    .send({ messages });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Conversation too long/);
});

test('POST /api/rocks/assist — passes through Anthropic text reply unchanged', async () => {
  stubFetch(anthropicTextResponse('What problem are you trying to solve this quarter?'));
  const res = await request(app)
    .post('/api/rocks/assist')
    .set('Cookie', asUser(ALICE))
    .send({ messages: [{ role: 'user', content: 'I want to ship the CRM rebuild.' }] });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.done, false);
  assert.equal(res.body.data.message, 'What problem are you trying to solve this quarter?');
  assert.equal(res.body.data.rock, null, 'no synthesis → rock is null');
});

test('POST /api/rocks/assist — extracts a synthesized <rock>{...}</rock> block', async () => {
  const rockJson = {
    title: 'Ship CRM v2',
    description: 'Replace legacy contacts module.',
    quarter: 'Q3 2026',
    milestones: [
      { title: 'Audit existing schema', due_date: '2026-07-15' },
      { title: 'Wire new endpoints',     due_date: '2026-08-10' },
    ],
  };
  stubFetch(anthropicTextResponse(
    `Here's a draft based on what we discussed:\n<rock>${JSON.stringify(rockJson)}</rock>`
  ));
  const res = await request(app)
    .post('/api/rocks/assist')
    .set('Cookie', asUser(ALICE))
    .send({ messages: [{ role: 'user', content: 'Synthesize it.' }] });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.done, true);
  assert.equal(res.body.data.rock.title, 'Ship CRM v2');
  assert.equal(res.body.data.rock.milestones.length, 2);
  // The <rock>...</rock> block must be stripped from the user-facing message.
  assert.ok(!res.body.data.message.includes('<rock>'));
});

test('POST /api/rocks/assist — drops bogus goal_ids that aren\'t in the V/TO', async () => {
  // VTO has no goals seeded; the model invents goal_id=999 → should be nulled.
  stubFetch(anthropicTextResponse(
    `<rock>${JSON.stringify({ title: 'X', goal_id: 999, milestones: [] })}</rock>`
  ));
  const res = await request(app)
    .post('/api/rocks/assist')
    .set('Cookie', asUser(ALICE))
    .send({ messages: [{ role: 'user', content: 'Go.' }] });
  assert.equal(res.body.data.rock.goal_id, null);
});

test('POST /api/rocks/assist — keeps a goal_id that exists on the V/TO', async () => {
  // Seed a real goal so the validator keeps it.
  await vtoQueries.update({
    one_year_goals: [{ id: 'goal-1', text: 'Reach $1M ARR' }],
  });
  stubFetch(anthropicTextResponse(
    `<rock>${JSON.stringify({ title: 'X', goal_id: 'goal-1', milestones: [] })}</rock>`
  ));
  const res = await request(app)
    .post('/api/rocks/assist')
    .set('Cookie', asUser(ALICE))
    .send({ messages: [{ role: 'user', content: 'Go.' }] });
  assert.equal(res.body.data.rock.goal_id, 'goal-1');
});

test('POST /api/rocks/assist — surfaces [GOALS_LIST] as showGoals + filtered goals payload', async () => {
  await vtoQueries.update({
    one_year_goals: [
      { id: 'g1', text: 'Live goal',     archived: false },
      { id: 'g2', text: 'Archived goal', archived: true  },
    ],
  });
  stubFetch(anthropicTextResponse('Which of these is this rock advancing? [GOALS_LIST]'));
  const res = await request(app)
    .post('/api/rocks/assist')
    .set('Cookie', asUser(ALICE))
    .send({ messages: [{ role: 'user', content: 'CRM rebuild.' }] });
  assert.equal(res.body.data.showGoals, true);
  assert.equal(res.body.data.goals.length, 1, 'archived goals must be filtered out');
  assert.equal(res.body.data.goals[0].id, 'g1');
  // The [GOALS_LIST] placeholder must be removed from the message text.
  assert.ok(!res.body.data.message.includes('[GOALS_LIST]'));
});

test('POST /api/rocks/assist — translates upstream error to 502', async () => {
  stubFetch('Anthropic unavailable', false, 503);
  const res = await request(app)
    .post('/api/rocks/assist')
    .set('Cookie', asUser(ALICE))
    .send({ messages: [{ role: 'user', content: 'Go.' }] });
  assert.equal(res.status, 502);
  assert.match(res.body.error, /AI service error/);
});

test('POST /api/rocks/assist — translates fetch crash to 502', async () => {
  global.fetch = async () => { throw new Error('ECONNRESET'); };
  const res = await request(app)
    .post('/api/rocks/assist')
    .set('Cookie', asUser(ALICE))
    .send({ messages: [{ role: 'user', content: 'Go.' }] });
  assert.equal(res.status, 502);
  assert.match(res.body.error, /AI service unreachable/);
});
