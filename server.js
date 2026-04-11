const express = require('express');
const path = require('path');
const { initDb, userQueries, rockQueries, issueQueries } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const ok   = (res, data) => res.json({ ok: true, data });
const fail = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });
const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) { console.error(e); fail(res, e.message, 500); }
};

// Users
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

// Rocks — /quarters must come before /:id
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

// Issues — /votes/:userId must come before /:id
app.get('/api/issues/votes/:userId', wrap(async (req, res) => ok(res, await issueQueries.getUserVotes(req.params.userId))));
app.get('/api/issues', wrap(async (req, res) => ok(res, await issueQueries.getAll(req.query.status))));
app.post('/api/issues', wrap(async (req, res) => {
  const { title, description, owner_id, priority } = req.body;
  if (!title) return fail(res, 'title is required');
  ok(res, await issueQueries.create({ title, description, owner_id, priority }));
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

// SPA catch-all
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Boot — on Vercel serverless, don't exit on DB init failure (would crash the function)
const IS_SERVERLESS = !!process.env.VERCEL;
const dbReady = initDb().catch(e => {
  console.error('DB init failed:', e.message);
  if (!IS_SERVERLESS) process.exit(1);
});

if (require.main === module) {
  dbReady.then(() => app.listen(PORT, () => console.log(`\n🚀  Ninety App  →  http://localhost:${PORT}\n`)));
}

// Vercel serverless export
module.exports = app;
