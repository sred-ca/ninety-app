/* Test boot helper.
 *
 * MUST be require'd before anything that loads server.js or database.js.
 * Sets a unique DATA_FILE per test-file process so the JSON fallback store
 * is isolated, then re-exports the Express app + a few utilities.
 *
 * Each test FILE runs in its own Node worker under `node --test`, so
 * module-level state in this file is safe to share within a file.
 */

const crypto = require('crypto');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

// 1. Pick a unique temp path for this worker's JSON store.
const tmpFile = path.join(os.tmpdir(), `ninety-test-${crypto.randomBytes(8).toString('hex')}.json`);
process.env.DATA_FILE = tmpFile;

// Make sure we're using JSON mode regardless of the host's env.
delete process.env.DATABASE_URL;
delete process.env.VERCEL;

// Stable signing secret so makeAuthCookie produces verifiable cookies.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-do-not-use-in-prod';

// Stable secrets for the admin / cron / Anthropic gates that some tests poke.
// Real values must be set in CI or prod via env — these defaults only matter
// when a test asserts on the gate's behavior with a known-good token.
process.env.NINETY_ADMIN_KEY = process.env.NINETY_ADMIN_KEY || 'test-admin-key';
process.env.CRON_SECRET      = process.env.CRON_SECRET      || 'test-cron-secret';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-anthropic-key';

// 32-byte base64 key for QB token AES-GCM tests. Must decode to exactly 32 bytes.
process.env.QBO_ENCRYPTION_KEY = process.env.QBO_ENCRYPTION_KEY
  || 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';

// 2. Load the app. Importing server.js immediately fires initDb() and
// captures the dbReady promise, which we re-export so tests can await it.
const app = require('../../server.js');
const { __resetForTests } = require('../../database.js');

// 3. Cleanup the temp file on worker exit.
process.on('exit', () => {
  try { fs.rmSync(tmpFile, { force: true }); } catch { /* best effort */ }
});

// 4. Helpers.
function asUser(userId) {
  return `ninety_auth=${app.makeAuthCookie(userId)}`;
}

async function ready() {
  await app.dbReady;
}

function resetDb() {
  __resetForTests();
}

module.exports = { app, asUser, ready, resetDb, tmpFile };
