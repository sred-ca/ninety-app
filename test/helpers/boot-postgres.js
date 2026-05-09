/* PG-mode test boot helper.
 *
 * Used by tests under `test/postgres/` that need to exercise the real
 * Postgres code path (transactions with FOR UPDATE, ON CONFLICT upserts,
 * JSONB columns) — none of which the JSON fallback simulates faithfully.
 *
 * Activation: set `DATABASE_URL` to a reachable Postgres before running.
 *   npm run test:pg                                # uses default
 *   DATABASE_URL=postgres://... npm test           # also picks up PG tests
 *
 * Without `DATABASE_URL`, this module exports `PG_AVAILABLE = false`. Test
 * files key their `skip` option off that flag so the JSON-mode CI job
 * passes through these files without touching a database.
 *
 * Each test file runs in its own Node worker, so a worker that loads this
 * helper gets its own server.js + pg.Pool instance. The shared Postgres
 * instance is the only contention surface — `__resetForTests()` (TRUNCATE
 * with RESTART IDENTITY) wipes it between tests.
 */

const PG_AVAILABLE = !!process.env.DATABASE_URL;

let app, asUser, ready, resetDb;

if (PG_AVAILABLE) {
  // Force PG mode: never set DATA_FILE, never delete DATABASE_URL.
  delete process.env.DATA_FILE;

  process.env.SESSION_SECRET     = process.env.SESSION_SECRET     || 'test-secret-do-not-use-in-prod';
  process.env.NINETY_ADMIN_KEY   = process.env.NINETY_ADMIN_KEY   || 'test-admin-key';
  process.env.CRON_SECRET        = process.env.CRON_SECRET        || 'test-cron-secret';
  process.env.ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY  || 'test-anthropic-key';
  process.env.QBO_ENCRYPTION_KEY = process.env.QBO_ENCRYPTION_KEY
    || 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';

  app = require('../../server.js');
  const { __resetForTests } = require('../../database.js');

  asUser  = (userId) => `ninety_auth=${app.makeAuthCookie(userId)}`;
  ready   = () => app.dbReady;
  resetDb = __resetForTests;
}

module.exports = { PG_AVAILABLE, app, asUser, ready, resetDb };
