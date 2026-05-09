/* Postgres-mode smoke + integration tests.
 *
 * Runs only when DATABASE_URL is set. In the JSON-mode CI job, every test
 * here self-skips so the file passes through cleanly.
 *
 * What's covered here that JSON-mode tests can't:
 *  - Schema migration (CREATE TABLE / ALTER TABLE … ADD COLUMN IF NOT EXISTS)
 *    actually runs against a real Postgres
 *  - Transactions with FOR UPDATE locks (userQueries.setRole last-owner guard)
 *  - ON CONFLICT upserts (budgetQueries cells, coachingQueries idempotency)
 *  - JSONB round-trips (V/TO core_values, meetings sections_snapshot)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { PG_AVAILABLE, ready, resetDb } = require('../helpers/boot-postgres');

const skip = !PG_AVAILABLE && 'set DATABASE_URL to run PG-mode tests';

test.before(async () => { if (PG_AVAILABLE) await ready(); });
test.beforeEach(async () => { if (PG_AVAILABLE) await resetDb(); });

// ── Schema smoke ─────────────────────────────────────────────────────────

test('schema — all expected tables exist after initDb', { skip }, async () => {
  const { pool } = require('../../database');
  const expected = [
    'users', 'rocks', 'rock_milestones', 'issues', 'issue_votes',
    'agendas', 'agenda_sections', 'meetings', 'meeting_attendees',
    'team_issues', 'coaching_calls', 'coaching_commitments',
    'coaching_assistant_prompts', 'qb_connections', 'budget_lines',
    'budget_cells', 'vto', 'user_tab_access',
  ];
  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [expected]
  );
  const present = new Set(rows.map(r => r.table_name));
  for (const t of expected) {
    assert.ok(present.has(t), `expected table ${t} after migration`);
  }
});

test('schema — issues.priority defaults to medium and is NOT NULL', { skip }, async () => {
  const { pool } = require('../../database');
  const { rows } = await pool.query(
    `SELECT column_default, is_nullable FROM information_schema.columns
       WHERE table_name = 'issues' AND column_name = 'priority'`
  );
  assert.equal(rows[0].is_nullable, 'NO');
  assert.match(rows[0].column_default, /'medium'/);
});

// ── Transactions: setRole last-owner guard via FOR UPDATE ───────────────

test('userQueries.setRole — refuses to demote the last owner (PG transaction guard)', { skip }, async () => {
  const { userQueries } = require('../../database');
  // Logan (id=1) is the only seeded owner.
  await assert.rejects(
    userQueries.setRole(1, 'member'),
    err => err.code === 'LAST_OWNER',
    'PG path must throw LAST_OWNER, mirroring JSON-mode behavior'
  );
});

test('userQueries.setRole — promotes a second owner, then allows demotion', { skip }, async () => {
  const { userQueries } = require('../../database');
  await userQueries.setRole(2, 'owner');
  const demoted = await userQueries.setRole(2, 'member');
  assert.equal(demoted.role, 'member');
});

// ── ON CONFLICT upsert: budget cells ────────────────────────────────────

test('budgetQueries.upsertCell — ON CONFLICT (line_id, period_date) updates instead of duplicating', { skip }, async () => {
  const { budgetQueries, pool } = require('../../database');
  const line = await budgetQueries.createLine({
    fiscal_year: 'FY27', section: 'income', category: 'Test line',
  });
  await budgetQueries.upsertCell({
    line_id: line.id, period_date: '2026-05-01', budget_amount: 1000,
  });
  await budgetQueries.upsertCell({
    line_id: line.id, period_date: '2026-05-01', budget_amount: 9999,
  });
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS c, MAX(budget_amount)::int AS max
       FROM budget_cells WHERE line_id = $1 AND period_date = $2`,
    [line.id, '2026-05-01']
  );
  assert.equal(rows[0].c, 1, 'second upsert must not insert a duplicate row');
  assert.equal(rows[0].max, 9999, 'second upsert must overwrite the value');
});

// ── ON CONFLICT (external_id): coaching call idempotency ────────────────

test('coachingQueries.createCall — ON CONFLICT (external_id) is idempotent at the DB level', { skip }, async () => {
  const { coachingQueries, pool } = require('../../database');
  const ext = 'vapi-call-pg-test-001';
  const first = await coachingQueries.createCall({
    user_id: 1, external_id: ext, commitments: [{ title: 'first' }],
  });
  const retry = await coachingQueries.createCall({
    user_id: 1, external_id: ext, commitments: [{ title: 'should not insert' }],
  });
  assert.equal(retry.duplicate, true);
  assert.equal(retry.call_id, first.call_id);

  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM coaching_calls WHERE external_id = $1`, [ext]
  );
  assert.equal(rows[0].c, 1, 'unique constraint on external_id must hold under retry');
});

// ── JSONB round-trip: V/TO core_values ──────────────────────────────────

test('vtoQueries — JSONB columns round-trip nested objects exactly', { skip }, async () => {
  const { vtoQueries } = require('../../database');
  const values = [
    { id: 'cv1', text: 'Curiosity over consensus' },
    { id: 'cv2', text: 'Ship & iterate' },
  ];
  const updated = await vtoQueries.update({ core_values: values });
  // PG returns JSONB as parsed JS — must equal what we put in.
  assert.deepEqual(updated.core_values, values);
});

// ── JSONB round-trip: meetings.sections_snapshot ────────────────────────

test('meetingQueries — sections_snapshot JSONB persists structurally', { skip }, async () => {
  const { meetingQueries } = require('../../database');
  const snapshot = [
    { name: 'Headlines', duration_minutes: 5, sort_order: 0 },
    { name: 'IDS',       duration_minutes: 30, sort_order: 1 },
  ];
  const m = await meetingQueries.create({
    title: 'L10', sections_snapshot: snapshot,
  });
  const fetched = await meetingQueries.getById(m.id);
  assert.deepEqual(fetched.sections_snapshot, snapshot);
});
