const express    = require('express');
const path       = require('path');
const crypto     = require('crypto');
const { initDb, userQueries, rockQueries, issueQueries, agendaQueries, meetingQueries, teamIssueQueries, milestoneQueries, coachingQueries, vtoQueries, budgetQueries, qbConnectionQueries, tabAccessQueries } = require('./database');
const qb = require('./qb');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Stateless HMAC-signed cookie auth ────────────────────────────────────────
// No session store needed — userId is signed with a secret and stored in a
// cookie. Works reliably in serverless environments (no DB round-trip for auth).
const COOKIE_NAME = 'ninety_auth';
// Refuse to boot in production without a real SESSION_SECRET. Without this
// guard, a misconfigured prod deploy would silently sign cookies with the
// publicly-visible dev fallback string, letting anyone forge a session.
const IS_PROD = !!process.env.VERCEL || process.env.NODE_ENV === 'production';
if (IS_PROD && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set in production. Refusing to boot with the dev fallback secret.');
}
// QB tokens stored in the DB are AES-256-GCM encrypted with this key.
// Required whenever QuickBooks credentials are configured — otherwise a
// future deploy could silently store fresh tokens in plaintext.
if (IS_PROD && process.env.QBO_CLIENT_ID && !process.env.QBO_ENCRYPTION_KEY) {
  throw new Error('QBO_ENCRYPTION_KEY must be set when QuickBooks is configured. Refusing to boot.');
}
const COOKIE_SECRET = process.env.SESSION_SECRET || 'ninety-dev-secret-change-me';

// Server-side cookie lifetime (must match the cookie's maxAge below). The
// signed payload carries an `exp` claim so a leaked cookie value is invalid
// after this window even if SESSION_SECRET hasn't been rotated.
const AUTH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function makeAuthCookie(userId) {
  const now = Date.now();
  const payload = Buffer.from(JSON.stringify({
    userId, iat: now, exp: now + AUTH_COOKIE_MAX_AGE_MS,
  })).toString('base64url');
  const sig     = crypto.createHmac('sha256', COOKIE_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function readAuthCookie(req) {
  const raw   = req.headers.cookie || '';
  const match = raw.match(/(?:^|;)\s*ninety_auth=([^;]+)/);
  if (!match) return null;
  const [payload, sig] = decodeURIComponent(match[1]).split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', COOKIE_SECRET).update(payload).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'base64url'), Buffer.from(expected, 'base64url'))) return null;
  } catch { return null; }
  let parsed;
  try { parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()); }
  catch { return null; }
  // Reject expired cookies. Pre-exp-claim cookies (legacy sessions) lack the
  // field — those continue to work until the user re-signs in, then upgrade.
  if (parsed && parsed.exp && Date.now() > parsed.exp) return null;
  return parsed;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const ok   = (res, data) => res.json({ ok: true, data });
const fail = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });
const wrap = (fn) => async (req, res) => {
  // On cold serverless starts, migrations in initDb() can still be in flight
  // when the first request arrives. Await dbReady so column adds finish first.
  // Unexpected errors get logged server-side; the client gets a generic
  // message so DB constraint text / stack traces don't leak to the browser.
  try { await dbReady; await fn(req, res); }
  catch (e) { console.error(e); if (!res.headersSent) fail(res, 'Internal server error', 500); }
};

// Require a signed auth cookie on any /api/* route that mutates data or reads
// something private. /api/me and the OAuth callbacks opt out.
function requireAuth(req, res, next) {
  const auth = readAuthCookie(req);
  if (!auth || !auth.userId) return fail(res, 'not authenticated', 401);
  req.userId = auth.userId;
  next();
}

// Gate routes behind the 'owner' role. Runs after requireAuth — looks up the
// user fresh each call so role changes take effect without re-login.
function requireOwner(req, res, next) {
  (async () => {
    try {
      await dbReady;
      const u = await userQueries.getById(req.userId);
      if (!u || u.role !== 'owner') return fail(res, 'forbidden', 403);
      req.userRole = u.role;
      next();
    } catch (e) { console.error(e); fail(res, 'Internal server error', 500); }
  })();
}

// Tiny value whitelist helper used by route handlers to reject unknown enum
// values before they reach the query layer.
function allow(value, allowed) {
  return value === undefined || value === null || allowed.includes(value);
}
const STATUS_ISSUE   = ['in_progress', 'waiting_for', 'blocker', 'solved'];
const STATUS_ROCK    = ['not_started', 'on_track', 'off_track', 'done'];
const STATUS_MEETING = ['upcoming', 'in_progress', 'completed'];
const PRIORITY_VALS  = ['low', 'medium', 'high'];
const HORIZON_VALS   = ['short_term', 'long_term'];

// ── Google OAuth ─────────────────────────────────────────────────────────────
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI ||
  `http://localhost:${PORT}/auth/google/callback`;
const ALLOWED_DOMAIN       = 'sred.ca';

// Short-lived signed cookie carrying the CSRF state for the Google OAuth
// round-trip. Same pattern as the QuickBooks flow further down.
const GOOG_STATE_COOKIE = 'goog_oauth_state';

// Step 1 — redirect to Google
app.get('/auth/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID) {
    return res.status(500).send('GOOGLE_CLIENT_ID is not configured');
  }
  const state = crypto.randomBytes(24).toString('base64url');
  res.cookie(GOOG_STATE_COOKIE, state, {
    httpOnly: true,
    secure:   IS_PROD,
    sameSite: 'lax',
    maxAge:   10 * 60 * 1000, // 10 min — enough for slow MFA
  });
  const params = new URLSearchParams({
    client_id:     GOOGLE_CLIENT_ID,
    redirect_uri:  GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope:         'openid email profile',
    access_type:   'online',
    prompt:        'select_account',
    state,
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// Step 2 — handle callback
app.get('/auth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error || !code) return res.redirect('/?error=cancelled');

  // CSRF: state from Google must match the cookie we set in step 1. Without
  // this, an attacker could trick a victim into completing a code-grant flow
  // for the attacker's email and end up signed in as the attacker.
  const cookieRaw = req.headers.cookie || '';
  const stateMatch = cookieRaw.match(/(?:^|;)\s*goog_oauth_state=([^;]+)/);
  const cookieState = stateMatch ? decodeURIComponent(stateMatch[1]) : null;
  if (!cookieState || !state || cookieState !== state) {
    res.clearCookie(GOOG_STATE_COOKIE);
    console.error('OAuth state mismatch');
    return res.redirect('/?error=state_mismatch');
  }
  res.clearCookie(GOOG_STATE_COOKIE);

  try {
    // Exchange code → tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri:  GOOGLE_REDIRECT_URI,
        grant_type:    'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) {
      console.error('Token exchange failed:', JSON.stringify(tokens));
      return res.redirect('/?error=token_exchange');
    }

    // Get Google profile
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();
    console.log('OAuth profile:', profile.email);

    // Require Google to have actually verified the email. Without this gate
    // an unverified Workspace alias / external IdP federation could pass the
    // domain check below with an attacker-controlled email.
    if (!profile.verified_email) {
      console.error('Unverified email:', profile.email);
      return res.redirect('/?error=unverified_email');
    }

    // Enforce @sred.ca domain
    if (!profile.email || !profile.email.endsWith(`@${ALLOWED_DOMAIN}`)) {
      console.error('Unauthorized email:', profile.email);
      return res.redirect('/?error=unauthorized');
    }

    // Find or create user in DB (wait for cold-start migrations first)
    await dbReady;
    const user = await userQueries.findOrCreateByEmail(profile.email, profile.name, profile.picture);

    // Set stateless HMAC-signed cookie (works in serverless — no session store needed)
    res.cookie(COOKIE_NAME, makeAuthCookie(user.id), {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: 'lax',
      maxAge: AUTH_COOKIE_MAX_AGE_MS,
    });
    res.redirect('/');
  } catch (e) {
    console.error('OAuth callback error:', e);
    res.redirect('/?error=server_error');
  }
});

// Which sidebar tabs are not default-on for members and can be granted by
// owners via the Admin view. Must match the list the frontend renders.
// Rocks is a default tab (everyone sees it); it's not assignable.
const ASSIGNABLE_TABS = ['vto', 'budget', 'stella'];

// Who am I? Includes role so the frontend can gate owner-only UI, plus the
// set of assignable tabs this user can see (owners implicitly get all).
app.get('/api/me', wrap(async (req, res) => {
  const auth = readAuthCookie(req);
  if (!auth) return ok(res, null);
  const user = await userQueries.getById(auth.userId);
  if (!user) return ok(res, null);
  const role  = user.role || 'member';
  const tabs  = role === 'owner'
    ? ASSIGNABLE_TABS.slice()
    : (await tabAccessQueries.listForUser(user.id)).filter(t => ASSIGNABLE_TABS.includes(t));
  ok(res, { ...user, role, tabs });
}));

// Logout
app.get('/auth/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.redirect('/');
});

// ── QuickBooks OAuth 2.0 ─────────────────────────────────────────────────────
// Intuit redirects back with ?code=...&state=...&realmId=... Code is
// exchanged for access + refresh tokens (server-to-server, client_secret
// required), which are stored keyed by realmId. Stateless CSRF check: we
// sign the state value as a short-lived cookie; callback verifies it matches.
const QB_STATE_COOKIE = 'qb_oauth_state';

app.get('/auth/quickbooks', (req, res) => {
  // Only owners can connect QB — signed-in user must be an owner.
  const auth = readAuthCookie(req);
  if (!auth || !auth.userId) return res.redirect('/');
  (async () => {
    try {
      await dbReady;
      const u = await userQueries.getById(auth.userId);
      if (!u || u.role !== 'owner') return res.redirect('/?error=qb_forbidden');
      if (!qb.configured()) return res.redirect('/?error=qb_not_configured');
      const state = qb.makeState();
      res.cookie(QB_STATE_COOKIE, state, {
        httpOnly: true,
        secure:   IS_PROD,
        sameSite: 'lax',
        maxAge:   10 * 60 * 1000, // 10 min
      });
      res.redirect(qb.getAuthUrl(state));
    } catch (e) {
      console.error('QB connect failed:', e);
      res.redirect('/?error=qb_server_error');
    }
  })();
});

app.get('/auth/quickbooks/callback', (req, res) => {
  const { code, state, realmId, error } = req.query;
  if (error)                   return res.redirect('/?error=qb_denied');
  if (!code || !state || !realmId) return res.redirect('/?error=qb_missing_params');

  // CSRF check
  const raw = req.headers.cookie || '';
  const match = raw.match(/(?:^|;)\s*qb_oauth_state=([^;]+)/);
  const cookieState = match ? decodeURIComponent(match[1]) : null;
  if (!cookieState || cookieState !== state) return res.redirect('/?error=qb_state_mismatch');
  res.clearCookie(QB_STATE_COOKIE);

  // Must be an owner (checked again — the connect-start already enforced it,
  // but someone could land on the callback via a stale session).
  const auth = readAuthCookie(req);
  if (!auth || !auth.userId) return res.redirect('/?error=qb_no_session');

  (async () => {
    try {
      await dbReady;
      const u = await userQueries.getById(auth.userId);
      if (!u || u.role !== 'owner') return res.redirect('/?error=qb_forbidden');

      const tokens = await qb.exchangeCode(code);
      const accessExpiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
      const refreshExpiresAt = tokens.x_refresh_token_expires_in
        ? new Date(Date.now() + tokens.x_refresh_token_expires_in * 1000).toISOString()
        : null;
      await qbConnectionQueries.upsert({
        realm_id:                 String(realmId),
        access_token:             tokens.access_token,
        refresh_token:            tokens.refresh_token,
        access_token_expires_at:  accessExpiresAt,
        refresh_token_expires_at: refreshExpiresAt,
        connected_by_user_id:     auth.userId,
      });
      res.redirect('/?qb=connected');
    } catch (e) {
      console.error('QB callback failed:', e);
      res.redirect('/?error=qb_token_exchange');
    }
  })();
});

// ── Coaching integration (Stella) ────────────────────────────────────────────
// Write endpoints (POST calls, GET context) are called by Stella's back-end.
// They carry two pieces of auth:
//   - Bearer <NINETY_ADMIN_KEY>       — proves the caller is Stella, not a user
//   - X-Coaching-User-Id: <id>        — identifies which Ninety user the call
//                                       belongs to (phone→user lookup on their side)
// Registered BEFORE the /api cookie gate so external services skip the session
// auth. Backward compat: NINETY_API_KEY is still accepted as an alias for
// NINETY_ADMIN_KEY, and NINETY_COACHING_USER_EMAIL still resolves the user if
// no header is passed — both get dropped in a later phase.
const COACHING_ENABLED       = process.env.COACHING_ENABLED === 'true';
const NINETY_ADMIN_KEY       = process.env.NINETY_ADMIN_KEY || process.env.NINETY_API_KEY;
const LEGACY_USER_EMAIL      = process.env.NINETY_COACHING_USER_EMAIL;

function requireCoachingFlag(req, res, next) {
  if (!COACHING_ENABLED) return fail(res, 'Not found', 404);
  next();
}
function requireAdminKey(req, res, next) {
  if (!NINETY_ADMIN_KEY) return fail(res, 'Coaching admin key not configured', 500);
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  const a = Buffer.from(token);
  const b = Buffer.from(NINETY_ADMIN_KEY);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return fail(res, 'Unauthorized', 401);
  next();
}

// Resolves the Ninety user this coaching request is for.
// Preferred: X-Coaching-User-Id header (Stella's phone→user lookup).
// Fallback: NINETY_COACHING_USER_EMAIL env var (legacy Phase 1 single-user).
// Returns the user id, or null after writing an error response.
async function resolveCoachingTarget(req, res) {
  const headerId = req.headers['x-coaching-user-id'];
  if (headerId) {
    const u = await userQueries.getById(headerId);
    if (!u) { fail(res, 'Unknown coaching user', 404); return null; }
    if (!u.coaching_enabled) { fail(res, 'Coaching not enabled for this user', 403); return null; }
    return u.id;
  }
  if (LEGACY_USER_EMAIL) {
    const u = await userQueries.findOrCreateByEmail(LEGACY_USER_EMAIL, 'Jude');
    return u.id;
  }
  fail(res, 'X-Coaching-User-Id header is required', 400);
  return null;
}

app.post('/api/coaching/calls', requireCoachingFlag, requireAdminKey, wrap(async (req, res) => {
  const userId = await resolveCoachingTarget(req, res); if (userId == null) return;
  const { summary, gratitude, transcript, commitments, call_date, external_id } = req.body || {};
  if (!Array.isArray(commitments)) return fail(res, 'commitments must be an array');
  if (call_date && !/^\d{4}-\d{2}-\d{2}$/.test(call_date)) {
    return fail(res, 'call_date must be YYYY-MM-DD');
  }
  // Optional idempotency key — when present, a retry of the same webhook
  // resolves to the existing call instead of creating a duplicate. Stella's
  // backend can pass e.g. its VAPI call session id here. If absent, behavior
  // is unchanged from the pre-idempotency days.
  if (external_id != null && (typeof external_id !== 'string' || !external_id.trim())) {
    return fail(res, 'external_id must be a non-empty string');
  }
  ok(res, await coachingQueries.createCall({
    user_id: userId, summary, gratitude, transcript, commitments, call_date,
    external_id: external_id ? external_id.trim() : undefined,
  }));
}));

app.get('/api/coaching/context', requireCoachingFlag, requireAdminKey, wrap(async (req, res) => {
  const userId = await resolveCoachingTarget(req, res); if (userId == null) return;
  ok(res, await coachingQueries.getContext(userId));
}));

// Admin-scoped phone lookup. Stella uses this at call start to identify the
// caller. Returns 404 if the phone isn't registered or coaching is disabled
// for that user — which signals Stella to play the "talk to your admin"
// message and hang up.
app.get('/api/coaching/user-by-phone', requireCoachingFlag, requireAdminKey, wrap(async (req, res) => {
  const phone = (req.query.phone || '').trim();
  if (!phone) return fail(res, 'phone is required');
  const u = await userQueries.getByCoachingPhone(phone);
  if (!u || !u.coaching_enabled) return fail(res, 'Not found', 404);
  ok(res, { user_id: u.id, name: u.name });
}));

// Admin list of enabled coaching users. Used by the pre-call cron to iterate
// and build per-user prompts.
app.get('/api/coaching/enabled-users', requireCoachingFlag, requireAdminKey, wrap(async (req, res) => {
  ok(res, await coachingQueries.listEnabledUsers());
}));

// Admin: correct a stored call_date. Needed because early calls stored UTC
// CURRENT_DATE which bleeds into the caller's tomorrow for late-evening calls.
app.put('/api/coaching/admin/calls/:id/date', requireCoachingFlag, requireAdminKey, wrap(async (req, res) => {
  const { call_date } = req.body || {};
  if (!call_date || !/^\d{4}-\d{2}-\d{2}$/.test(call_date)) {
    return fail(res, 'call_date (YYYY-MM-DD) is required');
  }
  ok(res, await coachingQueries.updateCallDate(req.params.id, call_date));
}));

// Admin-scoped stats + recent-call listing for a specific user. Operational
// diagnostic endpoint (check whether a user's calls landed, what their streak
// is computed as, etc.). Bypasses the enabled check used by write paths so
// operators can inspect disabled/stale accounts.
app.get('/api/coaching/admin/user-state', requireCoachingFlag, requireAdminKey, wrap(async (req, res) => {
  const userId = +(req.headers['x-coaching-user-id'] || req.query.user_id || 0);
  if (!userId) return fail(res, 'X-Coaching-User-Id (or ?user_id=) is required');
  const user = await userQueries.getById(userId);
  if (!user) return fail(res, 'Unknown user', 404);
  const [stats, recent] = await Promise.all([
    coachingQueries.getStats(userId),
    coachingQueries.listCalls(userId, 20, 0),
  ]);
  ok(res, {
    user: { id: user.id, name: user.name, email: user.email,
            coaching_enabled: user.coaching_enabled, coaching_phone: user.coaching_phone },
    stats,
    recent,
  });
}));

// Admin V/TO update (admin-key auth, no session). Mirrors PUT /api/vto.
// Used for bulk content updates from CLI / external tooling.
app.put('/api/admin/vto', requireAdminKey, wrap(async (req, res) => {
  ok(res, await vtoQueries.update(req.body || {}));
}));

// Admin create-team-issue (admin-key auth, no session). Mirrors POST /api/team-issues.
app.post('/api/admin/team-issues', requireAdminKey, wrap(async (req, res) => {
  const { title, description, horizon, owner_id } = req.body || {};
  if (!title) return fail(res, 'title is required');
  if (horizon && !['short_term','long_term'].includes(horizon)) {
    return fail(res, 'horizon must be short_term or long_term');
  }
  ok(res, await teamIssueQueries.create({ title, description, owner_id, horizon }));
}));

// Pre-call builder pushes each user's rendered Stella system prompt here.
// The prompt is a single string (the full system message), built per-user
// from their markdown journal / commitments / wins / themes / personality.
app.put('/api/coaching/assistant-prompt', requireCoachingFlag, requireAdminKey, wrap(async (req, res) => {
  const userId = await resolveCoachingTarget(req, res); if (userId == null) return;
  const { system_prompt } = req.body || {};
  if (!system_prompt || typeof system_prompt !== 'string') {
    return fail(res, 'system_prompt (string) is required');
  }
  await coachingQueries.setAssistantPrompt(userId, system_prompt);
  ok(res, { updated: true });
}));

// VAPI assistant-request webhook. VAPI hits this at inbound call start with
// the caller's number; we look up the user, fetch their stored prompt, and
// return an assistant override so Stella greets and remembers the right
// person. Unknown callers get a short "contact your admin" handoff and the
// call is ended server-side by VAPI.
app.post('/api/coaching/vapi-assistant-request', requireCoachingFlag, requireAdminKey, wrap(async (req, res) => {
  // VAPI webhook payload shape:
  //   { message: { type: 'assistant-request', call: { customer: { number: '+1...' } } } }
  const msg    = req.body?.message || req.body || {};
  const call   = msg.call || {};
  const phone  = call.customer?.number || call.from || null;

  const handoff = {
    assistant: {
      firstMessage: "I don't have you set up yet — please reach out to your admin to get started. Goodbye.",
      endCallPhrases: ['goodbye']
    }
  };
  if (!phone) return res.json(handoff);

  const u = await userQueries.getByCoachingPhone(phone);
  if (!u || !u.coaching_enabled) return res.json(handoff);

  const p = await coachingQueries.getAssistantPrompt(u.id);
  if (!p) return res.json(handoff);  // no prompt built yet

  // VAPI accepts `assistantOverrides` to layer on top of a base assistant.
  // We only override the system message; voice, tools, and other config are
  // left to the base Stella assistant.
  res.json({
    assistantOverrides: {
      model: {
        messages: [{ role: 'system', content: p.system_prompt }]
      },
      // Keep metadata handy if VAPI logs it
      metadata: { coaching_user_id: u.id, coaching_user_name: u.name }
    }
  });
}));

// ── Coaching strategic read endpoints (admin-key auth) ───────────────────────
// Admin-keyed READ access to the strategic surface — Rocks, Issues (non-
// private), Team Issues, and Rock milestones. Used by external coaches
// (e.g. Roy / BusinessCoach) that need the full company view, not just the
// scoped slice returned by /api/coaching/context. Writes stay cookie-gated
// below the /api auth line — these endpoints are read-only by design.
//
// Private issues are filtered out (uid=0 never matches a real owner), so an
// admin-keyed caller only sees strategic, non-personal issues.
app.get('/api/coaching/rocks', requireCoachingFlag, requireAdminKey, wrap(async (req, res) => {
  ok(res, await rockQueries.getAll(req.query.quarter));
}));
app.get('/api/coaching/rocks/quarters', requireCoachingFlag, requireAdminKey, wrap(async (req, res) => {
  ok(res, await rockQueries.quarters());
}));
app.get('/api/coaching/rocks/:rockId/milestones', requireCoachingFlag, requireAdminKey, wrap(async (req, res) => {
  ok(res, await milestoneQueries.getByRock(req.params.rockId));
}));
app.get('/api/coaching/issues', requireCoachingFlag, requireAdminKey, wrap(async (req, res) => {
  const includeArchived = req.query.include_archived === '1' || req.query.include_archived === 'true';
  ok(res, await issueQueries.getAll(req.query.status, 0, includeArchived));
}));
app.get('/api/coaching/team-issues', requireCoachingFlag, requireAdminKey, wrap(async (req, res) => {
  const includeArchived = req.query.include_archived === '1' || req.query.include_archived === 'true';
  ok(res, await teamIssueQueries.getAll({
    horizon: req.query.horizon || undefined,
    status:  req.query.status  || undefined,
    includeArchived,
  }));
}));

// Admin-keyed read of a user's coaching call timeline. Mirrors the cookie-
// gated /api/coaching/calls (which scopes to req.userId) but takes the user
// via the X-Coaching-User-Id header so external coaches (e.g. Roy reading
// Stella's diary themes) can pull another user's call history.
app.get('/api/coaching/calls-by-user', requireCoachingFlag, requireAdminKey, wrap(async (req, res) => {
  const userId = await resolveCoachingTarget(req, res); if (userId == null) return;
  const limit  = Math.min(Math.max(+req.query.limit  || 20, 1), 100);
  const offset = Math.max(+req.query.offset || 0, 0);
  ok(res, await coachingQueries.listCalls(userId, limit, offset));
}));

// ── Cron jobs (Vercel Cron; authed via Bearer CRON_SECRET) ───────────────────
// Registered before the /api cookie gate so Vercel's cron invocation can
// reach it without a session.
function requireCronSecret(req, res, next) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return fail(res, 'CRON_SECRET not configured', 500);
  const got = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  // Constant-time compare so the byte-by-byte timing of `===` doesn't leak
  // the secret prefix to an attacker hitting this endpoint repeatedly.
  const a = Buffer.from(got);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return fail(res, 'Unauthorized', 401);
  next();
}
app.get('/api/cron/promote-milestones', requireCronSecret, wrap(async (req, res) => {
  ok(res, await milestoneQueries.promoteDue());
}));

// Everything below this line requires a signed auth cookie. /api/me above
// opts out because it legitimately needs to return null for logged-out users.
app.use('/api', requireAuth);

// ── Users ────────────────────────────────────────────────────────────────────
// GET stays member-readable (team picker, owner filter, etc.).
// Mutations are owner-only — without this gate any signed-in member could
// rename or delete Logan/Jude.
app.get('/api/users', wrap(async (req, res) => ok(res, await userQueries.getAll())));
app.post('/api/users', requireOwner, wrap(async (req, res) => {
  const { name, color } = req.body;
  if (!name) return fail(res, 'name is required');
  ok(res, await userQueries.create(name.trim(), color));
}));
app.put('/api/users/:id', requireOwner, wrap(async (req, res) => {
  const { name, color } = req.body;
  if (!name) return fail(res, 'name is required');
  ok(res, await userQueries.update(req.params.id, name.trim(), color));
}));
app.delete('/api/users/:id', requireOwner, wrap(async (req, res) => {
  await userQueries.delete(req.params.id);
  ok(res, { deleted: true });
}));

// ── Admin: per-user sidebar tab access (owner-only) ─────────────────────────
// GET returns each user's role + granted assignable tabs. Owners implicitly
// see all assignable tabs — their `tabs` is reported as the full list for
// display consistency, but the database row count stays zero.
app.get('/api/admin/tab-access', requireOwner, wrap(async (req, res) => {
  const [users, allGrants] = await Promise.all([
    // Owner-only matrix needs email + role; the public getAll projects them out.
    userQueries.getAllForAdmin(),
    tabAccessQueries.listAll(),
  ]);
  const out = users.map(u => {
    const role = u.role || 'member';
    const granted = (allGrants[u.id] || []).filter(t => ASSIGNABLE_TABS.includes(t));
    return {
      id: u.id, name: u.name, email: u.email, role,
      tabs: role === 'owner' ? ASSIGNABLE_TABS.slice() : granted,
    };
  });
  ok(res, { assignable_tabs: ASSIGNABLE_TABS, users: out });
}));
app.put('/api/admin/tab-access/:userId', requireOwner, wrap(async (req, res) => {
  const tabs = Array.isArray(req.body?.tabs) ? req.body.tabs : null;
  if (!tabs) return fail(res, 'tabs must be an array');
  const bad = tabs.find(t => !ASSIGNABLE_TABS.includes(t));
  if (bad) return fail(res, `unknown tab: ${bad}. Must be one of ${ASSIGNABLE_TABS.join(', ')}`);
  const granted = await tabAccessQueries.set(req.params.userId, tabs);
  ok(res, { user_id: +req.params.userId, tabs: granted });
}));
const ROLES = ['owner', 'member'];
app.put('/api/admin/users/:userId/role', requireOwner, wrap(async (req, res) => {
  const role = req.body?.role;
  if (!ROLES.includes(role)) return fail(res, `role must be one of ${ROLES.join(', ')}`);
  const target = await userQueries.getById(req.params.userId);
  if (!target) return fail(res, 'user not found', 404);
  // Pre-check stays for a friendly 400 before touching the DB; setRole
  // also enforces atomically as a race-safe safety net.
  if (role === 'member' && (target.role || 'member') === 'owner') {
    const owners = await userQueries.countOwners();
    if (owners <= 1) return fail(res, 'Cannot demote the last owner — promote another user first.');
  }
  try {
    const updated = await userQueries.setRole(req.params.userId, role);
    if (!updated) return fail(res, 'user not found', 404);
    ok(res, { id: updated.id, role: updated.role });
  } catch (e) {
    if (e && e.code === 'LAST_OWNER') return fail(res, e.message);
    throw e;
  }
}));

// ── Budget (owner-only) ─────────────────────────────────────────────────────
// Three routes: list, upsert budget cell (user edit), and line CRUD. Actuals
// are not touched here — they come from the QB sync job. All gated by
// requireOwner so non-owner staff can't read or write the budget.
const BUDGET_SECTIONS = ['income', 'cogs', 'opex', 'other'];
app.get('/api/budget', requireOwner, wrap(async (req, res) => {
  ok(res, await budgetQueries.getAll(req.query.fiscal_year || 'FY27'));
}));
app.post('/api/budget/lines', requireOwner, wrap(async (req, res) => {
  const { fiscal_year, section, category, sort_order, qb_account_id, notes } = req.body || {};
  if (!fiscal_year) return fail(res, 'fiscal_year is required');
  if (!category)    return fail(res, 'category is required');
  if (!allow(section, BUDGET_SECTIONS)) return fail(res, `section must be one of ${BUDGET_SECTIONS.join(', ')}`);
  ok(res, await budgetQueries.createLine({ fiscal_year, section, category, sort_order, qb_account_id, notes }));
}));
app.put('/api/budget/lines/:id', requireOwner, wrap(async (req, res) => {
  if (!allow(req.body.section, BUDGET_SECTIONS)) return fail(res, `section must be one of ${BUDGET_SECTIONS.join(', ')}`);
  ok(res, await budgetQueries.updateLine(req.params.id, req.body));
}));
app.delete('/api/budget/lines/:id', requireOwner, wrap(async (req, res) => {
  await budgetQueries.deleteLine(req.params.id);
  ok(res, { deleted: true });
}));
app.put('/api/budget/cells', requireOwner, wrap(async (req, res) => {
  const { line_id, period_date, budget_amount } = req.body || {};
  if (!line_id || !period_date) return fail(res, 'line_id and period_date are required');
  const amt = Number(budget_amount);
  if (!Number.isFinite(amt)) return fail(res, 'budget_amount must be a number');
  ok(res, await budgetQueries.upsertCell({ line_id, period_date, budget_amount: amt }));
}));

// QuickBooks connection status + disconnect (owner-only). Never returns
// tokens — just the "are we connected" summary the UI needs.
app.get('/api/quickbooks/status', requireOwner, wrap(async (req, res) => {
  if (!qb.configured()) {
    return ok(res, { configured: false, connected: false });
  }
  const conn = await qbConnectionQueries.getActive();
  if (!conn) return ok(res, { configured: true, connected: false, env: qb.ENV });
  ok(res, {
    configured:     true,
    connected:      true,
    env:            qb.ENV,
    realm_id:       conn.realm_id,
    last_synced_at: conn.last_synced_at,
    connected_at:   conn.created_at,
  });
}));
app.post('/api/quickbooks/disconnect', requireOwner, wrap(async (req, res) => {
  await qbConnectionQueries.disconnect();
  ok(res, { disconnected: true });
}));

// List the QB company's chart of accounts. Used by the mapping UI to populate
// a dropdown so owners can pick which QB account feeds each budget line.
app.get('/api/quickbooks/accounts', requireOwner, wrap(async (req, res) => {
  const conn = await qbConnectionQueries.getActive();
  if (!conn) return fail(res, 'QuickBooks not connected', 400);
  ok(res, await qb.fetchAccounts(conn, qbConnectionQueries));
}));

// Best-effort auto-mapping of budget lines to QB accounts. Writes
// qb_account_id for every confident match; leaves ambiguous or missing
// lines for the user to resolve manually. The match table is hard-coded
// from the FY26 P&L account names — fuzzy matching alone would be less
// predictable here because many budget lines collapse onto a single QB
// account (e.g., everyone is in "Wages"). Lines that already have a
// qb_account_id are skipped so owner choices are preserved; re-running
// is safe.
app.post('/api/quickbooks/auto-map', requireOwner, wrap(async (req, res) => {
  const conn = await qbConnectionQueries.getActive();
  if (!conn) return fail(res, 'QuickBooks not connected', 400);
  const fiscalYear = (req.body && req.body.fiscal_year) || 'FY27';

  // category (lowercase) → list of keywords; first keyword to match an
  // account name (case-insensitive substring) wins.
  const MATCH_RULES = {
    'full-service new (claim fees)':       ['sales'],
    'consulting expense':                  ['consulting expense'],
    'pm payroll (production-related)':     ['wages'],
    'software service costs (35%)':        ['software service'],
    'marketing — google ads':              ['advertising'],
    'marketing — events':                  ['marketing'],
    'professional fees — legal':           ['legal and professional'],
    'travel':                              ['travel'],
    'office & admin':                      ['office expense'],
    'bank fees & interest':                ['bank charges'],
    'rent':                                ['rent or lease', 'rent'],
  };
  // Lines we deliberately don't auto-map — they'd either clash with
  // another budget line on the same QB account, or the matching QB
  // account doesn't exist yet.
  const AMBIGUOUS = {
    'full-service renewals':               'QB has a single "Sales" account — add a sub-account or class for renewals.',
    'mrr subscription':                    'QB has a single "Sales" account — add a sub-account or use "Other income" in QB.',
    'other income':                        'No matching QB account; add one or leave $0.',
    'owner market salary (jude + logan)':  'Owner comp is inside "Wages" — split in QB or accept that PM payroll line carries all wages.',
    'staff — sales (evan)':                "Evan's wages are inside QB 'Wages' — split in QB first.",
    'staff — pm (james, non-production)':  'James is fully in COGS — line intentionally $0 and unmapped.',
    'staff — platform (mike, non-prod)':   'Mike is fully in COGS — line intentionally $0 and unmapped.',
    'marketing — partnerships':            'Shares QB "Marketing" account with Content + Events — split in QB first.',
    'marketing — content / ai search':     'Shares QB "Marketing" account — split in QB first.',
    'professional fees — accounting':      'Shares QB "Legal and professional fees" with Legal — split in QB first.',
    'insurance':                           'No Insurance account in FY26 P&L — add one when you start billing it.',
    'software — saas tools':               'Shares QB "Software service costs" with Infrastructure — split in QB first.',
    'software — infrastructure / hosting': 'Shares QB "Software service costs" — split in QB first.',
    'owner dividend (above-market draw)':  'Maps tentatively to "Wages & earning expenses" — confirm with accountant before mapping.',
    'bdc line of credit interest':         'Not in FY26 P&L — add an account when the first draw happens.',
    'bad debt expense':                    "Not an active QB account — add one if the FY25 write-off pattern repeats.",
  };

  const accounts = await qb.fetchAccounts(conn, qbConnectionQueries);
  const accountByLower = new Map();
  accounts.forEach(a => accountByLower.set(String(a.name).toLowerCase(), a));
  const findByKeyword = (kw) => {
    const lower = kw.toLowerCase();
    const exact = accountByLower.get(lower);
    if (exact) return exact;
    for (const a of accounts) {
      if (String(a.name).toLowerCase().includes(lower)) return a;
    }
    return null;
  };

  const { lines } = await budgetQueries.getAll(fiscalYear);
  const mappedNow     = [];
  const alreadyMapped = [];
  const ambiguous     = [];
  const unmatched     = [];
  const consumedIds   = new Set();

  for (const line of lines) {
    const cat = String(line.category).toLowerCase();

    if (line.qb_account_id) {
      const existing = accounts.find(a => a.id === String(line.qb_account_id));
      alreadyMapped.push({
        line_id:         line.id,
        category:        line.category,
        qb_account_id:   line.qb_account_id,
        qb_account_name: existing ? existing.name : null,
      });
      if (existing) consumedIds.add(existing.id);
      continue;
    }

    const keywords = MATCH_RULES[cat];
    if (keywords) {
      let acct = null;
      for (const kw of keywords) { acct = findByKeyword(kw); if (acct) break; }
      if (acct) {
        await budgetQueries.updateLine(line.id, { qb_account_id: acct.id });
        mappedNow.push({
          line_id:         line.id,
          category:        line.category,
          qb_account_id:   acct.id,
          qb_account_name: acct.name,
        });
        consumedIds.add(acct.id);
        continue;
      }
      unmatched.push({ line_id: line.id, category: line.category });
      continue;
    }

    if (AMBIGUOUS[cat]) {
      ambiguous.push({ line_id: line.id, category: line.category, reason: AMBIGUOUS[cat] });
      continue;
    }
    unmatched.push({ line_id: line.id, category: line.category });
  }

  const unmatchedQb = accounts
    .filter(a => !consumedIds.has(a.id))
    .map(a => ({ id: a.id, name: a.name, type: a.type }));

  ok(res, {
    fiscal_year:      fiscalYear,
    mapped_now:       mappedNow,
    already_mapped:   alreadyMapped,
    ambiguous_lines:  ambiguous,
    unmatched_lines:  unmatched,
    unmatched_qb:     unmatchedQb,
  });
}));

// Rebuild the fiscal-year budget from the QuickBooks chart of accounts.
// Destructive: wipes existing budget_lines + cells for the fiscal year,
// then creates one line per QB Income/Expense account that had activity
// in the prior fiscal year. Each line is pre-mapped (qb_account_id set)
// and its monthly cells are seeded from prior-year actuals scaled to a
// per-account FY27 target or a default growth factor.
//
// Use this when the invented budget categories don't match the real
// QB chart of accounts — resets to QB's structure as the source of truth.
app.post('/api/quickbooks/rebuild-budget', requireOwner, wrap(async (req, res) => {
  const conn = await qbConnectionQueries.getActive();
  if (!conn) return fail(res, 'QuickBooks not connected', 400);

  const fiscalYear = (req.body && req.body.fiscal_year) || 'FY27';
  const fyNum = parseInt(String(fiscalYear).replace(/\D/g, ''), 10);
  if (!Number.isFinite(fyNum)) return fail(res, 'invalid fiscal_year');

  // Fiscal year = May year-1 → Apr year. For FY27, targetStartYear = 2026.
  const targetStartYear = 2000 + fyNum - 1;
  const targetStartDate = `${targetStartYear}-05-01`;
  const targetEndDate   = `${targetStartYear + 1}-04-30`;
  const priorStartDate  = `${targetStartYear - 1}-05-01`;
  const priorEndDate    = `${targetStartYear}-04-30`;

  const monthsFor = (startYear) => Array.from({ length: 12 }, (_, i) => {
    const m = (4 + i) % 12;
    const y = startYear + Math.floor((4 + i) / 12);
    return `${y}-${String(m + 1).padStart(2, '0')}-01`;
  });
  const TARGET_MONTHS = monthsFor(targetStartYear);
  const PRIOR_MONTHS  = monthsFor(targetStartYear - 1);

  // Per-account FY27 shaping — only applied when rebuilding FY27. Other
  // fiscal years use DEFAULT_FACTOR × prior-year actuals so you get a
  // "last year + 10%" reference budget rather than FY27-specific numbers.
  const FY27_TARGETS = {
    'Sales':                       { type: 'target', value: 1500000 },
    'Advertising/Promotion':       { type: 'target', value: 50000 },
    'Marketing':                   { type: 'target', value: 35000 },
    'Consulting expense':          { type: 'target', value: 15000 },
    'Wages':                       { type: 'target', value: 620000 },
    'Rent or Lease of Buildings':  { type: 'target', value: 60000 },
    'Travel':                      { type: 'factor', value: 1.5 },
    'Legal and professional fees': { type: 'factor', value: 1.3 },
    'Software service costs':      { type: 'factor', value: 1.15 },
  };
  const DEFAULT_FACTOR = 1.10;
  const applyTargets = fiscalYear === 'FY27';

  function sectionFor(account) {
    const type = String(account.type || '').toLowerCase();
    const name = String(account.name || '').toLowerCase();
    if (type === 'income' || type === 'other income') return 'income';
    if (type === 'other expense') return 'other';
    if (type === 'cost of goods sold') return 'cogs';
    if (/(^|\s)wages(\s|$)|consulting expense|software service|payroll/.test(name)) return 'cogs';
    return 'opex';
  }

  // Scale prior-year monthly array → fiscal-year monthly array. When prior
  // has no data but a target is set, distribute flat. When there's no data
  // AND no target, return null so the caller skips the line.
  function scaleMonthly(priorMonthly, target) {
    const priorTotal = priorMonthly.reduce((a, b) => a + b, 0);
    const fyTotal = target.type === 'target'
      ? target.value
      : priorTotal * target.value;
    if (fyTotal <= 0) return null;
    if (priorTotal === 0) {
      const base = Math.round(fyTotal / 12);
      const out = Array(12).fill(base);
      out[out.length - 1] = Math.round(fyTotal) - base * 11;
      return out;
    }
    const ratio = fyTotal / priorTotal;
    return priorMonthly.map(m => Math.round(m * ratio));
  }

  // ── Fetch QB data ────────────────────────────────────────────────
  // Two P&L reports: target year (to decide which accounts are active NOW
  // — handles chart-of-account renames cleanly) and prior year (used to
  // seed budget values). When the target year has no activity (future-year
  // rebuild before the year starts), fall back to prior-year accounts.
  const accounts = await qb.fetchAccounts(conn, qbConnectionQueries);
  const [targetReport, priorReport] = await Promise.all([
    qb.fetchProfitAndLoss(conn, qbConnectionQueries, targetStartDate, targetEndDate),
    qb.fetchProfitAndLoss(conn, qbConnectionQueries, priorStartDate,  priorEndDate),
  ]);
  const targetParsed = qb.parseProfitAndLoss(targetReport);
  const priorParsed  = qb.parseProfitAndLoss(priorReport);

  const targetByAccount = new Map();
  for (const row of targetParsed.accountRows) targetByAccount.set(String(row.accountId), row);
  const priorByAccount = new Map();
  for (const row of priorParsed.accountRows)  priorByAccount.set(String(row.accountId),  row);

  const monthlyFor = (row, months) => months.map(p => Number(row.amounts[p] || 0));
  const useTargetAsAccountSource = targetParsed.accountRows
    .some(r => monthlyFor(r, TARGET_MONTHS).some(x => x !== 0));

  // Active accounts = the ones we care about for THIS fiscal year.
  // Prefer the target-year P&L so chart renames (Payroll expenses →
  // Wages) don't leak dead lines; fall back to prior-year if target is
  // empty (e.g., rebuilding a future fiscal year).
  const RELEVANT_TYPES = new Set(['Income', 'Other Income', 'Expense', 'Other Expense', 'Cost of Goods Sold']);
  const candidates = accounts.filter(a => {
    if (!RELEVANT_TYPES.has(a.type)) return false;
    const sourceRow = useTargetAsAccountSource
      ? targetByAccount.get(a.id)
      : priorByAccount.get(a.id);
    const months = useTargetAsAccountSource ? TARGET_MONTHS : PRIOR_MONTHS;
    const hasActivity = sourceRow && monthlyFor(sourceRow, months).some(x => x !== 0);
    // Always include target accounts (e.g., Sales) even if inactive this
    // year — you want a budget slot ready. Only honor targets when we're
    // rebuilding FY27.
    return hasActivity || (applyTargets && FY27_TARGETS[a.name]);
  });

  // Sort: income → cogs → opex → other, then by name.
  const sectionOrder = { income: 0, cogs: 1, opex: 2, other: 3 };
  const sorted = candidates.slice().sort((a, b) => {
    const sa = sectionOrder[sectionFor(a)], sb = sectionOrder[sectionFor(b)];
    if (sa !== sb) return sa - sb;
    return String(a.name).localeCompare(String(b.name));
  });

  // ── Compute the new layout entirely in memory first, then commit it
  // atomically. Previously the wipe + per-line/cell INSERTs ran without a
  // transaction, so a Vercel function timeout or pool drop mid-loop could
  // leave the user's budget half-rebuilt with their manual entries gone.
  const lineSpecs = [];
  const skipped   = [];
  const sortCountBySection = {};

  for (const account of sorted) {
    const section = sectionFor(account);
    const priorRow = priorByAccount.get(account.id);
    const priorMonthly = priorRow ? monthlyFor(priorRow, PRIOR_MONTHS) : Array(12).fill(0);
    const target = (applyTargets && FY27_TARGETS[account.name])
      || { type: 'factor', value: DEFAULT_FACTOR };

    const fyMonthly = scaleMonthly(priorMonthly, target);
    if (!fyMonthly) {
      skipped.push({ id: account.id, name: account.name, reason: 'zero target/actual for fiscal year' });
      continue;
    }

    sortCountBySection[section] = (sortCountBySection[section] || 0) + 1;
    lineSpecs.push({
      section,
      category:      account.name,
      sort_order:    sortCountBySection[section] - 1,
      qb_account_id: account.id,
      notes:         target.type === 'target'
        ? `${fiscalYear} target ${target.value.toLocaleString('en-US', {style:'currency',currency:'USD',maximumFractionDigits:0})} — from plan`
        : `FY${fyNum - 1} actuals × ${target.value} growth factor`,
      cells: TARGET_MONTHS.map((p, i) => fyMonthly[i] ? { period_date: p, budget_amount: fyMonthly[i] } : null).filter(Boolean),
      // Carry the report-shape metadata through so we can build the response below.
      _reportMeta: {
        category: account.name,
        section,
        qb_account_id: account.id,
        prior_total: Math.round(priorMonthly.reduce((a, b) => a + b, 0)),
        fy_total: fyMonthly.reduce((a, b) => a + b, 0),
        target_or_factor: target,
      },
    });
  }

  const insertedLines = await budgetQueries.rebuildForFiscalYear(fiscalYear, lineSpecs);
  // Pair returned line ids with the precomputed report metadata.
  const createdLines = insertedLines.map((line, idx) => ({
    id: line.id,
    ...lineSpecs[idx]._reportMeta,
  }));

  ok(res, {
    fiscal_year:       fiscalYear,
    target_start:      targetStartDate,
    target_end:        targetEndDate,
    prior_start:       priorStartDate,
    prior_end:         priorEndDate,
    account_source:    useTargetAsAccountSource ? 'target_year' : 'prior_year',
    applied_targets:   applyTargets,
    created_lines:     createdLines,
    total_lines:       createdLines.length,
    skipped_accounts:  skipped,
    chart_of_accounts: accounts.length,
  });
}));

// Pull the monthly P&L for the given fiscal year and write actuals into
// budget_cells for every line whose qb_account_id matches. Returns:
//   synced_cells      — how many cells were written
//   mapped_accounts   — qb account ids successfully written to a line
//   unmapped_accounts — qb accounts that appeared in the P&L but have no
//                       matching budget line (for the mapping UI)
app.post('/api/quickbooks/sync', requireOwner, wrap(async (req, res) => {
  const fiscalYear = (req.body && req.body.fiscal_year) || 'FY27';
  const n = parseInt(String(fiscalYear).replace(/\D/g, ''), 10);
  if (!Number.isFinite(n)) return fail(res, 'invalid fiscal_year');
  const startYear = 2000 + n - 1;
  const startDate = `${startYear}-05-01`;
  const endDate   = `${startYear + 1}-04-30`;

  const conn = await qbConnectionQueries.getActive();
  if (!conn) return fail(res, 'QuickBooks not connected', 400);

  const report = await qb.fetchProfitAndLoss(conn, qbConnectionQueries, startDate, endDate);
  const parsed = qb.parseProfitAndLoss(report);

  const { lines } = await budgetQueries.getAll(fiscalYear);
  const lineByAccount = new Map();
  lines.forEach(l => { if (l.qb_account_id) lineByAccount.set(String(l.qb_account_id), l); });

  // Collect all (line, period, amount) triples up-front, then write them in
  // a single atomic batch. Previously each cell wrote on its own connection,
  // so a network blip mid-loop left the budget with mixed-source actuals.
  const cellSpecs = [];
  const mapped = [];
  const unmappedMap = new Map(); // accountId → {id, name}
  for (const row of parsed.accountRows) {
    const line = lineByAccount.get(row.accountId);
    if (!line) {
      unmappedMap.set(row.accountId, { id: row.accountId, name: row.accountName });
      continue;
    }
    mapped.push({ account_id: row.accountId, line_id: line.id });
    for (const [period, amount] of Object.entries(row.amounts)) {
      cellSpecs.push({
        line_id:       line.id,
        period_date:   period,
        actual_amount: amount,
        source:        'qb',
      });
    }
  }
  const synced = await budgetQueries.setActuals(cellSpecs);

  await qbConnectionQueries.markSynced(conn.id);
  ok(res, {
    fiscal_year:       fiscalYear,
    start_date:        startDate,
    end_date:          endDate,
    synced_cells:      synced,
    mapped_accounts:   mapped,
    unmapped_accounts: [...unmappedMap.values()],
    last_synced_at:    new Date().toISOString(),
  });
}));

// ── V/TO (Vision / Traction Organizer) ───────────────────────────────────────
// Single-row doc for the whole org. GET always returns a row (created on first
// call). PUT accepts any subset of V/TO fields — the frontend saves per-section
// (Core Values, Core Focus, etc.) so updates stay small.
// V/TO read access: owners + users granted the 'vto' tab see the full doc.
// Everyone else gets a trimmed public subset (core values, core focus, annual
// goals + 1-year future date) so the My 90 dashboard cards still render.
// PUT requires full access.
async function hasVtoAccess(userId) {
  const u = await userQueries.getById(userId);
  if (!u) return false;
  if (u.role === 'owner') return true;
  const tabs = await tabAccessQueries.listForUser(userId);
  return tabs.includes('vto');
}
function publicVtoSubset(row) {
  return {
    core_values:          row.core_values || [],
    core_focus_purpose:   row.core_focus_purpose || '',
    core_focus_niche:     row.core_focus_niche || '',
    one_year_goals:       row.one_year_goals || [],
    one_year_future_date: row.one_year_future_date,
  };
}
app.get('/api/vto', wrap(async (req, res) => {
  const full = await vtoQueries.getOrCreate();
  if (await hasVtoAccess(req.userId)) return ok(res, full);
  ok(res, publicVtoSubset(full));
}));
app.put('/api/vto', wrap(async (req, res) => {
  if (!(await hasVtoAccess(req.userId))) return fail(res, 'Forbidden', 403);
  ok(res, await vtoQueries.update(req.body || {}));
}));

// ── Rocks ────────────────────────────────────────────────────────────────────
app.get('/api/rocks/quarters', wrap(async (req, res) => ok(res, await rockQueries.quarters())));
app.get('/api/rocks', wrap(async (req, res) => ok(res, await rockQueries.getAll(req.query.quarter))));
app.post('/api/rocks', wrap(async (req, res) => {
  const { title, description, owner_id, quarter, status, progress, goal_id } = req.body;
  if (!title)   return fail(res, 'title is required');
  if (!quarter) return fail(res, 'quarter is required');
  if (!allow(status, STATUS_ROCK)) return fail(res, `status must be one of ${STATUS_ROCK.join(', ')}`);
  ok(res, await rockQueries.create({ title, description, owner_id, quarter, status, progress, goal_id }));
}));
app.put('/api/rocks/:id', wrap(async (req, res) => {
  if (!allow(req.body.status, STATUS_ROCK)) return fail(res, `status must be one of ${STATUS_ROCK.join(', ')}`);
  ok(res, await rockQueries.update(req.params.id, req.body));
}));
app.delete('/api/rocks/:id', wrap(async (req, res) => {
  await rockQueries.delete(req.params.id);
  ok(res, { deleted: true });
}));

// ── Rock milestones ──────────────────────────────────────────────────────────
app.get('/api/rocks/:rockId/milestones', wrap(async (req, res) => {
  ok(res, await milestoneQueries.getByRock(req.params.rockId));
}));
app.post('/api/rocks/:rockId/milestones', wrap(async (req, res) => {
  const { title, due_date, owner_id, sort_order } = req.body;
  if (!title) return fail(res, 'title is required');
  ok(res, await milestoneQueries.create(req.params.rockId, { title, due_date, owner_id, sort_order }));
}));
app.put('/api/milestones/:id', wrap(async (req, res) => {
  ok(res, await milestoneQueries.update(req.params.id, req.body));
}));
app.delete('/api/milestones/:id', wrap(async (req, res) => {
  await milestoneQueries.delete(req.params.id);
  ok(res, { deleted: true });
}));

// ── Issues ───────────────────────────────────────────────────────────────────
app.get('/api/issues', wrap(async (req, res) => {
  const includeArchived = req.query.include_archived === '1' || req.query.include_archived === 'true';
  ok(res, await issueQueries.getAll(req.query.status, req.userId, includeArchived));
}));
app.post('/api/issues', wrap(async (req, res) => {
  const { title, description, owner_id, priority, due_date, private: isPrivate, rock_id } = req.body;
  if (!title) return fail(res, 'title is required');
  if (!allow(priority, PRIORITY_VALS)) return fail(res, `priority must be one of ${PRIORITY_VALS.join(', ')}`);
  ok(res, await issueQueries.create({ title, description, owner_id, priority, due_date, private: isPrivate, rock_id }));
}));
app.put('/api/issues/:id', wrap(async (req, res) => {
  // Block mutation of another user's private to-do. Public to-dos stay
  // team-editable. 404 (not 403) so we don't leak that the row exists.
  const existing = await issueQueries.getById(req.params.id, req.userId);
  if (!existing) return fail(res, 'to-do not found', 404);
  if (!allow(req.body.status, STATUS_ISSUE)) return fail(res, `status must be one of ${STATUS_ISSUE.join(', ')}`);
  if (!allow(req.body.priority, PRIORITY_VALS)) return fail(res, `priority must be one of ${PRIORITY_VALS.join(', ')}`);
  ok(res, await issueQueries.update(req.params.id, req.body));
}));
app.delete('/api/issues/:id', wrap(async (req, res) => {
  const existing = await issueQueries.getById(req.params.id, req.userId);
  if (!existing) return fail(res, 'to-do not found', 404);
  await issueQueries.delete(req.params.id);
  ok(res, { deleted: true });
}));

// ── Team Issues (IDS discussion items) ───────────────────────────────────────
app.get('/api/team-issues', wrap(async (req, res) => {
  const includeArchived = req.query.include_archived === '1' || req.query.include_archived === 'true';
  ok(res, await teamIssueQueries.getAll({
    horizon: req.query.horizon || undefined,
    status:  req.query.status  || undefined,
    includeArchived,
  }));
}));
app.get('/api/team-issues/:id', wrap(async (req, res) => ok(res, await teamIssueQueries.getById(req.params.id))));
app.post('/api/team-issues', wrap(async (req, res) => {
  const { title, description, horizon } = req.body;
  if (!title) return fail(res, 'title is required');
  if (!allow(horizon, HORIZON_VALS)) return fail(res, `horizon must be one of ${HORIZON_VALS.join(', ')}`);
  const owner_id = req.body.owner_id ?? req.userId ?? null;
  ok(res, await teamIssueQueries.create({ title, description, owner_id, horizon }));
}));
app.put('/api/team-issues/:id', wrap(async (req, res) => {
  if (!allow(req.body.status, STATUS_ISSUE)) return fail(res, `status must be one of ${STATUS_ISSUE.join(', ')}`);
  if (!allow(req.body.horizon, HORIZON_VALS)) return fail(res, `horizon must be one of ${HORIZON_VALS.join(', ')}`);
  ok(res, await teamIssueQueries.update(req.params.id, req.body));
}));
app.delete('/api/team-issues/:id', wrap(async (req, res) => {
  await teamIssueQueries.delete(req.params.id);
  ok(res, { deleted: true });
}));
app.put('/api/team-issues/:id/rank', wrap(async (req, res) => {
  let { rank } = req.body;
  if (rank === undefined) return fail(res, 'rank is required (1, 2, 3, or null)');
  if (rank !== null) rank = Number(rank);
  if (rank !== null && (!Number.isInteger(rank) || rank < 1 || rank > 3)) {
    return fail(res, 'rank must be null or an integer 1-3');
  }
  ok(res, await teamIssueQueries.setRank(req.params.id, rank));
}));

// ── Agendas ──────────────────────────────────────────────────────────────────
app.get('/api/agendas', wrap(async (req, res) => ok(res, await agendaQueries.getAll())));
app.post('/api/agendas', wrap(async (req, res) => {
  const { title } = req.body;
  if (!title) return fail(res, 'title is required');
  ok(res, await agendaQueries.create({ title }));
}));
app.get('/api/agendas/:id/sections', wrap(async (req, res) => ok(res, await agendaQueries.getSections(req.params.id))));
app.post('/api/agendas/:id/sections', wrap(async (req, res) => {
  ok(res, await agendaQueries.addSection(req.params.id, req.body));
}));
app.put('/api/agendas/:id', wrap(async (req, res) => ok(res, await agendaQueries.update(req.params.id, req.body))));
app.delete('/api/agendas/:id', wrap(async (req, res) => {
  await agendaQueries.delete(req.params.id); ok(res, { deleted: true });
}));
app.put('/api/agenda-sections/:id', wrap(async (req, res) => ok(res, await agendaQueries.updateSection(req.params.id, req.body))));
app.delete('/api/agenda-sections/:id', wrap(async (req, res) => {
  await agendaQueries.deleteSection(req.params.id); ok(res, { deleted: true });
}));

// ── Meetings ─────────────────────────────────────────────────────────────────
app.get('/api/meetings', wrap(async (req, res) => ok(res, await meetingQueries.getAll(req.query.status))));
app.post('/api/meetings', wrap(async (req, res) => {
  const { agenda_id, title, scheduled_at, sections_snapshot, attendee_ids } = req.body;
  if (!title) return fail(res, 'title is required');
  ok(res, await meetingQueries.create({ agenda_id, title, scheduled_at, sections_snapshot, attendee_ids }));
}));
app.put('/api/meetings/:id', wrap(async (req, res) => {
  // Validate enum so a member can't flip a finished meeting back to upcoming
  // (which would re-open attendee edits) by sending arbitrary status text.
  if (!allow(req.body.status, STATUS_MEETING)) {
    return fail(res, `status must be one of ${STATUS_MEETING.join(', ')}`);
  }
  ok(res, await meetingQueries.update(req.params.id, req.body));
}));
// Replace the attendee list. Frozen once the meeting goes in_progress (or later).
app.put('/api/meetings/:id/attendees', wrap(async (req, res) => {
  const meeting = await meetingQueries.getById(req.params.id);
  if (!meeting) return fail(res, 'meeting not found', 404);
  if (meeting.status !== 'upcoming') {
    return fail(res, 'Attendees can only be edited on upcoming meetings.');
  }
  const { userIds } = req.body;
  if (!Array.isArray(userIds)) return fail(res, 'userIds must be an array');
  ok(res, await meetingQueries.setAttendees(req.params.id, userIds));
}));
app.delete('/api/meetings/:id', wrap(async (req, res) => {
  await meetingQueries.delete(req.params.id); ok(res, { deleted: true });
}));

// ── Coaching read endpoints (session auth, scoped to current user) ───────────
// These power the Stella tab in the UI. They run AFTER the /api cookie gate,
// so req.userId is set by requireAuth; coaching data is always scoped by it.
// Hidden when COACHING_ENABLED is off (tab won't show; API returns 404).
app.get('/api/coaching/calls', requireCoachingFlag, wrap(async (req, res) => {
  const limit  = +req.query.limit  || 20;
  const offset = +req.query.offset || 0;
  ok(res, await coachingQueries.listCalls(req.userId, limit, offset));
}));
app.get('/api/coaching/calls/:id', requireCoachingFlag, wrap(async (req, res) => {
  const call = await coachingQueries.getCallById(req.params.id, req.userId);
  if (!call) return fail(res, 'Not found', 404);
  ok(res, call);
}));
app.get('/api/coaching/stats', requireCoachingFlag, wrap(async (req, res) => {
  ok(res, await coachingQueries.getStats(req.userId));
}));
app.get('/api/coaching/calendar', requireCoachingFlag, wrap(async (req, res) => {
  ok(res, await coachingQueries.getCalendar(req.userId, +req.query.days || 365));
}));
app.get('/api/coaching/enabled', (req, res) => ok(res, { enabled: COACHING_ENABLED }));

// Per-user Stella settings (session auth — each user manages their own).
app.get('/api/coaching/settings', requireCoachingFlag, wrap(async (req, res) => {
  const u = await userQueries.getById(req.userId);
  ok(res, {
    coaching_enabled: !!u?.coaching_enabled,
    coaching_phone:   u?.coaching_phone || null,
  });
}));
app.put('/api/coaching/settings', requireCoachingFlag, wrap(async (req, res) => {
  const { coaching_enabled, coaching_phone } = req.body || {};
  // Normalize to strict E.164: strip whitespace/punctuation, ensure leading +.
  // VAPI sends phones with +, so our stored value must match for lookup.
  // Heuristic: 10-digit number → assume North American, prepend '1'.
  let normalized = null;
  if (coaching_phone) {
    let digits = String(coaching_phone).replace(/[^\d]/g, '');
    if (digits.length === 10) digits = '1' + digits;
    if (!/^[0-9]{7,16}$/.test(digits)) {
      return fail(res, 'Phone must be 7–16 digits (e.g. +19404898092)');
    }
    normalized = '+' + digits;
  }
  // Uniqueness is enforced by the DB unique index; surface it as a friendly error.
  try {
    const updated = await userQueries.updateCoachingSettings(req.userId, {
      coaching_enabled: !!coaching_enabled,
      coaching_phone:   normalized,
    });
    ok(res, {
      coaching_enabled: !!updated.coaching_enabled,
      coaching_phone:   updated.coaching_phone || null,
    });
  } catch (e) {
    if (e.code === '23505') return fail(res, 'Phone number already registered to another user');
    throw e;
  }
}));

// ── SPA catch-all ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Boot ─────────────────────────────────────────────────────────────────────
const IS_SERVERLESS = !!process.env.VERCEL;
const dbReady = initDb().catch(e => {
  console.error('DB init failed:', e.message);
  if (!IS_SERVERLESS) process.exit(1);
});

if (require.main === module) {
  dbReady.then(() => app.listen(PORT, () => console.log(`\n🚀  Ninety App  →  http://localhost:${PORT}\n`)));
}

module.exports = app;
