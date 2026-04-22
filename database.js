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
        name       TEXT NOT NULL,
        email      TEXT UNIQUE,
        color      TEXT NOT NULL DEFAULT '#6366f1',
        picture    TEXT,
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

      CREATE TABLE IF NOT EXISTS rock_milestones (
        id          SERIAL PRIMARY KEY,
        rock_id     INTEGER NOT NULL REFERENCES rocks(id) ON DELETE CASCADE,
        title       TEXT NOT NULL,
        due_date    DATE,
        owner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        done        BOOLEAN NOT NULL DEFAULT FALSE,
        sort_order  INTEGER NOT NULL DEFAULT 0,
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
        private     BOOLEAN NOT NULL DEFAULT FALSE,
        due_date    DATE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS issue_votes (
        issue_id  INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (issue_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS agendas (
        id         SERIAL PRIMARY KEY,
        title      TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS agenda_sections (
        id               SERIAL PRIMARY KEY,
        agenda_id        INTEGER NOT NULL REFERENCES agendas(id) ON DELETE CASCADE,
        name             TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL DEFAULT 5,
        visible          BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order       INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS meetings (
        id                SERIAL PRIMARY KEY,
        agenda_id         INTEGER REFERENCES agendas(id) ON DELETE SET NULL,
        title             TEXT NOT NULL,
        scheduled_at      TIMESTAMPTZ,
        started_at        TIMESTAMPTZ,
        ended_at          TIMESTAMPTZ,
        status            TEXT NOT NULL DEFAULT 'upcoming',
        sections_snapshot JSONB,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS meeting_attendees (
        meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (meeting_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS team_issues (
        id          SERIAL PRIMARY KEY,
        title       TEXT NOT NULL,
        description TEXT,
        owner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        horizon     TEXT NOT NULL DEFAULT 'short_term',
        status      TEXT NOT NULL DEFAULT 'in_progress',
        archived    BOOLEAN NOT NULL DEFAULT FALSE,
        top_rank    SMALLINT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (top_rank IS NULL OR top_rank BETWEEN 1 AND 3)
      );

      CREATE TABLE IF NOT EXISTS coaching_calls (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        call_date   DATE NOT NULL DEFAULT CURRENT_DATE,
        summary     TEXT,
        gratitude   TEXT,
        transcript  TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS coaching_commitments (
        id        SERIAL PRIMARY KEY,
        call_id   INTEGER NOT NULL REFERENCES coaching_calls(id) ON DELETE CASCADE,
        issue_id  INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_coaching_calls_user ON coaching_calls(user_id, call_date DESC);
      CREATE INDEX IF NOT EXISTS idx_coaching_commitments_call ON coaching_commitments(call_id);
    `);
    // Migrate existing tables that may lack newer columns
    await pool.query(`
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS due_date DATE;
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS private  BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS source   TEXT NOT NULL DEFAULT 'manual';
      ALTER TABLE users  ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
      ALTER TABLE users  ADD COLUMN IF NOT EXISTS picture TEXT;
      ALTER TABLE agenda_sections ADD COLUMN IF NOT EXISTS shows_issues BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE agenda_sections ADD COLUMN IF NOT EXISTS shows_todos  BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE rock_milestones ADD COLUMN IF NOT EXISTS promoted_to_todo_at TIMESTAMPTZ;
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS source_milestone_id INTEGER REFERENCES rock_milestones(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_issues_source_milestone ON issues(source_milestone_id);
    `);
    // Rename legacy statuses to new names and fix column default
    await pool.query(`
      UPDATE issues SET status='in_progress' WHERE status='identified';
      UPDATE issues SET status='blocker'     WHERE status='discussing';
      ALTER TABLE issues ALTER COLUMN status SET DEFAULT 'in_progress';
    `);

    // No seed users — accounts are created via Google OAuth on first login
  }

  const ROCK_Q = `
    SELECT r.*, u.name AS owner_name, u.color AS owner_color, u.picture AS owner_picture,
           (SELECT COUNT(*)::int FROM rock_milestones m WHERE m.rock_id = r.id) AS milestone_count,
           (SELECT COUNT(*)::int FROM rock_milestones m WHERE m.rock_id = r.id AND m.done) AS milestone_done_count
    FROM rocks r LEFT JOIN users u ON r.owner_id = u.id
  `;
  const ISSUE_Q = `
    SELECT i.id, i.title, i.description, i.owner_id, i.status, i.priority,
           i.archived, i.private, i.due_date, i.created_at, i.updated_at,
           u.name AS owner_name, u.color AS owner_color, u.picture AS owner_picture
    FROM issues i LEFT JOIN users u ON i.owner_id = u.id
  `;

  const userQueries = {
    getAll: async () => (await pool.query('SELECT * FROM users ORDER BY name')).rows,
    getById: async (id) => (await pool.query('SELECT * FROM users WHERE id=$1', [id])).rows[0] ?? null,
    getByEmail: async (email) => (await pool.query('SELECT * FROM users WHERE email=$1', [email])).rows[0] ?? null,
    create: async (name, color) => (await pool.query(
      'INSERT INTO users (name,color) VALUES ($1,$2) RETURNING *', [name, color || '#6366f1']
    )).rows[0],
    update: async (id, name, color) => (await pool.query(
      'UPDATE users SET name=$1,color=$2 WHERE id=$3 RETURNING *', [name, color, id]
    )).rows[0] ?? null,
    delete: async (id) => pool.query('DELETE FROM users WHERE id=$1', [id]),
    findOrCreateByEmail: async (email, name, picture) => {
      const colors = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ef4444'];
      const existing = (await pool.query('SELECT * FROM users WHERE email=$1', [email])).rows[0];
      if (existing) {
        // Keep name and picture in sync with Google profile
        return (await pool.query('UPDATE users SET name=$1, picture=$2 WHERE id=$3 RETURNING *', [name, picture || null, existing.id])).rows[0];
      }
      const count = (await pool.query('SELECT COUNT(*)::int AS c FROM users')).rows[0].c;
      const color = colors[count % colors.length];
      return (await pool.query(
        'INSERT INTO users (name,email,color,picture) VALUES ($1,$2,$3,$4) RETURNING *', [name, email, color, picture || null]
      )).rows[0];
    },
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
    // Private issues are visible only to their owner. Non-owners never see them —
    // callers must pass currentUserId so the filter can be applied in SQL.
    // includeArchived=true returns archived rows too (for client-side filtering / stats).
    getAll: async (status, currentUserId, includeArchived) => {
      const uid = currentUserId ?? 0; // 0 never matches a real user id
      const archCond = includeArchived ? '' : 'AND NOT i.archived';
      // Solved tab: return ALL solved (including archived) so frontend can render them separately
      if (status === 'solved') {
        const q = await pool.query(
          `${ISSUE_Q} WHERE i.status='solved' AND (NOT i.private OR i.owner_id=$1) ORDER BY i.archived ASC, i.due_date ASC NULLS LAST, i.created_at DESC`,
          [uid]
        );
        return q.rows;
      }
      const q = status
        ? await pool.query(`${ISSUE_Q} WHERE i.status=$1 ${archCond} AND (NOT i.private OR i.owner_id=$2) ORDER BY i.due_date ASC NULLS LAST, i.created_at DESC`, [status, uid])
        : await pool.query(`${ISSUE_Q} WHERE 1=1 ${archCond} AND (NOT i.private OR i.owner_id=$1) ORDER BY i.archived ASC, i.due_date ASC NULLS LAST, i.created_at DESC`, [uid]);
      return q.rows;
    },
    getById: async (id) => (await pool.query(`${ISSUE_Q} WHERE i.id=$1`, [id])).rows[0] ?? null,
    create: async ({ title, description, owner_id, priority, due_date, private: isPrivate, source }) => {
      const { rows } = await pool.query(
        'INSERT INTO issues (title,description,owner_id,status,priority,due_date,private,source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
        [title, description || null, owner_id || null, 'in_progress', priority || 'medium', due_date || null, !!isPrivate, source || 'manual']
      );
      return issueQueries.getById(rows[0].id);
    },
    update: async (id, fields) => {
      const allowed = ['title','description','owner_id','status','priority','archived','private','due_date'];
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
  };

  const agendaQueries = {
    getAll: async () => (await pool.query('SELECT * FROM agendas ORDER BY created_at DESC')).rows,
    getById: async (id) => (await pool.query('SELECT * FROM agendas WHERE id=$1', [id])).rows[0] ?? null,
    getSections: async (id) => (await pool.query(
      'SELECT * FROM agenda_sections WHERE agenda_id=$1 ORDER BY sort_order ASC, id ASC', [id]
    )).rows,
    create: async ({ title }) => (await pool.query('INSERT INTO agendas (title) VALUES ($1) RETURNING *', [title])).rows[0],
    update: async (id, { title }) => (await pool.query('UPDATE agendas SET title=$1 WHERE id=$2 RETURNING *', [title, id])).rows[0] ?? null,
    delete: async (id) => pool.query('DELETE FROM agendas WHERE id=$1', [id]),
    addSection: async (agendaId, { name, duration_minutes, visible, sort_order, shows_issues, shows_todos }) => (await pool.query(
      'INSERT INTO agenda_sections (agenda_id,name,duration_minutes,visible,sort_order,shows_issues,shows_todos) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [agendaId, name, duration_minutes ?? 5, visible !== false, sort_order ?? 0, !!shows_issues, !!shows_todos]
    )).rows[0],
    updateSection: async (id, fields) => {
      const allowed = ['name','duration_minutes','visible','sort_order','shows_issues','shows_todos'];
      const keys = allowed.filter(k => k in fields);
      if (!keys.length) return null;
      const sets = keys.map((k,i) => `${k}=$${i+1}`).join(', ');
      return (await pool.query(`UPDATE agenda_sections SET ${sets} WHERE id=$${keys.length+1} RETURNING *`,
        [...keys.map(k => fields[k]), id])).rows[0] ?? null;
    },
    deleteSection: async (id) => pool.query('DELETE FROM agenda_sections WHERE id=$1', [id]),
  };

  async function attachAttendees(meetings) {
    if (!meetings || meetings.length === 0) return meetings;
    const ids = meetings.map(m => m.id);
    const { rows } = await pool.query(
      `SELECT ma.meeting_id, u.id, u.name, u.color, u.picture
       FROM meeting_attendees ma JOIN users u ON u.id = ma.user_id
       WHERE ma.meeting_id = ANY($1::int[])
       ORDER BY u.name ASC`,
      [ids]
    );
    const byMeeting = {};
    rows.forEach(r => {
      if (!byMeeting[r.meeting_id]) byMeeting[r.meeting_id] = [];
      byMeeting[r.meeting_id].push({ id: r.id, name: r.name, color: r.color, picture: r.picture });
    });
    meetings.forEach(m => { m.attendees = byMeeting[m.id] || []; });
    return meetings;
  }

  const meetingQueries = {
    getAll: async (status) => {
      const q = status
        ? await pool.query('SELECT * FROM meetings WHERE status=$1 ORDER BY COALESCE(scheduled_at,created_at) DESC', [status])
        : await pool.query('SELECT * FROM meetings ORDER BY COALESCE(scheduled_at,created_at) DESC');
      return attachAttendees(q.rows);
    },
    getById: async (id) => {
      const row = (await pool.query('SELECT * FROM meetings WHERE id=$1', [id])).rows[0] ?? null;
      if (!row) return null;
      await attachAttendees([row]);
      return row;
    },
    create: async ({ agenda_id, title, scheduled_at, sections_snapshot, attendee_ids }) => {
      const { rows } = await pool.query(
        'INSERT INTO meetings (agenda_id,title,scheduled_at,sections_snapshot) VALUES ($1,$2,$3,$4) RETURNING *',
        [agenda_id || null, title, scheduled_at || null, sections_snapshot ? JSON.stringify(sections_snapshot) : null]
      );
      const meeting = rows[0];
      if (Array.isArray(attendee_ids) && attendee_ids.length) {
        await meetingQueries.setAttendees(meeting.id, attendee_ids);
      }
      return meetingQueries.getById(meeting.id);
    },
    update: async (id, fields) => {
      const allowed = ['title','scheduled_at','started_at','ended_at','status','sections_snapshot'];
      const keys = allowed.filter(k => k in fields);
      if (!keys.length) return meetingQueries.getById(id);
      const sets = keys.map((k,i) => `${k}=$${i+1}`).join(', ');
      await pool.query(`UPDATE meetings SET ${sets} WHERE id=$${keys.length+1}`,
        [...keys.map(k => k === 'sections_snapshot' && fields[k] != null ? JSON.stringify(fields[k]) : fields[k]), id]);
      return meetingQueries.getById(id);
    },
    delete: async (id) => pool.query('DELETE FROM meetings WHERE id=$1', [id]),
    // Replace the attendee list. Caller enforces whether this is allowed (e.g. only while upcoming).
    setAttendees: async (meetingId, userIds) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM meeting_attendees WHERE meeting_id=$1', [meetingId]);
        const unique = Array.from(new Set((userIds || []).map(Number).filter(Boolean)));
        for (const uid of unique) {
          await client.query('INSERT INTO meeting_attendees (meeting_id,user_id) VALUES ($1,$2)', [meetingId, uid]);
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
      return meetingQueries.getById(meetingId);
    },
  };

  const TEAM_ISSUE_Q = `
    SELECT ti.*, u.name AS owner_name, u.color AS owner_color, u.picture AS owner_picture
    FROM team_issues ti LEFT JOIN users u ON ti.owner_id = u.id
  `;
  const teamIssueQueries = {
    getAll: async ({ horizon, status, includeArchived } = {}) => {
      const where = [];
      const params = [];
      if (horizon)            { params.push(horizon); where.push(`ti.horizon=$${params.length}`); }
      if (status)             { params.push(status);  where.push(`ti.status=$${params.length}`); }
      if (!includeArchived)   { where.push('NOT ti.archived'); }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const q = await pool.query(
        `${TEAM_ISSUE_Q} ${whereSql} ORDER BY ti.archived ASC, ti.top_rank ASC NULLS LAST, ti.created_at DESC`,
        params
      );
      return q.rows;
    },
    getById: async (id) => (await pool.query(`${TEAM_ISSUE_Q} WHERE ti.id=$1`, [id])).rows[0] ?? null,
    create: async ({ title, description, owner_id, horizon }) => {
      const { rows } = await pool.query(
        'INSERT INTO team_issues (title,description,owner_id,horizon) VALUES ($1,$2,$3,$4) RETURNING id',
        [title, description || null, owner_id || null, horizon || 'short_term']
      );
      return teamIssueQueries.getById(rows[0].id);
    },
    update: async (id, fields) => {
      const allowed = ['title','description','owner_id','horizon','status','archived'];
      const keys = allowed.filter(k => k in fields);
      if (!keys.length) return teamIssueQueries.getById(id);
      const sets = keys.map((k, i) => `${k}=$${i + 1}`).join(', ');
      await pool.query(
        `UPDATE team_issues SET ${sets}, updated_at=NOW() WHERE id=$${keys.length + 1}`,
        [...keys.map(k => fields[k]), id]
      );
      return teamIssueQueries.getById(id);
    },
    delete: async (id) => pool.query('DELETE FROM team_issues WHERE id=$1', [id]),
    // Atomically set rank on one issue, clearing any other issue currently at that rank.
    setRank: async (id, rank) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (rank != null) {
          await client.query('UPDATE team_issues SET top_rank=NULL, updated_at=NOW() WHERE top_rank=$1 AND id<>$2', [rank, id]);
        }
        await client.query('UPDATE team_issues SET top_rank=$1, updated_at=NOW() WHERE id=$2', [rank, id]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
      return teamIssueQueries.getById(id);
    },
  };

  const coachingQueries = {
    // Creates a coaching call + its commitments (as issues, source='coaching', private=true)
    // atomically. Returns { call_id, issue_ids }.
    createCall: async ({ user_id, summary, gratitude, transcript, commitments }) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const call = await client.query(
          `INSERT INTO coaching_calls (user_id, summary, gratitude, transcript)
           VALUES ($1,$2,$3,$4) RETURNING id, call_date, created_at`,
          [user_id, summary || null, gratitude || null, transcript || null]
        );
        const callId = call.rows[0].id;
        // Default due: tomorrow 23:59 in server TZ
        const due = new Date(); due.setDate(due.getDate() + 1);
        const dueStr = due.toISOString().slice(0, 10);

        const issueIds = [];
        for (const c of (commitments || [])) {
          const t = (c && c.title ? String(c.title).trim() : '');
          if (!t) continue;
          const i = await client.query(
            `INSERT INTO issues (title, description, owner_id, status, priority, due_date, private, source)
             VALUES ($1,$2,$3,'in_progress',$4,$5,TRUE,'coaching') RETURNING id`,
            [t, c.description || null, user_id, c.priority || 'medium', c.due_date || dueStr]
          );
          const issueId = i.rows[0].id;
          await client.query(
            'INSERT INTO coaching_commitments (call_id, issue_id) VALUES ($1,$2)',
            [callId, issueId]
          );
          issueIds.push(issueId);
        }
        await client.query('COMMIT');
        return { call_id: callId, issue_ids: issueIds };
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },

    // Context Stella reads before each call: yesterday's commitments + completion,
    // current streak (consecutive calendar days with any call), active rocks.
    getContext: async (user_id) => {
      const yesterday = await pool.query(
        `SELECT i.id, i.title, (i.status='solved') AS completed
         FROM coaching_commitments cc
         JOIN coaching_calls cl ON cl.id = cc.call_id
         JOIN issues i ON i.id = cc.issue_id
         WHERE cl.user_id = $1 AND cl.call_date = CURRENT_DATE - INTERVAL '1 day'
         ORDER BY cc.id ASC`,
        [user_id]
      );

      // Streak: count consecutive days back from today (or yesterday if no call today)
      // where at least one call exists for this user.
      const streakRes = await pool.query(
        `WITH days AS (
           SELECT DISTINCT call_date FROM coaching_calls WHERE user_id=$1
         )
         SELECT call_date FROM days ORDER BY call_date DESC LIMIT 60`,
        [user_id]
      );
      let streak = 0;
      const today = new Date(); today.setHours(0,0,0,0);
      let cursor = new Date(today);
      const dateSet = new Set(streakRes.rows.map(r => new Date(r.call_date).toISOString().slice(0,10)));
      // If no call today, start streak count from yesterday
      if (!dateSet.has(cursor.toISOString().slice(0,10))) cursor.setDate(cursor.getDate() - 1);
      while (dateSet.has(cursor.toISOString().slice(0,10))) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      }

      const rocks = await pool.query(
        `SELECT id, title, status, progress FROM rocks
         WHERE owner_id=$1 AND status <> 'complete'
         ORDER BY created_at DESC`,
        [user_id]
      );

      return {
        yesterday_commitments: yesterday.rows,
        streak_days: streak,
        active_rocks: rocks.rows,
      };
    },

    // Paginated timeline for the Stella tab. Returns calls (without transcript)
    // with their linked to-dos + completion status; excludes calls with no
    // transcript AND no commitments AND no summary (skips empty smoke-test probes).
    listCalls: async (user_id, limit, offset) => {
      const lim = Math.min(Math.max(+limit || 20, 1), 100);
      const off = Math.max(+offset || 0, 0);
      const calls = await pool.query(
        `SELECT id, call_date, summary, gratitude, created_at
         FROM coaching_calls
         WHERE user_id = $1
           AND (summary IS NOT NULL OR transcript IS NOT NULL
                OR EXISTS (SELECT 1 FROM coaching_commitments cc WHERE cc.call_id = coaching_calls.id))
         ORDER BY call_date DESC, created_at DESC
         LIMIT $2 OFFSET $3`,
        [user_id, lim, off]
      );
      if (!calls.rows.length) return { calls: [], has_more: false };

      const ids = calls.rows.map(c => c.id);
      const commits = await pool.query(
        `SELECT cc.call_id, i.id, i.title, i.priority, i.due_date,
                (i.status = 'solved') AS completed, i.status
         FROM coaching_commitments cc
         JOIN issues i ON i.id = cc.issue_id
         WHERE cc.call_id = ANY($1::int[])
         ORDER BY cc.id ASC`,
        [ids]
      );
      const byCall = {};
      commits.rows.forEach(r => {
        (byCall[r.call_id] = byCall[r.call_id] || []).push({
          id: r.id, title: r.title, priority: r.priority,
          due_date: r.due_date, completed: r.completed, status: r.status,
        });
      });
      const rows = calls.rows.map(c => ({ ...c, commitments: byCall[c.id] || [] }));
      // Cheap has_more probe: if we filled the page, there may be more
      const more = await pool.query(
        `SELECT 1 FROM coaching_calls WHERE user_id=$1
           AND (summary IS NOT NULL OR transcript IS NOT NULL
                OR EXISTS (SELECT 1 FROM coaching_commitments cc WHERE cc.call_id = coaching_calls.id))
         ORDER BY call_date DESC, created_at DESC OFFSET $2 LIMIT 1`,
        [user_id, off + lim]
      );
      return { calls: rows, has_more: more.rows.length > 0 };
    },

    getCallById: async (call_id, user_id) => {
      const call = await pool.query(
        `SELECT id, call_date, summary, gratitude, transcript, created_at
         FROM coaching_calls WHERE id=$1 AND user_id=$2`,
        [call_id, user_id]
      );
      if (!call.rows.length) return null;
      const commits = await pool.query(
        `SELECT i.id, i.title, i.priority, i.due_date, i.description,
                (i.status = 'solved') AS completed, i.status
         FROM coaching_commitments cc
         JOIN issues i ON i.id = cc.issue_id
         WHERE cc.call_id = $1 ORDER BY cc.id ASC`,
        [call_id]
      );
      return { ...call.rows[0], commitments: commits.rows };
    },

    getStats: async (user_id) => {
      const res = await pool.query(
        `SELECT
           COUNT(*)::int AS all_calls,
           COUNT(*) FILTER (WHERE call_date >= CURRENT_DATE - INTERVAL '6 days')::int  AS calls_7d,
           COUNT(*) FILTER (WHERE call_date >= CURRENT_DATE - INTERVAL '29 days')::int AS calls_30d,
           COUNT(*) FILTER (WHERE call_date >= CURRENT_DATE - INTERVAL '89 days')::int AS calls_90d
         FROM coaching_calls WHERE user_id = $1`,
        [user_id]
      );
      const commitRes = await pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE cl.call_date >= CURRENT_DATE - INTERVAL '6 days')::int AS total_7d,
           COUNT(*) FILTER (WHERE cl.call_date >= CURRENT_DATE - INTERVAL '6 days'  AND i.status='solved')::int AS done_7d,
           COUNT(*) FILTER (WHERE cl.call_date >= CURRENT_DATE - INTERVAL '29 days')::int AS total_30d,
           COUNT(*) FILTER (WHERE cl.call_date >= CURRENT_DATE - INTERVAL '29 days' AND i.status='solved')::int AS done_30d,
           COUNT(*) FILTER (WHERE cl.call_date >= CURRENT_DATE - INTERVAL '89 days')::int AS total_90d,
           COUNT(*) FILTER (WHERE cl.call_date >= CURRENT_DATE - INTERVAL '89 days' AND i.status='solved')::int AS done_90d
         FROM coaching_commitments cc
         JOIN coaching_calls cl ON cl.id = cc.call_id
         JOIN issues i ON i.id = cc.issue_id
         WHERE cl.user_id = $1`,
        [user_id]
      );
      // Reuse streak logic from getContext
      const streakRes = await pool.query(
        `SELECT DISTINCT call_date FROM coaching_calls WHERE user_id=$1
         ORDER BY call_date DESC LIMIT 60`, [user_id]
      );
      let streak = 0;
      const today = new Date(); today.setHours(0,0,0,0);
      let cursor = new Date(today);
      const dateSet = new Set(streakRes.rows.map(r => new Date(r.call_date).toISOString().slice(0,10)));
      if (!dateSet.has(cursor.toISOString().slice(0,10))) cursor.setDate(cursor.getDate() - 1);
      while (dateSet.has(cursor.toISOString().slice(0,10))) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      }

      const pct = (d, t) => (t ? Math.round((d / t) * 100) : null);
      const c = commitRes.rows[0];
      return {
        calls: res.rows[0],
        streak_days: streak,
        completion: {
          last_7d:  { total: c.total_7d,  done: c.done_7d,  pct: pct(c.done_7d,  c.total_7d)  },
          last_30d: { total: c.total_30d, done: c.done_30d, pct: pct(c.done_30d, c.total_30d) },
          last_90d: { total: c.total_90d, done: c.done_90d, pct: pct(c.done_90d, c.total_90d) },
        },
      };
    },
  };

  const MILESTONE_Q = `
    SELECT m.*, u.name AS owner_name, u.color AS owner_color, u.picture AS owner_picture
    FROM rock_milestones m LEFT JOIN users u ON m.owner_id = u.id
  `;
  // Keep the rock's progress in sync when milestones exist; when the last milestone
  // is deleted, the stored progress is left alone so manual mode continues to work.
  async function syncRockProgressFromMilestones(rockId) {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE done)::int AS done_count
       FROM rock_milestones WHERE rock_id=$1`,
      [rockId]
    );
    const { total, done_count } = rows[0];
    if (total > 0) {
      const pct = Math.round((done_count / total) * 100);
      await pool.query('UPDATE rocks SET progress=$1, updated_at=NOW() WHERE id=$2', [pct, rockId]);
    }
  }

  const milestoneQueries = {
    getByRock: async (rockId) => (await pool.query(
      `${MILESTONE_Q} WHERE m.rock_id=$1 ORDER BY m.sort_order ASC, m.id ASC`,
      [rockId]
    )).rows,
    getById: async (id) => (await pool.query(`${MILESTONE_Q} WHERE m.id=$1`, [id])).rows[0] ?? null,
    create: async (rockId, { title, due_date, owner_id, sort_order }) => {
      const { rows } = await pool.query(
        'INSERT INTO rock_milestones (rock_id,title,due_date,owner_id,sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [rockId, title, due_date || null, owner_id || null, sort_order ?? 0]
      );
      await syncRockProgressFromMilestones(rockId);
      return milestoneQueries.getById(rows[0].id);
    },
    update: async (id, fields) => {
      const allowed = ['title','due_date','owner_id','done','sort_order'];
      const keys = allowed.filter(k => k in fields);
      if (!keys.length) return milestoneQueries.getById(id);
      const sets = keys.map((k, i) => `${k}=$${i + 1}`).join(', ');
      await pool.query(
        `UPDATE rock_milestones SET ${sets}, updated_at=NOW() WHERE id=$${keys.length + 1}`,
        [...keys.map(k => fields[k]), id]
      );
      const fresh = await milestoneQueries.getById(id);
      if (fresh) await syncRockProgressFromMilestones(fresh.rock_id);
      return fresh;
    },
    delete: async (id) => {
      const m = await milestoneQueries.getById(id);
      await pool.query('DELETE FROM rock_milestones WHERE id=$1', [id]);
      if (m) await syncRockProgressFromMilestones(m.rock_id);
    },
    // Promote each milestone due within 7 days to a to-do, exactly once.
    // Already-promoted milestones (promoted_to_todo_at IS NOT NULL) are skipped,
    // so deleting the generated to-do won't resurrect it.
    promoteDue: async () => {
      const client = await pool.connect();
      let promoted = 0; let checked = 0;
      try {
        await client.query('BEGIN');
        const { rows: due } = await client.query(
          `SELECT m.*, r.title AS rock_title, r.owner_id AS rock_owner_id
           FROM rock_milestones m
           JOIN rocks r ON r.id = m.rock_id
           WHERE m.done = FALSE
             AND m.promoted_to_todo_at IS NULL
             AND m.due_date IS NOT NULL
             AND m.due_date <= CURRENT_DATE + INTERVAL '7 days'
           FOR UPDATE OF m`
        );
        checked = due.length;
        for (const m of due) {
          const ownerId = m.owner_id ?? m.rock_owner_id ?? null;
          await client.query(
            `INSERT INTO issues (title, description, owner_id, status, priority, due_date, private, source, source_milestone_id)
             VALUES ($1, $2, $3, 'in_progress', 'medium', $4, FALSE, 'manual', $5)`,
            [m.title, `Milestone for rock: ${m.rock_title}`, ownerId, m.due_date, m.id]
          );
          await client.query(
            'UPDATE rock_milestones SET promoted_to_todo_at = NOW() WHERE id = $1',
            [m.id]
          );
          promoted++;
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
      return { promoted, checked };
    },
  };

  module.exports = { initDb, pool, userQueries, rockQueries, issueQueries, agendaQueries, meetingQueries, teamIssueQueries, milestoneQueries, coachingQueries };

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
    const mList = (db.rock_milestones || []).filter(m => m.rock_id === r.id);
    return {
      ...r,
      owner_name: o?.name ?? null,
      owner_color: o?.color ?? null,
      owner_picture: o?.picture ?? null,
      milestone_count: mList.length,
      milestone_done_count: mList.filter(m => m.done).length,
    };
  }

  function enrichMilestone(m) {
    const o = m.owner_id ? db.users.find(u => u.id === m.owner_id) : null;
    return {
      ...m,
      done: !!m.done,
      due_date: m.due_date || null,
      owner_name: o?.name ?? null,
      owner_color: o?.color ?? null,
      owner_picture: o?.picture ?? null,
    };
  }
  function enrichIssue(i) {
    const o = i.owner_id ? db.users.find(u => u.id === i.owner_id) : null;
    return { ...i, archived: !!i.archived, private: !!i.private, due_date: i.due_date || null, owner_name: o?.name ?? null, owner_color: o?.color ?? null, owner_picture: o?.picture ?? null };
  }

  const p = v => Promise.resolve(v); // wrap sync results as promises

  const initDb = async () => {};  // no-op in JSON mode

  const userQueries = {
    getAll:   async () => [...db.users].sort((a,b) => a.name.localeCompare(b.name)),
    getById:  async (id) => db.users.find(u => u.id === +id) ?? null,
    getByEmail: async (email) => db.users.find(u => u.email === email) ?? null,
    create:   async (name, color) => {
      const user = { id: nextId('users'), name, color: color || '#6366f1', created_at: nowStr() };
      db.users.push(user); persist(db); return user;
    },
    update: async (id, name, color) => {
      const u = db.users.find(u => u.id === +id); if (!u) return null;
      u.name = name; u.color = color; persist(db); return u;
    },
    delete: async (id) => { db.users = db.users.filter(u => u.id !== +id); persist(db); },
    findOrCreateByEmail: async (email, name, picture) => {
      const colors = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ef4444'];
      const existing = db.users.find(u => u.email === email);
      if (existing) { existing.name = name; existing.picture = picture || null; persist(db); return existing; }
      const color = colors[db.users.length % colors.length];
      const user = { id: nextId('users'), name, email, color, picture: picture || null, created_at: nowStr() };
      db.users.push(user); persist(db); return user;
    },
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
    delete: async (id) => {
      db.rocks = db.rocks.filter(r => r.id !== +id);
      if (db.rock_milestones) db.rock_milestones = db.rock_milestones.filter(m => m.rock_id !== +id);
      persist(db);
    },
    quarters: async () => [...new Set(db.rocks.map(r => r.quarter))].sort().reverse(),
  };

  const issueQueries = {
    // Private issues are visible only to their owner. Non-owners never see them —
    // callers must pass currentUserId so the filter can be applied.
    // includeArchived=true returns archived rows too (for client-side filtering / stats).
    getAll: async (status, currentUserId, includeArchived) => {
      const uid = currentUserId ? +currentUserId : 0;
      const visible = (i) => !i.private || i.owner_id === uid;
      const archOk = (i) => includeArchived || !i.archived;
      const dueCmp = (a, b) => {
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return a.due_date.localeCompare(b.due_date);
      };
      // Solved tab: return ALL solved (archived + non-archived), sorted archived last
      if (status === 'solved') {
        return db.issues
          .filter(i => i.status === 'solved' && visible(i))
          .map(enrichIssue)
          .sort((a, b) => Number(!!a.archived) - Number(!!b.archived) || dueCmp(a, b) || b.created_at.localeCompare(a.created_at));
      }
      const list = status
        ? db.issues.filter(i => i.status === status && archOk(i) && visible(i))
        : db.issues.filter(i => archOk(i) && visible(i));
      return list
        .map(enrichIssue)
        .sort((a, b) => Number(!!a.archived) - Number(!!b.archived) || dueCmp(a, b) || b.created_at.localeCompare(a.created_at));
    },
    getById: async (id) => { const i = db.issues.find(i => i.id === +id); return i ? enrichIssue(i) : null; },
    create: async ({ title, description, owner_id, priority, due_date, private: isPrivate, source }) => {
      const issue = { id: nextId('issues'), title, description: description || null,
        owner_id: owner_id ? +owner_id : null, status: 'in_progress', priority: priority || 'medium',
        archived: false, private: !!isPrivate, due_date: due_date || null,
        source: source || 'manual', created_at: nowStr(), updated_at: nowStr() };
      db.issues.push(issue); persist(db); return enrichIssue(issue);
    },
    update: async (id, fields) => {
      const i = db.issues.find(i => i.id === +id); if (!i) return null;
      ['title','description','owner_id','status','priority','archived','private','due_date'].forEach(k => { if (k in fields) i[k] = fields[k]; });
      if ('owner_id' in fields && fields.owner_id) i.owner_id = +fields.owner_id;
      i.updated_at = nowStr(); persist(db); return enrichIssue(i);
    },
    delete: async (id) => {
      db.issues = db.issues.filter(i => i.id !== +id);
      persist(db);
    },
  };

  if (!db.agendas)       { db.agendas = []; }
  if (!db.agenda_sections) { db.agenda_sections = []; }
  if (!db.meetings)      { db.meetings = []; }
  if (!db.team_issues)   { db.team_issues = []; }
  if (!db.rock_milestones) { db.rock_milestones = []; }
  if (!db._seq.agendas)  { db._seq.agendas = 0; }
  if (!db._seq.agenda_sections) { db._seq.agenda_sections = 0; }
  if (!db._seq.meetings) { db._seq.meetings = 0; }
  if (!db._seq.team_issues) { db._seq.team_issues = 0; }
  if (!db._seq.rock_milestones) { db._seq.rock_milestones = 0; }
  persist(db);

  function enrichTeamIssue(ti) {
    const o = ti.owner_id ? db.users.find(u => u.id === ti.owner_id) : null;
    return { ...ti, archived: !!ti.archived, top_rank: ti.top_rank ?? null, owner_name: o?.name ?? null, owner_color: o?.color ?? null, owner_picture: o?.picture ?? null };
  }

  const agendaQueries = {
    getAll: async () => [...db.agendas].sort((a,b) => b.created_at.localeCompare(a.created_at)),
    getById: async (id) => db.agendas.find(a => a.id === +id) ?? null,
    getSections: async (id) => db.agenda_sections.filter(s => s.agenda_id === +id).sort((a,b) => a.sort_order - b.sort_order || a.id - b.id),
    create: async ({ title }) => {
      const a = { id: nextId('agendas'), title, created_at: nowStr() };
      db.agendas.push(a); persist(db); return a;
    },
    update: async (id, { title }) => {
      const a = db.agendas.find(a => a.id === +id); if (!a) return null;
      a.title = title; persist(db); return a;
    },
    delete: async (id) => {
      db.agendas = db.agendas.filter(a => a.id !== +id);
      db.agenda_sections = db.agenda_sections.filter(s => s.agenda_id !== +id);
      persist(db);
    },
    addSection: async (agendaId, { name, duration_minutes, visible, sort_order, shows_issues, shows_todos }) => {
      const s = { id: nextId('agenda_sections'), agenda_id: +agendaId, name, duration_minutes: duration_minutes ?? 5, visible: visible !== false, sort_order: sort_order ?? 0, shows_issues: !!shows_issues, shows_todos: !!shows_todos };
      db.agenda_sections.push(s); persist(db); return s;
    },
    updateSection: async (id, fields) => {
      const s = db.agenda_sections.find(s => s.id === +id); if (!s) return null;
      ['name','duration_minutes','visible','sort_order','shows_issues','shows_todos'].forEach(k => { if (k in fields) s[k] = fields[k]; });
      persist(db); return s;
    },
    deleteSection: async (id) => { db.agenda_sections = db.agenda_sections.filter(s => s.id !== +id); persist(db); },
  };

  if (!db.meeting_attendees) { db.meeting_attendees = []; }

  function enrichMeeting(m) {
    const attendees = db.meeting_attendees
      .filter(ma => ma.meeting_id === m.id)
      .map(ma => {
        const u = db.users.find(u => u.id === ma.user_id);
        return u ? { id: u.id, name: u.name, color: u.color, picture: u.picture ?? null } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
    return { ...m, attendees };
  }

  const meetingQueries = {
    getAll: async (status) => {
      const list = status ? db.meetings.filter(m => m.status === status) : [...db.meetings];
      return list
        .sort((a,b) => (b.scheduled_at||b.created_at).localeCompare(a.scheduled_at||a.created_at))
        .map(enrichMeeting);
    },
    getById: async (id) => {
      const m = db.meetings.find(m => m.id === +id);
      return m ? enrichMeeting(m) : null;
    },
    create: async ({ agenda_id, title, scheduled_at, sections_snapshot, attendee_ids }) => {
      const m = { id: nextId('meetings'), agenda_id: agenda_id || null, title, scheduled_at: scheduled_at || null, started_at: null, ended_at: null, status: 'upcoming', sections_snapshot: sections_snapshot || null, created_at: nowStr() };
      db.meetings.push(m);
      if (Array.isArray(attendee_ids)) {
        const unique = Array.from(new Set(attendee_ids.map(Number).filter(Boolean)));
        unique.forEach(uid => db.meeting_attendees.push({ meeting_id: m.id, user_id: uid }));
      }
      persist(db);
      return enrichMeeting(m);
    },
    update: async (id, fields) => {
      const m = db.meetings.find(m => m.id === +id); if (!m) return null;
      ['title','scheduled_at','started_at','ended_at','status','sections_snapshot'].forEach(k => { if (k in fields) m[k] = fields[k]; });
      persist(db); return enrichMeeting(m);
    },
    delete: async (id) => {
      db.meetings = db.meetings.filter(m => m.id !== +id);
      db.meeting_attendees = db.meeting_attendees.filter(ma => ma.meeting_id !== +id);
      persist(db);
    },
    setAttendees: async (meetingId, userIds) => {
      const mid = +meetingId;
      db.meeting_attendees = db.meeting_attendees.filter(ma => ma.meeting_id !== mid);
      const unique = Array.from(new Set((userIds || []).map(Number).filter(Boolean)));
      unique.forEach(uid => db.meeting_attendees.push({ meeting_id: mid, user_id: uid }));
      persist(db);
      return meetingQueries.getById(mid);
    },
  };

  const teamIssueQueries = {
    getAll: async ({ horizon, status, includeArchived } = {}) => {
      let list = db.team_issues;
      if (horizon) list = list.filter(t => t.horizon === horizon);
      if (status)  list = list.filter(t => t.status === status);
      if (!includeArchived) list = list.filter(t => !t.archived);
      return list
        .map(enrichTeamIssue)
        .sort((a, b) => Number(!!a.archived) - Number(!!b.archived)
          || (a.top_rank ?? 99) - (b.top_rank ?? 99)
          || b.created_at.localeCompare(a.created_at));
    },
    getById: async (id) => {
      const t = db.team_issues.find(t => t.id === +id);
      return t ? enrichTeamIssue(t) : null;
    },
    create: async ({ title, description, owner_id, horizon }) => {
      const t = {
        id: nextId('team_issues'),
        title,
        description: description || null,
        owner_id: owner_id ? +owner_id : null,
        horizon: horizon || 'short_term',
        status: 'in_progress',
        archived: false,
        top_rank: null,
        created_at: nowStr(),
        updated_at: nowStr(),
      };
      db.team_issues.push(t); persist(db); return enrichTeamIssue(t);
    },
    update: async (id, fields) => {
      const t = db.team_issues.find(t => t.id === +id); if (!t) return null;
      ['title','description','owner_id','horizon','status','archived'].forEach(k => { if (k in fields) t[k] = fields[k]; });
      if ('owner_id' in fields && fields.owner_id) t.owner_id = +fields.owner_id;
      t.updated_at = nowStr(); persist(db); return enrichTeamIssue(t);
    },
    delete: async (id) => { db.team_issues = db.team_issues.filter(t => t.id !== +id); persist(db); },
    setRank: async (id, rank) => {
      const t = db.team_issues.find(t => t.id === +id); if (!t) return null;
      if (rank != null) {
        db.team_issues.forEach(other => {
          if (other.id !== +id && other.top_rank === rank) {
            other.top_rank = null; other.updated_at = nowStr();
          }
        });
      }
      t.top_rank = rank; t.updated_at = nowStr(); persist(db);
      return enrichTeamIssue(t);
    },
  };

  if (!db.coaching_calls)        { db.coaching_calls = []; }
  if (!db.coaching_commitments)  { db.coaching_commitments = []; }
  if (!db._seq.coaching_calls)   { db._seq.coaching_calls = 0; }
  if (!db._seq.coaching_commitments) { db._seq.coaching_commitments = 0; }
  persist(db);

  const coachingQueries = {
    createCall: async ({ user_id, summary, gratitude, transcript, commitments }) => {
      const uid = +user_id;
      const callDate = new Date().toISOString().slice(0,10);
      const call = { id: nextId('coaching_calls'), user_id: uid, call_date: callDate,
        summary: summary || null, gratitude: gratitude || null, transcript: transcript || null,
        created_at: nowStr() };
      db.coaching_calls.push(call);

      const due = new Date(); due.setDate(due.getDate() + 1);
      const dueStr = due.toISOString().slice(0, 10);
      const issueIds = [];
      for (const c of (commitments || [])) {
        const t = (c && c.title ? String(c.title).trim() : '');
        if (!t) continue;
        const issue = {
          id: nextId('issues'), title: t, description: c.description || null,
          owner_id: uid, status: 'in_progress', priority: c.priority || 'medium',
          archived: false, private: true, due_date: c.due_date || dueStr,
          source: 'coaching', created_at: nowStr(), updated_at: nowStr(),
        };
        db.issues.push(issue);
        db.coaching_commitments.push({
          id: nextId('coaching_commitments'), call_id: call.id, issue_id: issue.id,
        });
        issueIds.push(issue.id);
      }
      persist(db);
      return { call_id: call.id, issue_ids: issueIds };
    },

    getContext: async (user_id) => {
      const uid = +user_id;
      const dayMs = 24 * 60 * 60 * 1000;
      const today = new Date(); today.setHours(0,0,0,0);
      const yesterdayStr = new Date(today.getTime() - dayMs).toISOString().slice(0,10);

      const ydayCalls = db.coaching_calls.filter(c => c.user_id === uid && c.call_date === yesterdayStr);
      const ydayCallIds = new Set(ydayCalls.map(c => c.id));
      const ydayCommits = db.coaching_commitments.filter(cc => ydayCallIds.has(cc.call_id));
      const yesterday_commitments = ydayCommits.map(cc => {
        const i = db.issues.find(x => x.id === cc.issue_id);
        return i ? { id: i.id, title: i.title, completed: i.status === 'solved' } : null;
      }).filter(Boolean);

      const userCallDates = new Set(
        db.coaching_calls.filter(c => c.user_id === uid).map(c => c.call_date)
      );
      let streak = 0;
      let cursor = new Date(today);
      if (!userCallDates.has(cursor.toISOString().slice(0,10))) {
        cursor = new Date(cursor.getTime() - dayMs);
      }
      while (userCallDates.has(cursor.toISOString().slice(0,10))) {
        streak++;
        cursor = new Date(cursor.getTime() - dayMs);
      }

      const active_rocks = db.rocks
        .filter(r => r.owner_id === uid && r.status !== 'complete')
        .map(r => ({ id: r.id, title: r.title, status: r.status, progress: r.progress }));

      return { yesterday_commitments, streak_days: streak, active_rocks };
    },

    listCalls: async (user_id, limit, offset) => {
      const uid = +user_id;
      const lim = Math.min(Math.max(+limit || 20, 1), 100);
      const off = Math.max(+offset || 0, 0);
      const all = db.coaching_calls
        .filter(c => c.user_id === uid)
        .filter(c => c.summary || c.transcript || db.coaching_commitments.some(cc => cc.call_id === c.id))
        .sort((a, b) => (b.call_date + 'Z' + b.created_at).localeCompare(a.call_date + 'Z' + a.created_at));
      const page = all.slice(off, off + lim).map(c => {
        const commits = db.coaching_commitments
          .filter(cc => cc.call_id === c.id)
          .map(cc => {
            const i = db.issues.find(x => x.id === cc.issue_id);
            return i ? { id: i.id, title: i.title, priority: i.priority, due_date: i.due_date,
              completed: i.status === 'solved', status: i.status } : null;
          }).filter(Boolean);
        return { id: c.id, call_date: c.call_date, summary: c.summary,
          gratitude: c.gratitude, created_at: c.created_at, commitments: commits };
      });
      return { calls: page, has_more: all.length > off + lim };
    },

    getCallById: async (call_id, user_id) => {
      const uid = +user_id;
      const c = db.coaching_calls.find(x => x.id === +call_id && x.user_id === uid);
      if (!c) return null;
      const commits = db.coaching_commitments
        .filter(cc => cc.call_id === c.id)
        .map(cc => {
          const i = db.issues.find(x => x.id === cc.issue_id);
          return i ? { id: i.id, title: i.title, priority: i.priority, due_date: i.due_date,
            description: i.description, completed: i.status === 'solved', status: i.status } : null;
        }).filter(Boolean);
      return { ...c, commitments: commits };
    },

    getStats: async (user_id) => {
      const uid = +user_id;
      const dayMs = 24 * 60 * 60 * 1000;
      const today = new Date(); today.setHours(0,0,0,0);
      const cutoff = (days) => new Date(today.getTime() - (days - 1) * dayMs).toISOString().slice(0,10);

      const userCalls = db.coaching_calls.filter(c => c.user_id === uid);
      const allCount = userCalls.length;
      const countFrom = (d) => userCalls.filter(c => c.call_date >= d).length;

      const allCommits = db.coaching_commitments.map(cc => {
        const call = db.coaching_calls.find(c => c.id === cc.call_id);
        const issue = db.issues.find(i => i.id === cc.issue_id);
        return call && issue && call.user_id === uid ? { call_date: call.call_date, completed: issue.status === 'solved' } : null;
      }).filter(Boolean);
      const windowStats = (days) => {
        const from = cutoff(days);
        const w = allCommits.filter(c => c.call_date >= from);
        const done = w.filter(c => c.completed).length;
        return { total: w.length, done, pct: w.length ? Math.round(done / w.length * 100) : null };
      };

      const userCallDates = new Set(userCalls.map(c => c.call_date));
      let streak = 0;
      let cursor = new Date(today);
      if (!userCallDates.has(cursor.toISOString().slice(0,10))) cursor = new Date(cursor.getTime() - dayMs);
      while (userCallDates.has(cursor.toISOString().slice(0,10))) {
        streak++;
        cursor = new Date(cursor.getTime() - dayMs);
      }

      return {
        calls: { all_calls: allCount, calls_7d: countFrom(cutoff(7)), calls_30d: countFrom(cutoff(30)), calls_90d: countFrom(cutoff(90)) },
        streak_days: streak,
        completion: { last_7d: windowStats(7), last_30d: windowStats(30), last_90d: windowStats(90) },
      };
    },
  };

  function syncRockProgressFromMilestones(rockId) {
    const list = db.rock_milestones.filter(m => m.rock_id === +rockId);
    if (list.length === 0) return;
    const done = list.filter(m => m.done).length;
    const pct = Math.round((done / list.length) * 100);
    const rock = db.rocks.find(r => r.id === +rockId);
    if (rock) { rock.progress = pct; rock.updated_at = nowStr(); }
  }

  const milestoneQueries = {
    getByRock: async (rockId) => db.rock_milestones
      .filter(m => m.rock_id === +rockId)
      .sort((a,b) => a.sort_order - b.sort_order || a.id - b.id)
      .map(enrichMilestone),
    getById: async (id) => {
      const m = db.rock_milestones.find(m => m.id === +id);
      return m ? enrichMilestone(m) : null;
    },
    create: async (rockId, { title, due_date, owner_id, sort_order }) => {
      const m = {
        id: nextId('rock_milestones'),
        rock_id: +rockId,
        title,
        due_date: due_date || null,
        owner_id: owner_id ? +owner_id : null,
        done: false,
        sort_order: sort_order ?? 0,
        created_at: nowStr(),
        updated_at: nowStr(),
      };
      db.rock_milestones.push(m);
      syncRockProgressFromMilestones(+rockId);
      persist(db);
      return enrichMilestone(m);
    },
    update: async (id, fields) => {
      const m = db.rock_milestones.find(m => m.id === +id); if (!m) return null;
      ['title','due_date','owner_id','done','sort_order'].forEach(k => { if (k in fields) m[k] = fields[k]; });
      if ('owner_id' in fields && fields.owner_id) m.owner_id = +fields.owner_id;
      m.updated_at = nowStr();
      syncRockProgressFromMilestones(m.rock_id);
      persist(db);
      return enrichMilestone(m);
    },
    delete: async (id) => {
      const m = db.rock_milestones.find(m => m.id === +id);
      db.rock_milestones = db.rock_milestones.filter(m => m.id !== +id);
      if (m) syncRockProgressFromMilestones(m.rock_id);
      persist(db);
    },
    // Promote each milestone due within 7 days to a to-do, exactly once.
    promoteDue: async () => {
      const today = new Date(); today.setHours(0,0,0,0);
      const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() + 7);
      const cutoffStr = cutoff.toISOString().slice(0,10);
      const due = db.rock_milestones.filter(m =>
        !m.done && !m.promoted_to_todo_at && m.due_date && m.due_date.slice(0,10) <= cutoffStr
      );
      let promoted = 0;
      for (const m of due) {
        const rock = db.rocks.find(r => r.id === m.rock_id);
        const ownerId = m.owner_id ?? rock?.owner_id ?? null;
        const issue = {
          id: nextId('issues'),
          title: m.title,
          description: `Milestone for rock: ${rock ? rock.title : ''}`,
          owner_id: ownerId,
          status: 'in_progress',
          priority: 'medium',
          archived: false,
          private: false,
          due_date: m.due_date,
          source: 'manual',
          source_milestone_id: m.id,
          created_at: nowStr(),
          updated_at: nowStr(),
        };
        db.issues.push(issue);
        m.promoted_to_todo_at = nowStr();
        m.updated_at = nowStr();
        promoted++;
      }
      persist(db);
      return { promoted, checked: due.length };
    },
  };

  module.exports = { initDb, userQueries, rockQueries, issueQueries, agendaQueries, meetingQueries, teamIssueQueries, milestoneQueries, coachingQueries };
}
