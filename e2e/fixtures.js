/* Shared Playwright fixtures.
 *
 * Mints an auth cookie matching the dev server's SESSION_SECRET (set in
 * playwright.config.js). Each `authedPage` fixture lands on a logged-in app
 * shell as user 1 (Logan, owner role) without going through Google OAuth.
 */

const { test: base, expect } = require('@playwright/test');
const crypto = require('crypto');

const SESSION_SECRET = 'test-secret-do-not-use-in-prod'; // matches webServer env
const COOKIE_NAME    = 'ninety_auth';
const MAX_AGE_MS     = 30 * 24 * 60 * 60 * 1000;

function makeAuthCookie(userId) {
  const now = Date.now();
  const payload = Buffer.from(JSON.stringify({
    userId, iat: now, exp: now + MAX_AGE_MS,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

const test = base.extend({
  /** A page with a valid signed auth cookie for user 1 (Logan, owner). */
  authedPage: async ({ context, baseURL }, use) => {
    await context.addCookies([{
      name: COOKIE_NAME,
      value: makeAuthCookie(1),
      url: baseURL,
      httpOnly: true,
      sameSite: 'Lax',
    }]);
    const page = await context.newPage();
    await use(page);
  },
});

module.exports = { test, expect, makeAuthCookie };
