const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDb } = require('../helpers/boot');
const { coachingQueries, issueQueries } = require('../../database');

test.beforeEach(() => { resetDb(); });

const ALICE = 1;

test('coachingQueries.createCall stores a call with no commitments', async () => {
  const result = await coachingQueries.createCall({
    user_id: ALICE,
    summary: 'Worked on goals.',
    gratitude: 'Team support',
    commitments: [],
  });
  assert.ok(result.call_id);
  assert.deepEqual(result.issue_ids, []);
});

test('coachingQueries.createCall creates one private issue per commitment', async () => {
  const result = await coachingQueries.createCall({
    user_id: ALICE,
    commitments: [
      { title: 'Send the proposal' },
      { title: 'Block 3hr for design' },
    ],
  });
  assert.equal(result.issue_ids.length, 2);

  // Each issue is owned by the coaching user, marked private, source='coaching'.
  const i1 = await issueQueries.getById(result.issue_ids[0]);
  assert.equal(i1.owner_id, ALICE);
  assert.equal(i1.private, true);
  assert.equal(i1.source, 'coaching');
});

test('coachingQueries.createCall skips commitments with empty titles', async () => {
  const result = await coachingQueries.createCall({
    user_id: ALICE,
    commitments: [
      { title: 'Real one' },
      { title: '   ' },     // whitespace-only
      { title: '' },        // empty
      {},                   // missing title
    ],
  });
  assert.equal(result.issue_ids.length, 1);
});

test('coachingQueries.createCall is idempotent on external_id', async () => {
  const first = await coachingQueries.createCall({
    user_id: ALICE,
    external_id: 'vapi-call-abc-123',
    commitments: [{ title: 'Original commitment' }],
  });
  const retry = await coachingQueries.createCall({
    user_id: ALICE,
    external_id: 'vapi-call-abc-123',
    commitments: [{ title: 'Should be ignored' }],
  });
  assert.equal(retry.call_id, first.call_id, 'second call must resolve to existing id');
  assert.equal(retry.duplicate, true);
  assert.deepEqual(retry.issue_ids, [], 'retry must not create new issues');
});

test('coachingQueries.getCallById returns null for the wrong user_id', async () => {
  const { call_id } = await coachingQueries.createCall({
    user_id: ALICE,
    commitments: [{ title: 'Mine' }],
  });
  // Same call_id, different user → null. The query is scoped by user_id to
  // prevent cross-user leakage of coaching transcripts.
  assert.equal(await coachingQueries.getCallById(call_id, 999), null);
  // Right user → returns the call with commitments attached.
  const own = await coachingQueries.getCallById(call_id, ALICE);
  assert.equal(own.id, call_id);
  assert.equal(own.commitments.length, 1);
});

test('coachingQueries.listCalls paginates with has_more', async () => {
  for (let i = 0; i < 3; i++) {
    await coachingQueries.createCall({
      user_id: ALICE,
      summary: `Call ${i}`,
      commitments: [{ title: `c${i}` }],
    });
  }
  const page1 = await coachingQueries.listCalls(ALICE, 2, 0);
  assert.equal(page1.calls.length, 2);
  assert.equal(page1.has_more, true);

  const page2 = await coachingQueries.listCalls(ALICE, 2, 2);
  assert.equal(page2.calls.length, 1);
  assert.equal(page2.has_more, false);
});

test('coachingQueries.getStats counts active rocks for the user', async () => {
  // Stats includes other things, but active_rocks is computed from rockQueries
  // and is the easiest signal to verify in isolation. Empty state → 0.
  const stats = await coachingQueries.getContext(ALICE);
  assert.deepEqual(stats.active_rocks, []);
  assert.equal(stats.streak_days, 0);
});
