// Set OAuth env vars BEFORE requiring boot.js, since server.js captures them
// at module-init time. Each test file is its own worker, so these don't leak
// to other tests (e.g. quickbooks.test.js asserts on the unconfigured shape).
process.env.GOOGLE_CLIENT_ID     = 'test-google-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
process.env.QBO_CLIENT_ID        = 'test-qbo-client-id';
process.env.QBO_CLIENT_SECRET    = 'test-qbo-client-secret';
process.env.QBO_REDIRECT_URI     = 'http://localhost:3000/auth/quickbooks/callback';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, asUser, ready, resetDb } = require('../helpers/boot');

test.before(async () => { await ready(); });
test.beforeEach(() => { resetDb(); });

const OWNER  = 1;
const MEMBER = 2;

// ── /auth/google ────────────────────────────────────────────────────────

test('GET /auth/google — redirects to Google OAuth with required params', async () => {
  const res = await request(app).get('/auth/google').redirects(0);
  assert.equal(res.status, 302);
  const u = new URL(res.headers.location);
  assert.equal(u.origin, 'https://accounts.google.com');
  assert.equal(u.pathname, '/o/oauth2/v2/auth');
  assert.equal(u.searchParams.get('client_id'), 'test-google-client-id');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('scope'), 'openid email profile');
  // CSRF: state must be present in the URL.
  assert.ok(u.searchParams.get('state'));
});

test('GET /auth/google — sets a short-lived state cookie matching the URL state', async () => {
  const res = await request(app).get('/auth/google').redirects(0);
  const setCookie = res.headers['set-cookie'][0];
  assert.match(setCookie, /goog_oauth_state=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);

  // The state in the URL must equal the state in the cookie — that's the
  // whole CSRF defense.
  const cookieState = setCookie.match(/goog_oauth_state=([^;]+)/)[1];
  const urlState    = new URL(res.headers.location).searchParams.get('state');
  assert.equal(cookieState, urlState);
});

// ── /auth/logout ────────────────────────────────────────────────────────

test('GET /auth/logout — redirects to / and clears the auth cookie', async () => {
  const res = await request(app).get('/auth/logout').redirects(0);
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/');

  // Express's res.clearCookie sends Set-Cookie with an expired Expires.
  const setCookie = res.headers['set-cookie'][0];
  assert.match(setCookie, /ninety_auth=/);
  // Either an explicit expiry in the past, or Max-Age=0.
  assert.ok(/Expires=Thu, 01 Jan 1970/.test(setCookie) || /Max-Age=0/.test(setCookie),
    'logout must mark the cookie as expired');
});

// ── /auth/quickbooks (redirect half) ────────────────────────────────────

test('GET /auth/quickbooks — unauthenticated user is bounced to /', async () => {
  const res = await request(app).get('/auth/quickbooks').redirects(0);
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/');
});

test('GET /auth/quickbooks — non-owner is bounced with qb_forbidden', async () => {
  const res = await request(app)
    .get('/auth/quickbooks').set('Cookie', asUser(MEMBER)).redirects(0);
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /qb_forbidden/);
});

test('GET /auth/quickbooks — owner is redirected to Intuit with state cookie', async () => {
  const res = await request(app)
    .get('/auth/quickbooks').set('Cookie', asUser(OWNER)).redirects(0);
  assert.equal(res.status, 302);
  const u = new URL(res.headers.location);
  assert.equal(u.origin, 'https://appcenter.intuit.com');
  assert.equal(u.searchParams.get('client_id'), 'test-qbo-client-id');
  assert.ok(u.searchParams.get('state'), 'state must be present in the URL');

  const setCookie = res.headers['set-cookie'][0];
  assert.match(setCookie, /qb_oauth_state=/);
  assert.match(setCookie, /HttpOnly/i);
});

// ── /auth/quickbooks/callback (CSRF + missing-params guards) ────────────

test('GET /auth/quickbooks/callback — error param redirects to qb_denied', async () => {
  const res = await request(app)
    .get('/auth/quickbooks/callback?error=access_denied').redirects(0);
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /qb_denied/);
});

test('GET /auth/quickbooks/callback — missing required params redirects', async () => {
  const res = await request(app)
    .get('/auth/quickbooks/callback?code=abc').redirects(0);  // no state, no realmId
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /qb_missing_params/);
});

test('GET /auth/quickbooks/callback — state mismatch is rejected (CSRF guard)', async () => {
  const res = await request(app)
    .get('/auth/quickbooks/callback?code=abc&state=fromAttacker&realmId=123')
    .set('Cookie', 'qb_oauth_state=ourLegitState')
    .redirects(0);
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /qb_state_mismatch/);
});
