/* Variant of boot.js that enables COACHING_ENABLED before server.js loads.
 *
 * Coaching routes are gated by `requireCoachingFlag`, which reads
 * COACHING_ENABLED at module-init time. Setting the env var here (rather than
 * in boot.js) keeps the regular middleware tests — which assert that coaching
 * routes 404 when the flag is off — working unchanged in their own worker.
 *
 * Each test file under `node --test` runs in its own worker process, so a file
 * that requires this helper gets its own server.js with COACHING_ENABLED=1
 * without polluting other test files.
 */

process.env.COACHING_ENABLED = 'true';
module.exports = require('./boot');
