const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, asUser, ready, resetDb } = require('../helpers/boot');

test.before(async () => { await ready(); });
test.beforeEach(() => { resetDb(); });

// User 1 is "Logan" (owner role); User 2 is "Alex" (member). Seeded by initDb.
const ALICE = 1, BOB = 2;

async function createIssue(userId, body) {
  const res = await request(app)
    .post('/api/issues')
    .set('Cookie', asUser(userId))
    .send(body);
  return res;
}

test('GET /api/issues returns 401 without an auth cookie', async () => {
  const res = await request(app).get('/api/issues');
  assert.equal(res.status, 401);
  assert.equal(res.body.ok, false);
});

test('GET /api/issues returns [] for an empty store with a valid cookie', async () => {
  const res = await request(app).get('/api/issues').set('Cookie', asUser(ALICE));
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.data, []);
});

test('POST /api/issues creates with default status=in_progress and priority=medium', async () => {
  const res = await createIssue(ALICE, { title: 'Pick a CRM' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.title, 'Pick a CRM');
  assert.equal(res.body.data.status, 'in_progress');
  assert.equal(res.body.data.priority, 'medium');
});

test('POST /api/issues rejects missing title', async () => {
  const res = await createIssue(ALICE, { description: 'no title' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /title/i);
});

test('POST /api/issues rejects unknown priority', async () => {
  const res = await createIssue(ALICE, { title: 'X', priority: 'nuclear' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /priority must be one of/);
});

test('POST /api/issues accepts priority_1 when owner has none active', async () => {
  const res = await createIssue(ALICE, { title: 'Top', owner_id: ALICE, priority: 'priority_1' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.priority, 'priority_1');
});

test('POST /api/issues rejects a second active priority_1 for the same owner', async () => {
  await createIssue(ALICE, { title: 'First', owner_id: ALICE, priority: 'priority_1' });
  const res = await createIssue(ALICE, { title: 'Second', owner_id: ALICE, priority: 'priority_1' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Priority 1/);
});

test('POST /api/issues allows a new priority_1 after the existing one is solved', async () => {
  const first = await createIssue(ALICE, { title: 'First', owner_id: ALICE, priority: 'priority_1' });
  await request(app)
    .put(`/api/issues/${first.body.data.id}`)
    .set('Cookie', asUser(ALICE))
    .send({ status: 'solved' });
  const second = await createIssue(ALICE, { title: 'Second', owner_id: ALICE, priority: 'priority_1' });
  assert.equal(second.status, 200);
});

test('POST /api/issues — different owners each get their own P1', async () => {
  const a = await createIssue(ALICE, { title: 'A', owner_id: ALICE, priority: 'priority_1' });
  const b = await createIssue(ALICE, { title: 'B', owner_id: BOB,   priority: 'priority_1' });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
});

test('POST /api/issues — unassigned P1 is unrestricted', async () => {
  const a = await createIssue(ALICE, { title: 'A', owner_id: null, priority: 'priority_1' });
  const b = await createIssue(ALICE, { title: 'B', owner_id: null, priority: 'priority_1' });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
});

test('PUT /api/issues/:id — promoting to priority_1 is blocked when owner already has one', async () => {
  await createIssue(ALICE, { title: 'Existing', owner_id: ALICE, priority: 'priority_1' });
  const second = await createIssue(ALICE, { title: 'Candidate', owner_id: ALICE, priority: 'high' });
  const res = await request(app)
    .put(`/api/issues/${second.body.data.id}`)
    .set('Cookie', asUser(ALICE))
    .send({ priority: 'priority_1' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Priority 1/);
});

test('PUT /api/issues/:id — reassigning a P1 to a user who already has one is blocked', async () => {
  // Bob has an existing active P1.
  await createIssue(ALICE, { title: 'Bob existing', owner_id: BOB, priority: 'priority_1' });
  // Alice's P1 — try to hand it to Bob.
  const alicesP1 = await createIssue(ALICE, { title: 'Alice P1', owner_id: ALICE, priority: 'priority_1' });
  const res = await request(app)
    .put(`/api/issues/${alicesP1.body.data.id}`)
    .set('Cookie', asUser(ALICE))
    .send({ owner_id: BOB, priority: 'priority_1' });
  assert.equal(res.status, 400);
});

test('PUT /api/issues/:id — demoting a P1 to medium frees the slot', async () => {
  const first = await createIssue(ALICE, { title: 'Old', owner_id: ALICE, priority: 'priority_1' });
  await request(app)
    .put(`/api/issues/${first.body.data.id}`)
    .set('Cookie', asUser(ALICE))
    .send({ priority: 'medium' });
  const second = await createIssue(ALICE, { title: 'New', owner_id: ALICE, priority: 'priority_1' });
  assert.equal(second.status, 200);
});

test('private issues — non-owner gets 404 on GET/PUT/DELETE', async () => {
  const created = await createIssue(ALICE, { title: 'Hush', owner_id: ALICE, private: true });
  const id = created.body.data.id;

  const getAsBob = await request(app).get('/api/issues').set('Cookie', asUser(BOB));
  assert.equal(getAsBob.body.data.find(i => i.id === id), undefined, 'Bob should not see private rows in list');

  const putAsBob = await request(app)
    .put(`/api/issues/${id}`)
    .set('Cookie', asUser(BOB))
    .send({ title: 'Hijacked' });
  assert.equal(putAsBob.status, 404);
  assert.equal(putAsBob.body.error, 'to-do not found');

  const delAsBob = await request(app).delete(`/api/issues/${id}`).set('Cookie', asUser(BOB));
  assert.equal(delAsBob.status, 404);
});

test('archive flow — archived rows hidden by default, returned with include_archived=1', async () => {
  const created = await createIssue(ALICE, { title: 'Old work', owner_id: ALICE });
  await request(app)
    .put(`/api/issues/${created.body.data.id}`)
    .set('Cookie', asUser(ALICE))
    .send({ archived: true });

  const def = await request(app).get('/api/issues').set('Cookie', asUser(ALICE));
  assert.equal(def.body.data.find(i => i.id === created.body.data.id), undefined);

  const all = await request(app).get('/api/issues?include_archived=1').set('Cookie', asUser(ALICE));
  assert.ok(all.body.data.find(i => i.id === created.body.data.id));
});

test('GET /api/issues?status=solved returns ALL solved (incl. archived)', async () => {
  // The /solved tab is documented as returning archived rows too — the
  // archive flag should NOT filter them out when filtering by status=solved.
  const a = await createIssue(ALICE, { title: 'Solved A', owner_id: ALICE });
  const b = await createIssue(ALICE, { title: 'Solved B archived', owner_id: ALICE });
  await request(app).put(`/api/issues/${a.body.data.id}`).set('Cookie', asUser(ALICE)).send({ status: 'solved' });
  await request(app).put(`/api/issues/${b.body.data.id}`).set('Cookie', asUser(ALICE)).send({ status: 'solved' });
  await request(app).put(`/api/issues/${b.body.data.id}`).set('Cookie', asUser(ALICE)).send({ archived: true });

  const res = await request(app).get('/api/issues?status=solved').set('Cookie', asUser(ALICE));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 2, 'solved tab should include archived solved rows');
});

test('GET /api/issues?status=in_progress excludes solved rows', async () => {
  const a = await createIssue(ALICE, { title: 'Active', owner_id: ALICE });
  const b = await createIssue(ALICE, { title: 'Done',   owner_id: ALICE });
  await request(app).put(`/api/issues/${b.body.data.id}`).set('Cookie', asUser(ALICE)).send({ status: 'solved' });
  const res = await request(app).get('/api/issues?status=in_progress').set('Cookie', asUser(ALICE));
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].title, 'Active');
});

test('GET /api/issues?include_archived accepts both "1" and "true"', async () => {
  const created = await createIssue(ALICE, { title: 'Old', owner_id: ALICE });
  await request(app).put(`/api/issues/${created.body.data.id}`).set('Cookie', asUser(ALICE)).send({ archived: true });

  const r1 = await request(app).get('/api/issues?include_archived=1').set('Cookie', asUser(ALICE));
  const r2 = await request(app).get('/api/issues?include_archived=true').set('Cookie', asUser(ALICE));
  const rNo = await request(app).get('/api/issues?include_archived=no').set('Cookie', asUser(ALICE));
  assert.equal(r1.body.data.length, 1);
  assert.equal(r2.body.data.length, 1);
  assert.equal(rNo.body.data.length, 0, 'arbitrary truthy strings other than "1"/"true" must NOT include archived');
});

test('issue status cycle — in_progress → blocker → solved → reopen to in_progress', async () => {
  // Lock in the cycle the kanban UI relies on. If status validation ever
  // tightens to forbid backward moves, this test should fail loudly.
  const created = await createIssue(ALICE, { title: 'Cycle me', owner_id: ALICE });
  const id = created.body.data.id;
  const transitions = ['blocker', 'waiting_for', 'solved', 'in_progress'];
  for (const status of transitions) {
    const res = await request(app)
      .put(`/api/issues/${id}`).set('Cookie', asUser(ALICE)).send({ status });
    assert.equal(res.status, 200, `transition to ${status} must succeed`);
    assert.equal(res.body.data.status, status);
  }
});

test('DELETE /api/issues/:id removes the row', async () => {
  const created = await createIssue(ALICE, { title: 'Doomed', owner_id: ALICE });
  const id = created.body.data.id;
  const del = await request(app).delete(`/api/issues/${id}`).set('Cookie', asUser(ALICE));
  assert.equal(del.status, 200);
  assert.equal(del.body.data.deleted, true);
  const after = await request(app).get('/api/issues').set('Cookie', asUser(ALICE));
  assert.equal(after.body.data.find(i => i.id === id), undefined);
});
