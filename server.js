const express    = require('express');
const path       = require('path');
const crypto     = require('crypto');
const { initDb, userQueries, rockQueries, issueQueries, agendaQueries, meetingQueries, teamIssueQueries, milestoneQueries, coachingQueries } = require('./database');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Stateless HMAC-signed cookie auth ────────────────────────────────────────
// No session store needed — userId is signed with a secret and stored in a
// cookie. Works reliably in serverless environments (no DB round-trip for auth).
const COOKIE_NAME   = 'ninety_auth';
const COOKIE_SECRET = process.env.SESSION_SECRET || 'ninety-dev-secret-change-me';

function makeAuthCookie(userId) {
  const payload = Buffer.from(JSON.stringify({ userId })).toString('base64url');
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
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()); }
  catch { return null; }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const ok   = (res, data) => res.json({ ok: true, data });
const fail = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });
const wrap = (fn) => async (req, res) => {
  // On cold serverless starts, migrations in initDb() can still be in flight
  // when the first request arrives. Await dbReady so column adds finish first.
  try { await dbReady; await fn(req, res); }
  catch (e) { console.error(e); fail(res, e.message, 500); }
};

// Require a signed auth cookie on any /api/* route that mutates data or reads
// something private. /api/me and the OAuth callbacks opt out.
function requireAuth(req, res, next) {
  const auth = readAuthCookie(req);
  if (!auth || !auth.userId) return fail(res, 'not authenticated', 401);
  req.userId = auth.userId;
  next();
}

// Tiny value whitelist helper used by route handlers to reject unknown enum
// values before they reach the query layer.
function allow(value, allowed) {
  return value === undefined || value === null || allowed.includes(value);
}
const STATUS_ISSUE   = ['in_progress', 'waiting_for', 'blocker', 'solved'];
const STATUS_ROCK    = ['not_started', 'on_track', 'off_track', 'done'];
const PRIORITY_VALS  = ['low', 'medium', 'high'];
const HORIZON_VALS   = ['short_term', 'long_term'];

// ── Google OAuth ─────────────────────────────────────────────────────────────
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI ||
  `http://localhost:${PORT}/auth/google/callback`;
const ALLOWED_DOMAIN       = 'sred.ca';

// Step 1 — redirect to Google
app.get('/auth/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID) {
    return res.status(500).send('GOOGLE_CLIENT_ID is not configured');
  }
  const params = new URLSearchParams({
    client_id:     GOOGLE_CLIENT_ID,
    redirect_uri:  GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope:         'openid email profile',
    access_type:   'online',
    prompt:        'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// Step 2 — handle callback
app.get('/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/?error=cancelled');

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
      secure: !!process.env.VERCEL,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    res.redirect('/');
  } catch (e) {
    console.error('OAuth callback error:', e);
    res.redirect('/?error=server_error');
  }
});

// Who am I?
app.get('/api/me', wrap(async (req, res) => {
  const auth = readAuthCookie(req);
  if (!auth) return ok(res, null);
  const user = await userQueries.getById(auth.userId);
  ok(res, user || null);
}));

// Logout
app.get('/auth/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.redirect('/');
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
  const { summary, gratitude, transcript, commitments } = req.body || {};
  if (!Array.isArray(commitments)) return fail(res, 'commitments must be an array');
  ok(res, await coachingQueries.createCall({
    user_id: userId, summary, gratitude, transcript, commitments,
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

// ── Cron jobs (Vercel Cron; authed via Bearer CRON_SECRET) ───────────────────
// Registered before the /api cookie gate so Vercel's cron invocation can
// reach it without a session.
function requireCronSecret(req, res, next) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return fail(res, 'CRON_SECRET not configured', 500);
  const got = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (got !== secret) return fail(res, 'Unauthorized', 401);
  next();
}
app.get('/api/cron/promote-milestones', requireCronSecret, wrap(async (req, res) => {
  ok(res, await milestoneQueries.promoteDue());
}));

// Everything below this line requires a signed auth cookie. /api/me above
// opts out because it legitimately needs to return null for logged-out users.
app.use('/api', requireAuth);

// ── Users ────────────────────────────────────────────────────────────────────
app.get('/api/users', wrap(async (req, res) => ok(res, await userQueries.getAll())));
app.post('/api/users', wrap(async (req, res) => {
  const { name, color } = req.body;
  if (!name) return fail(res, 'name is required');
  ok(res, await userQueries.create(name.trim(), color));
}));
app.put('/api/users/:id', wrap(async (req, res) => {
  const { name, color } = req.body;
  if (!name) return fail(res, 'name is required');
  ok(res, await userQueries.update(req.params.id, name.trim(), color));
}));
app.delete('/api/users/:id', wrap(async (req, res) => {
  await userQueries.delete(req.params.id);
  ok(res, { deleted: true });
}));

// ── Rocks ────────────────────────────────────────────────────────────────────
app.get('/api/rocks/quarters', wrap(async (req, res) => ok(res, await rockQueries.quarters())));
app.get('/api/rocks', wrap(async (req, res) => ok(res, await rockQueries.getAll(req.query.quarter))));
app.post('/api/rocks', wrap(async (req, res) => {
  const { title, description, owner_id, quarter, status, progress } = req.body;
  if (!title)   return fail(res, 'title is required');
  if (!quarter) return fail(res, 'quarter is required');
  if (!allow(status, STATUS_ROCK)) return fail(res, `status must be one of ${STATUS_ROCK.join(', ')}`);
  ok(res, await rockQueries.create({ title, description, owner_id, quarter, status, progress }));
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
  const { title, description, owner_id, priority, due_date, private: isPrivate } = req.body;
  if (!title) return fail(res, 'title is required');
  if (!allow(priority, PRIORITY_VALS)) return fail(res, `priority must be one of ${PRIORITY_VALS.join(', ')}`);
  ok(res, await issueQueries.create({ title, description, owner_id, priority, due_date, private: isPrivate }));
}));
app.put('/api/issues/:id', wrap(async (req, res) => {
  if (!allow(req.body.status, STATUS_ISSUE)) return fail(res, `status must be one of ${STATUS_ISSUE.join(', ')}`);
  if (!allow(req.body.priority, PRIORITY_VALS)) return fail(res, `priority must be one of ${PRIORITY_VALS.join(', ')}`);
  ok(res, await issueQueries.update(req.params.id, req.body));
}));
app.delete('/api/issues/:id', wrap(async (req, res) => {
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
app.put('/api/meetings/:id', wrap(async (req, res) => ok(res, await meetingQueries.update(req.params.id, req.body))));
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
