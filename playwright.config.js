/* Playwright config — frontend e2e suite for the Express + vanilla-JS app.
 *
 * Boots its own dev server in JSON-fallback mode against a temp DATA_FILE so
 * runs don't touch the developer's local data.json.
 *
 * Run locally:
 *   npm run test:e2e
 *
 * The auth cookie (HMAC-signed by SESSION_SECRET) is minted in test fixtures
 * via app.makeAuthCookie() — bypasses Google OAuth entirely.
 */

const { defineConfig, devices } = require('@playwright/test');
const path = require('path');
const os   = require('os');
const crypto = require('crypto');

const PORT = 3100; // off the default to avoid clashing with `npm run dev`
const TMP_DATA_FILE = path.join(os.tmpdir(), `ninety-e2e-${crypto.randomBytes(6).toString('hex')}.json`);

module.exports = defineConfig({
  testDir: './e2e',
  fullyParallel: false,            // single dev server, single DB → serialize
  workers: 1,
  reporter: 'list',
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node server.js',
    port: PORT,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      PORT: String(PORT),
      DATA_FILE: TMP_DATA_FILE,
      SESSION_SECRET: 'test-secret-do-not-use-in-prod',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
