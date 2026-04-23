/**
 * QuickBooks Online helpers — OAuth 2.0 + API base URL resolution.
 *
 * Keeps all Intuit-specific URLs, request shapes, and token handling out of
 * server.js. Tokens are stored by qbConnectionQueries; this module only
 * speaks to Intuit.
 */

const crypto = require('crypto');

const ENV           = (process.env.QBO_ENV || 'sandbox').toLowerCase();
const CLIENT_ID     = process.env.QBO_CLIENT_ID;
const CLIENT_SECRET = process.env.QBO_CLIENT_SECRET;
const REDIRECT_URI  = process.env.QBO_REDIRECT_URI || 'http://localhost:3000/auth/quickbooks/callback';

const AUTH_BASE  = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL  = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const API_BASE   = ENV === 'production'
  ? 'https://quickbooks.api.intuit.com'
  : 'https://sandbox-quickbooks.api.intuit.com';

// Minor version pinned. Intuit bumps this periodically and older versions
// sometimes lose fields — upgrade deliberately.
const MINOR_VERSION = '75';

function configured() {
  return !!(CLIENT_ID && CLIENT_SECRET);
}

function getAuthUrl(state) {
  if (!configured()) throw new Error('QBO_CLIENT_ID / QBO_CLIENT_SECRET not configured');
  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    response_type: 'code',
    scope:         'com.intuit.quickbooks.accounting',
    redirect_uri:  REDIRECT_URI,
    state,
  });
  return `${AUTH_BASE}?${params.toString()}`;
}

function makeState() {
  // CSRF token baked into the OAuth state param. Stored in a short-lived
  // cookie; the callback checks it matches before accepting the code.
  return crypto.randomBytes(16).toString('hex');
}

function basicAuthHeader() {
  return 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
}

async function exchangeCode(code) {
  if (!configured()) throw new Error('QBO credentials not configured');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept:         'application/json',
    },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  REDIRECT_URI,
    }).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`QB token exchange failed: ${res.status} ${JSON.stringify(body)}`);
  }
  return body; // { access_token, refresh_token, token_type, expires_in, x_refresh_token_expires_in }
}

async function refreshAccessToken(refresh_token) {
  if (!configured()) throw new Error('QBO credentials not configured');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept:         'application/json',
    },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token,
    }).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`QB refresh failed: ${res.status} ${JSON.stringify(body)}`);
  }
  return body;
}

// Returns an access_token guaranteed fresh (>60s remaining). Rotates the
// stored refresh_token (Intuit invalidates the old one on successful
// refresh). Call this right before any API request.
async function ensureFreshToken(conn, qbConnectionQueries) {
  const expiresAt = new Date(conn.access_token_expires_at).getTime();
  const now       = Date.now();
  const skewMs    = 60_000;
  if (expiresAt - now > skewMs) return { accessToken: conn.access_token, conn };

  const tokens = await refreshAccessToken(conn.refresh_token);
  const updated = await qbConnectionQueries.updateTokens(conn.id, {
    access_token:             tokens.access_token,
    refresh_token:            tokens.refresh_token,
    access_token_expires_at:  new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    refresh_token_expires_at: tokens.x_refresh_token_expires_in
      ? new Date(Date.now() + tokens.x_refresh_token_expires_in * 1000).toISOString()
      : null,
  });
  return { accessToken: tokens.access_token, conn: updated };
}

// GET helper scoped to a company/realm. Handles the 401-then-refresh retry
// in case the stored access_token was about to expire mid-flight.
async function apiGet(conn, qbConnectionQueries, path, queryParams = {}) {
  let { accessToken, conn: current } = await ensureFreshToken(conn, qbConnectionQueries);
  const params = new URLSearchParams({ ...queryParams, minorversion: MINOR_VERSION });
  const url = `${API_BASE}/v3/company/${current.realm_id}/${path}?${params.toString()}`;
  const doFetch = (token) => fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  let res = await doFetch(accessToken);
  if (res.status === 401) {
    // Force refresh + retry once
    const retry = await refreshAccessToken(current.refresh_token);
    current = await qbConnectionQueries.updateTokens(current.id, {
      access_token:             retry.access_token,
      refresh_token:            retry.refresh_token,
      access_token_expires_at:  new Date(Date.now() + retry.expires_in * 1000).toISOString(),
      refresh_token_expires_at: retry.x_refresh_token_expires_in
        ? new Date(Date.now() + retry.x_refresh_token_expires_in * 1000).toISOString()
        : null,
    });
    res = await doFetch(retry.access_token);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`QB API ${path} failed: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

module.exports = {
  ENV,
  REDIRECT_URI,
  configured,
  getAuthUrl,
  makeState,
  exchangeCode,
  refreshAccessToken,
  ensureFreshToken,
  apiGet,
};
