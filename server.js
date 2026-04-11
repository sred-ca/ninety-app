const express    = require('express');
const path       = require('path');
const session    = require('express-session');
const { initDb, userQueries, rockQueries, issueQueries, agendaQueries, meetingQueries } = require('./database');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Session store ────────────────────────────────────────────────────────────
// Use Postgres-backed sessions in production (so serverless restarts don't log
// everyone out); fall back to the default in-memory store locally.
let sessionStore;
if (process.env.DATABASE_URL) {
  const PgSession = require('connect-pg-simple')(session);
  sessionStore = new PgSession({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
    tableName: 'user_sessions',
  });
}

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'ninety-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: !!process.env.VERCEL,   // HTTPS-only in production
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    sameSite: 'lax',
  },
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const ok   = (res, data) => res.json({ ok: true, data });
const fail = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });
const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) { console.error(e); fail(res, e.message, 500); }
};

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

    // Find or create user in DB
    const user = await userQueries.findOrCreateByEmail(profile.email, profile.name);
    req.session.userId = user.id;

    // Explicitly save session before redirecting (critical in serverless)
    req.session.save((err) => {
      if (err) console.error('Session save error:', err);
      res.redirect('/');
    });
  } catch (e) {
    console.error('OAuth callback error:', e);
    res.redirect('/?error=server_error');
  }
});

// Who am I?
app.get('/api/me', wrap(async (req, res) => {
  if (!req.session.userId) return ok(res, null);
  const user = await userQueries.getById(req.session.userId);
  ok(res, user || null);
}));

// Logout
app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

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
  ok(res, await rockQueries.create({ title, description, owner_id, quarter, status, progress }));
}));
app.put('/api/rocks/:id', wrap(async (req, res) => ok(res, await rockQueries.update(req.params.id, req.body))));
app.delete('/api/rocks/:id', wrap(async (req, res) => {
  await rockQueries.delete(req.params.id);
  ok(res, { deleted: true });
}));

// ── Issues ───────────────────────────────────────────────────────────────────
app.get('/api/issues/votes/:userId', wrap(async (req, res) => ok(res, await issueQueries.getUserVotes(req.params.userId))));
app.get('/api/issues', wrap(async (req, res) => ok(res, await issueQueries.getAll(req.query.status))));
app.post('/api/issues', wrap(async (req, res) => {
  const { title, description, owner_id, priority, due_date } = req.body;
  if (!title) return fail(res, 'title is required');
  ok(res, await issueQueries.create({ title, description, owner_id, priority, due_date }));
}));
app.put('/api/issues/:id', wrap(async (req, res) => ok(res, await issueQueries.update(req.params.id, req.body))));
app.delete('/api/issues/:id', wrap(async (req, res) => {
  await issueQueries.delete(req.params.id);
  ok(res, { deleted: true });
}));
app.post('/api/issues/:id/vote', wrap(async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return fail(res, 'user_id is required');
  ok(res, await issueQueries.vote(req.params.id, user_id));
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
  const { agenda_id, title, scheduled_at, sections_snapshot } = req.body;
  if (!title) return fail(res, 'title is required');
  ok(res, await meetingQueries.create({ agenda_id, title, scheduled_at, sections_snapshot }));
}));
app.put('/api/meetings/:id', wrap(async (req, res) => ok(res, await meetingQueries.update(req.params.id, req.body))));
app.delete('/api/meetings/:id', wrap(async (req, res) => {
  await meetingQueries.delete(req.params.id); ok(res, { deleted: true });
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
