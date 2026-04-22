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

// ── Coaching integration (LifeCoach/Stella) ──────────────────────────────────
// Registered BEFORE the /api cookie-auth gate so external services can hit
// these with a Bearer API key instead of a browser session. Feature-flagged.
// Phase 1 is single-user: data is attributed to NINETY_COACHING_USER_EMAIL.
const COACHING_ENABLED    = process.env.COACHING_ENABLED === 'true';
const NINETY_API_KEY      = process.env.NINETY_API_KEY;
const COACHING_USER_EMAIL = process.env.NINETY_COACHING_USER_EMAIL;

function requireCoachingFlag(req, res, next) {
  if (!COACHING_ENABLED) return fail(res, 'Not found', 404);
  next();
}
function requireApiKey(req, res, next) {
  if (!NINETY_API_KEY) return fail(res, 'Coaching API key not configured', 500);
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  const a = Buffer.from(token);
  const b = Buffer.from(NINETY_API_KEY);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return fail(res, 'Unauthorized', 401);
  next();
}
async function resolveCoachingUser(res) {
  if (!COACHING_USER_EMAIL) { fail(res, 'NINETY_COACHING_USER_EMAIL not configured', 500); return null; }
  return await userQueries.findOrCreateByEmail(COACHING_USER_EMAIL, 'Jude');
}

app.post('/api/coaching/calls', requireCoachingFlag, requireApiKey, wrap(async (req, res) => {
  const user = await resolveCoachingUser(res); if (!user) return;
  const { summary, gratitude, transcript, commitments } = req.body || {};
  if (!Array.isArray(commitments)) return fail(res, 'commitments must be an array');
  ok(res, await coachingQueries.createCall({
    user_id: user.id, summary, gratitude, transcript, commitments,
  }));
}));

app.get('/api/coaching/context', requireCoachingFlag, requireApiKey, wrap(async (req, res) => {
  const user = await resolveCoachingUser(res); if (!user) return;
  ok(res, await coachingQueries.getContext(user.id));
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
