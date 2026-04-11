/**
 * Dual-mode database layer:
 *   LOCAL DEV  → JSON file store (no setup needed)
 *   PRODUCTION → Postgres via DATABASE_URL env var (Neon, Vercel Postgres, etc.)
 */

const USE_PG = !!process.env.DATABASE_URL;

/* ══════════════════════════════════════════════════════════════════
   POSTGRES MODE
   ══════════════════════════════════════════════════════════════════ */
if (USE_PG) {
  const { Pool } = require('pg');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost')
      ? false
      : { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  });

  async function initDb() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL UNIQUE,
        color      TEXT NOT NULL DEFAULT '#6366f1',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS rocks (
        id          SERIAL PRIMARY KEY,
        title       TEXT NOT NULL,
        description TEXT,
        owner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        quarter     TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'not_started',
        progress    INTEGER NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS issues (
        id          SERIAL PRIMARY KEY,
        title       TEXT NOT NULL,
        description TEXT,
        owner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        status      TEXT NOT NULL DEFAULT 'in_progress',
        priority    TEXT NOT NULL DEFAULT 'medium',
        archived    BOOLEAN NOT NULL DEFAULT FALSE,
        due_date    DATE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS issue_votes (
        issue_id  INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (issue_id, user_id)
      );
    `);
    // Migrate existing tables that may lack newer columns
    await pool.query(`
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS due_date DATE;
    `);
    // Rename legacy statuses to new names and fix column default
    await pool.query(`
      UPDATE issues SET status='in_progress' WHERE status='identified';
      UPDATE issues SET status='blocker'     WHERE status='discussing';
      ALTER TABLE issues ALTER COLUMN status SET DEFAULT 'in_progress';
    `);

    // Seed default users on first run
    const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM users');
    if (rows[0].c === 0) {
      const defaults = [
        ['Logan', '#6366f1'], ['Alex', '#ec4899'], ['Jordan', '#f59e0b'],
        ['Taylor', '#10b981'], ['Morgan', '#3b82f6'],
      ];
      for (const [name, color] of defaults) {
        await pool.query(
          'INSERT INTO users (name, color) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [name, color]
        );
      }
    }
  }

  const ROCK_Q = `
    SELECT r.*, u.name AS owner_name, u.color AS owner_color
    FROM rocks r LEFT JOIN users u ON r.owner_id = u.id
  `;
  const ISSUE_Q = `
    SELECT i.id, i.title, i.description, i.owner_id, i.status, i.priority,
           i.archived, i.due_date, i.created_at, i.updated_at,
           u.name AS owner_name, u.color AS owner_color,
           (SELECT COUNT(*)::int FROM issue_votes iv WHERE iv.issue_id = i.id) AS votes
    FROM issues i LEFT JOIN users u ON i.owner_id = u.id
  `;

  const userQueries = {
    getAll: async () => (await pool.query('SELECT * FROM users ORDER BY name')).rows,
    getById: async (id) => (await pool.query('SELECT * FROM users WHERE id=$1', [id])).rows[0] ?? null,
    create: async (name, color) => (await pool.query(
      'INSERT INTO users (name,color) VALUES ($1,$2) RETURNING *', [name, color || '#6366f1']
    )).rows[0],
    update: async (id, name, color) => (await pool.query(
      'UPDATE users SET name=$1,color=$2 WHERE id=$3 RETURNING *', [name, color, id]
    )).rows[0] ?? null,
    delete: async (id) => pool.query('DELETE FROM users WHERE id=$1', [id]),
  };

  const rockQueries = {
    getAll: async (quarter) => {
      const q = quarter
        ? await pool.query(`${ROCK_Q} WHERE r.quarter=$1 ORDER BY r.created_at DESC`, [quarter])
        : await pool.query(`${ROCK_Q} ORDER BY r.created_at DESC`);
      return q.rows;
    },
    getById: async (id) => (await pool.query(`${ROCK_Q} WHERE r.id=$1`, [id])).rows[0] ?? null,
    create: async ({ title, description, owner_id, quarter, status, progress }) => {
      const { rows } = await pool.query(
        `INSERT INTO rocks (title,description,owner_id,quarter,status,progress)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [title, description || null, owner_id || null, quarter, status || 'not_started', progress || 0]
      );
      return rockQueries.getById(rows[0].id);
    },
    update: async (id, fields) => {
      const allowed = ['title','description','owner_id','quarter','status','progress'];
      const keys = allowed.filter(k => k in fields);
      if (!keys.length) return rockQueries.getById(id);
      const sets = keys.map((k, i) => `${k}=$${i + 1}`).join(', ');
      await pool.query(
        `UPDATE rocks SET ${sets}, updated_at=NOW() WHERE id=$${keys.length + 1}`,
        [...keys.map(k => fields[k]), id]
      );
      return rockQueries.getById(id);
    },
    delete: async (id) => pool.query('DELETE FROM rocks WHERE id=$1', [id]),
    quarters: async () => (await pool.query('SELECT DISTINCT quarter FROM rocks ORDER BY quarter DESC')).rows.map(r => r.quarter),
  };

  const issueQueries = {
    getAll: async (status) => {
      // Solved tab: return ALL solved (including archived) so frontend can render them separately
      // All tab / other status tabs: hide archived issues
      if (status === 'solved') {
        const q = await pool.query(
          `${ISSUE_Q} WHERE i.status='solved' ORDER BY i.archived ASC, i.due_date ASC NULLS LAST, votes DESC, i.created_at DESC`
        );
        return q.rows;
      }
      const q = status
        ? await pool.query(`${ISSUE_Q} WHERE i.status=$1 AND NOT i.archived ORDER BY i.due_date ASC NULLS LAST, votes DESC, i.created_at DESC`, [status])
        : await pool.query(`${ISSUE_Q} WHERE NOT i.archived ORDER BY i.due_date ASC NULLS LAST, votes DESC, i.created_at DESC`);
      return q.rows;
    },
    getById: async (id) => (await pool.query(`${ISSUE_Q} WHERE i.id=$1`, [id])).rows[0] ?? null,
    create: async ({ title, description, owner_id, priority, due_date }) => {
      const { rows } = await pool.query(
        'INSERT INTO issues (title,description,owner_id,status,priority,due_date) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [title, description || null, owner_id || null, 'in_progress', priority || 'medium', due_date || null]
      );
      return issueQueries.getById(rows[0].id);
    },
    update: async (id, fields) => {
      const allowed = ['title','description','owner_id','status','priority','archived','due_date'];
      const keys = allowed.filter(k => k in fields);
      if (!keys.length) return issueQueries.getById(id);
      const sets = keys.map((k, i) => `${k}=$${i + 1}`).join(', ');
      await pool.query(
        `UPDATE issues SET ${sets}, updated_at=NOW() WHERE id=$${keys.length + 1}`,
        [...keys.map(k => fields[k]), id]
      );
      return issueQueries.getById(id);
    },
    delete: async (id) => pool.query('DELETE FROM issues WHERE id=$1', [id]),
    vote: async (issueId, userId) => {
      try {
        await pool.query('INSERT INTO issue_votes (issue_id,user_id) VALUES ($1,$2)', [issueId, userId]);
      } catch (e) {
        if (e.code === '23505') {
          await pool.query('DELETE FROM issue_votes WHERE issue_id=$1 AND user_id=$2', [issueId, userId]);
        } else throw e;
      }
      return issueQueries.getById(issueId);
    },
    getUserVotes: async (userId) =>
      (await pool.query('SELECT issue_id FROM issue_votes WHERE user_id=$1', [userId])).rows.map(r => r.issue_id),
  };

  module.exports = { initDb, userQueries, rockQueries, issueQueries };

} else {

/* ══════════════════════════════════════════════════════════════════
   JSON FILE MODE  (local dev, no database needed)
   ══════════════════════════════════════════════════════════════════ */

  const fs   = require('fs');
  const path = require('path');
  // Use /tmp on serverless (read-only app dir), fall back to __dirname locally
  const DATA_FILE = process.env.VERCEL
    ? '/tmp/ninety-data.json'
    : path.join(__dirname, 'data.json');

  const SEED = {
    _seq: { users: 5, rocks: 0, issues: 0 },
    users: [
      { id:1, name:'Logan',  color:'#6366f1', created_at: new Date().toISOString() },
      { id:2, name:'Alex',   color:'#ec4899', created_at: new Date().toISOString() },
      { id:3, name:'Jordan', color:'#f59e0b', created_at: new Date().toISOString() },
      { id:4, name:'Taylor', color:'#10b981', created_at: new Date().toISOString() },
      { id:5, name:'Morgan', color:'#3b82f6', created_at: new Date().toISOString() },
    ],
    rocks: [],
    issues: [],
    issue_votes: [],
  };

  function load() {
    try { if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
    catch (e) { console.error('DB read error, starting fresh:', e.message); }
    return JSON.parse(JSON.stringify(SEED));
  }
  function persist(db) { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }

  const db = load();
  if (!db._seq) db._seq = { users: 5, rocks: 0, issues: 0 };
  persist(db);

  const nowStr = () => new Date().toISOString();
  function nextId(table) { db._seq[table] = (db._seq[table] || 0) + 1; return db._seq[table]; }

  function enrichRock(r) {
    const o = r.owner_id ? db.users.find(u => u.id === r.owner_id) : null;
    return { ...r, owner_name: o?.name ?? null, owner_color: o?.color ?? null };
  }
  function enrichIssue(i) {
    const o = i.owner_id ? db.users.find(u => u.id === i.owner_id) : null;
    const votes = db.issue_votes.filter(v => v.issue_id === i.id).length;
    return { ...i, archived: !!i.archived, due_date: i.due_date || null, owner_name: o?.name ?? null, owner_color: o?.color ?? null, votes };
  }

  const p = v => Promise.resolve(v); // wrap sync results as promises

  const initDb = async () => {};  // no-op in JSON mode

  const userQueries = {
    getAll:   async () => [...db.users].sort((a,b) => a.name.localeCompare(b.name)),
    getById:  async (id) => db.users.find(u => u.id === +id) ?? null,
    create:   async (name, color) => {
      const user = { id: nextId('users'), name, color: color || '#6366f1', created_at: nowStr() };
      db.users.push(user); persist(db); return user;
    },
    update: async (id, name, color) => {
      const u = db.users.find(u => u.id === +id); if (!u) return null;
      u.name = name; u.color = color; persist(db); return u;
    },
    delete: async (id) => { db.users = db.users.filter(u => u.id !== +id); persist(db); },
  };

  const rockQueries = {
    getAll: async (quarter) => {
      const list = quarter ? db.rocks.filter(r => r.quarter === quarter) : [...db.rocks];
      return list.sort((a,b) => b.created_at.localeCompare(a.created_at)).map(enrichRock);
    },
    getById: async (id) => { const r = db.rocks.find(r => r.id === +id); return r ? enrichRock(r) : null; },
    create: async ({ title, description, owner_id, quarter, status, progress }) => {
      const rock = { id: nextId('rocks'), title, description: description || null,
        owner_id: owner_id ? +owner_id : null, quarter, status: status || 'not_started',
        progress: progress || 0, created_at: nowStr(), updated_at: nowStr() };
      db.rocks.push(rock); persist(db); return enrichRock(rock);
    },
    update: async (id, fields) => {
      const r = db.rocks.find(r => r.id === +id); if (!r) return null;
      ['title','description','owner_id','quarter','status','progress'].forEach(k => { if (k in fields) r[k] = fields[k]; });
      if ('owner_id' in fields && fields.owner_id) r.owner_id = +fields.owner_id;
      r.updated_at = nowStr(); persist(db); return enrichRock(r);
    },
    delete: async (id) => { db.rocks = db.rocks.filter(r => r.id !== +id); persist(db); },
    quarters: async () => [...new Set(db.rocks.map(r => r.quarter))].sort().reverse(),
  };

  const issueQueries = {
    getAll: async (status) => {
      const dueCmp = (a, b) => {
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return a.due_date.localeCompare(b.due_date);
      };
      // Solved tab: return ALL solved (archived + non-archived), sorted archived last
      if (status === 'solved') {
        return db.issues
          .filter(i => i.status === 'solved')
          .map(enrichIssue)
          .sort((a, b) => Number(!!a.archived) - Number(!!b.archived) || dueCmp(a, b) || b.votes - a.votes || b.created_at.localeCompare(a.created_at));
      }
      // All tab / other tabs: hide archived
      const list = status
        ? db.issues.filter(i => i.status === status && !i.archived)
        : db.issues.filter(i => !i.archived);
      return list.map(enrichIssue).sort((a, b) => dueCmp(a, b) || b.votes - a.votes || b.created_at.localeCompare(a.created_at));
    },
    getById: async (id) => { const i = db.issues.find(i => i.id === +id); return i ? enrichIssue(i) : null; },
    create: async ({ title, description, owner_id, priority, due_date }) => {
      const issue = { id: nextId('issues'), title, description: description || null,
        owner_id: owner_id ? +owner_id : null, status: 'in_progress', priority: priority || 'medium',
        archived: false, due_date: due_date || null, created_at: nowStr(), updated_at: nowStr() };
      db.issues.push(issue); persist(db); return enrichIssue(issue);
    },
    update: async (id, fields) => {
      const i = db.issues.find(i => i.id === +id); if (!i) return null;
      ['title','description','owner_id','status','priority','archived','due_date'].forEach(k => { if (k in fields) i[k] = fields[k]; });
      if ('owner_id' in fields && fields.owner_id) i.owner_id = +fields.owner_id;
      i.updated_at = nowStr(); persist(db); return enrichIssue(i);
    },
    delete: async (id) => {
      db.issues = db.issues.filter(i => i.id !== +id);
      db.issue_votes = db.issue_votes.filter(v => v.issue_id !== +id);
      persist(db);
    },
    vote: async (issueId, userId) => {
      const idx = db.issue_votes.findIndex(v => v.issue_id === +issueId && v.user_id === +userId);
      if (idx >= 0) db.issue_votes.splice(idx, 1);
      else db.issue_votes.push({ issue_id: +issueId, user_id: +userId });
      persist(db);
      return issueQueries.getById(issueId);
    },
    getUserVotes: async (userId) =>
      db.issue_votes.filter(v => v.user_id === +userId).map(v => v.issue_id),
  };

  module.exports = { initDb, userQueries, rockQueries, issueQueries };
}
