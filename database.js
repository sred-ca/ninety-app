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
        role       TEXT NOT NULL DEFAULT 'member',
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

      CREATE TABLE IF NOT EXISTS coaching_assistant_prompts (
        user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        system_prompt TEXT NOT NULL,
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS qb_connections (
        id                       SERIAL PRIMARY KEY,
        realm_id                 TEXT        NOT NULL UNIQUE,
        access_token             TEXT        NOT NULL,
        refresh_token            TEXT        NOT NULL,
        access_token_expires_at  TIMESTAMPTZ NOT NULL,
        refresh_token_expires_at TIMESTAMPTZ,
        connected_by_user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        last_synced_at           TIMESTAMPTZ,
        created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS budget_lines (
        id            SERIAL PRIMARY KEY,
        fiscal_year   TEXT        NOT NULL,
        section       TEXT        NOT NULL DEFAULT 'opex',
        category      TEXT        NOT NULL,
        sort_order    INTEGER     NOT NULL DEFAULT 0,
        qb_account_id TEXT,
        notes         TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS budget_cells (
        id               SERIAL PRIMARY KEY,
        line_id          INTEGER NOT NULL REFERENCES budget_lines(id) ON DELETE CASCADE,
        period_date      DATE    NOT NULL,
        budget_amount    NUMERIC(14, 2) NOT NULL DEFAULT 0,
        actual_amount    NUMERIC(14, 2),
        actual_source    TEXT,
        actual_synced_at TIMESTAMPTZ,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (line_id, period_date)
      );

      CREATE INDEX IF NOT EXISTS idx_budget_cells_line ON budget_cells(line_id);
      CREATE INDEX IF NOT EXISTS idx_budget_cells_period ON budget_cells(period_date);

      CREATE TABLE IF NOT EXISTS vto (
        id                     SERIAL PRIMARY KEY,
        core_values            JSONB       NOT NULL DEFAULT '[]'::jsonb,
        core_focus_purpose     TEXT        NOT NULL DEFAULT '',
        core_focus_niche       TEXT        NOT NULL DEFAULT '',
        ten_year_target        TEXT        NOT NULL DEFAULT '',
        ten_year_measurables   JSONB       NOT NULL DEFAULT '[]'::jsonb,
        target_market          TEXT        NOT NULL DEFAULT '',
        three_uniques          JSONB       NOT NULL DEFAULT '[]'::jsonb,
        proven_process         TEXT        NOT NULL DEFAULT '',
        guarantee              TEXT        NOT NULL DEFAULT '',
        three_year_future_date DATE,
        three_year_revenue     TEXT        NOT NULL DEFAULT '',
        three_year_profit      TEXT        NOT NULL DEFAULT '',
        three_year_measurables JSONB       NOT NULL DEFAULT '[]'::jsonb,
        three_year_looks_like  JSONB       NOT NULL DEFAULT '[]'::jsonb,
        one_year_future_date   DATE,
        one_year_revenue       TEXT        NOT NULL DEFAULT '',
        one_year_profit        TEXT        NOT NULL DEFAULT '',
        one_year_measurables   JSONB       NOT NULL DEFAULT '[]'::jsonb,
        one_year_goals         JSONB       NOT NULL DEFAULT '[]'::jsonb,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_coaching_calls_user ON coaching_calls(user_id, call_date DESC);
      CREATE INDEX IF NOT EXISTS idx_coaching_commitments_call ON coaching_commitments(call_id);

      -- Per-user visibility of sidebar tabs that aren't member defaults.
      -- Row presence = granted. Owners bypass this table entirely.
      CREATE TABLE IF NOT EXISTS user_tab_access (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tab     TEXT    NOT NULL,
        PRIMARY KEY (user_id, tab)
      );
    `);
    // Migrate existing tables that may lack newer columns
    await pool.query(`
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS due_date DATE;
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS private  BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS source   TEXT NOT NULL DEFAULT 'manual';
      ALTER TABLE users  ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
      ALTER TABLE users  ADD COLUMN IF NOT EXISTS picture TEXT;
      ALTER TABLE users  ADD COLUMN IF NOT EXISTS coaching_enabled BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE users  ADD COLUMN IF NOT EXISTS coaching_phone   TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_coaching_phone ON users(coaching_phone) WHERE coaching_phone IS NOT NULL;
      ALTER TABLE agenda_sections ADD COLUMN IF NOT EXISTS shows_issues BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE agenda_sections ADD COLUMN IF NOT EXISTS shows_todos  BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE rock_milestones ADD COLUMN IF NOT EXISTS promoted_to_todo_at TIMESTAMPTZ;
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS source_milestone_id INTEGER REFERENCES rock_milestones(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_issues_source_milestone ON issues(source_milestone_id);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member';
    `);
    // Owner seat assignment. Jude + Logan are the 50/50 owners; the budget and
    // any other owner-only views are gated by this flag. Emails are the stable
    // identity (Google OAuth). Logan seeded without email predates Google login
    // and is matched by exact name; when he signs in, findOrCreateByEmail
    // preserves the existing row by name match and his role stays 'owner'.
    await pool.query(`
      UPDATE users SET role='owner'
       WHERE email IN ('jude@sred.ca','logan@sred.ca') OR name='Logan';
    `);
    // Rename legacy statuses to new names and fix column default
    await pool.query(`
      UPDATE issues SET status='in_progress' WHERE status='identified';
      UPDATE issues SET status='blocker'     WHERE status='discussing';
      ALTER TABLE issues ALTER COLUMN status SET DEFAULT 'in_progress';
    `);

    // No seed users — accounts are created via Google OAuth on first login.

    // First-run seed for V/TO + FY27 budget skeleton. Only populates if the
    // table is empty (COUNT = 0), so re-runs of initDb are no-ops after the
    // first deploy. Keep this in lockstep with the local data.json seed so
    // both environments start from the same content.
    await seedVtoAndBudgetIfEmpty();
  }

  async function seedVtoAndBudgetIfEmpty() {
    // V/TO seed content — lifted from SRED.ca's Ninety.io V/TO export
    // (Leadership Team, Apr 23 2026) with FY27-specific financials carried
    // forward from the strategic plan. Kept as constants so the first-run
    // INSERT and the fill-empty UPDATE below share the same values.
    const CORE_VALUES = [
      { label: 'Do the Right Thing', description: 'For our team, our partners, and ourselves — no exceptions.' },
      { label: 'Stay Curious',       description: 'We work with innovators. We have to be one.' },
    ];
    const CORE_FOCUS_PURPOSE = "Canada's future depends on its builders. We're in their corner.";
    const CORE_FOCUS_NICHE   = 'High-technical-footprint CCPCs actively building new products — served through a flat-fee, year-round model that no one else in the industry offers.';
    const TEN_YEAR_TARGET = [
      "Position: Canada's most trusted and visible SR&ED brand. Recognized not just for quality, but also for category leadership.",
      '',
      'Growth Channels:',
      '• Acquisitions of smaller SR&ED providers (1–2 per 3 years).',
      '• Expansion into Eastern Canada and select U.S. markets via partnerships.',
      '• Internal sales engine driving ~$500K–$1M in new ARR per year.',
      '',
      'Client Breakdown:',
      '• ~75% full-service SR&ED',
      '• ~25% lite prep or partnership revenue (e.g., white label, accounting firm collabs)',
      '',
      'Team Composition:',
      '• 8 PMs, 5 Sales, CTO, COO, CMO, fractional CFO',
      '• Senior Ops team running day-to-day',
      '',
      'Referral Engine: 50% of new business inbound via partner or client referrals.',
    ].join('\n');
    const TEN_YEAR_MEASURABLES = [
      { label: 'Revenue', value: '$10M' },
      { label: 'Clients', value: '400' },
      { label: 'Staff',   value: '40' },
      { label: 'Profit',  value: '$4.5M' },
    ];
    const TARGET_MARKET = [
      'A) Technology companies with claims between $250K and $2M',
      '5–50 employees (3–10 SR&ED producers), less than 5 years in business. Buyers: CEOs, CTOs, CFOs, Founders.',
      '',
      'B) Technology companies looking for a different provider',
      '4–200 employees (3–20 SR&ED producers), 3+ years in business. Buyers: CEOs, CTOs, CFOs, Founders.',
    ].join('\n');
    const THREE_UNIQUES = [
      'Guarantee: No SR&ED, No Pay.',
      'Flat Fee Pricing: Transparent flat-fee pricing at rates below market, with no hidden caps or surprises.',
      'Year Round Service: Year-round support with quarterly interviews, proactive documentation, and portal access — keeping you always audit-ready.',
    ];
    const PROVEN_PROCESS = [
      '1. Opportunities and SR&ED Assessment — A no-obligation SR&ED Assessment meeting to assess fit, educate prospects, and outline their potential claim opportunity.',
      '2. Onboarding & Planning — Guided onboarding; align on project scope, set expectations, schedule technical discovery and quarterly interview cadences.',
      '3. Quarterly SR&ED Tracking — Scheduled interviews and ongoing support document eligible activities and costs in real time. Each quarter, a client-friendly traffic-light report evaluates claim strength, identifies team leads, and estimates accrued SR&ED.',
      '4. Claim Assembly & Year-End Reporting — At fiscal year-end, consolidate technical narratives and financial summaries, ensuring every eligible dollar is claimed. We manage all timelines, review sessions, and accountant hand-offs.',
      '5. Audit Readiness & Defense — Meticulous documentation keeps clients audit-ready year-round. If an audit occurs, we handle everything at no extra cost.',
      '6. Client Feedback & Continuous Improvement — Close the loop with client feedback and post-claim reviews to refine our service. Insights drive product innovation and ensure every client experience gets better over time.',
    ].join('\n');
    const GUARANTEE = 'We guarantee that any SR&ED claim we prepare from start to finish will be approved for at least 75% of its filed value. If not, we waive our fee — no questions asked.';
    const THREE_YEAR_MEASURABLES = [
      { label: 'Gross Margin', value: '50%' },
      { label: 'Churn',        value: '≤8%' },
      { label: 'Clients',      value: '~120' },
    ];
    const THREE_YEAR_LOOKS_LIKE = [
      'Team of 7: Jude (CEO), Logan (CTO/Platform), Evan (Head of Sales), James (PM), Mike (PM/Platform, full-time since late 2026), Toronto-based senior BD/partnerships, Montreal-based bilingual technical writer/analyst.',
      'Remote-first with Victoria anchor. Toronto coworking presence running Ontario events and CPA/accelerator partnerships. Montreal coworking presence unlocking Quebec credibility and stacking RS&DE + SR&ED claims.',
      'Product mix: ~90% full-service SR&ED subscription, ~10% SRED.ca Platform as a product line.',
      'Sales engine: ~50% referrals/partnerships, ~25% AI search/organic content, ~15% events, ~10% paid. Cold email as signal-triggered precision only.',
      "Brand position: SRED.ca is the default name when someone asks a search engine or LLM 'who should I use for SR&ED in Canada?'",
    ];
    const ONE_YEAR_MEASURABLES = [
      { label: 'Gross Margin',    value: '55%' },
      { label: 'Churn',           value: '≤8%' },
      { label: 'MRR by year-end', value: '$40K' },
      { label: 'New clients',     value: '15–18' },
    ];
    const ONE_YEAR_GOALS = [
      { text: 'Hit $1.5M revenue at $300K operating profit, 55% gross margin, ≤8% churn.', owner_id: null },
      { text: 'Grow MRR from $20K to $40K, triggering second PM hire. (Evan + Logan)',     owner_id: null },
      { text: 'Launch SRED.ca Platform to all clients and define FY28 revenue model. (Logan + Mike)', owner_id: null },
      { text: "Instrument the demand funnel: 'How did you hear about us?' field + HubSpot source taxonomy + Google Ads Enhanced Conversions on Closed-Won.", owner_id: null },
      { text: 'Build partnership/referral engine to 25% of new business: 5 signed CPA partnerships, 2 signed accelerator/VC partnerships, formalize Easly.', owner_id: null },
      { text: 'Mike full-time by end of calendar 2026.', owner_id: null },
    ];

    // Fresh-deploy path: no vto row yet → insert the full doc.
    const vtoCount = (await pool.query('SELECT COUNT(*)::int AS c FROM vto')).rows[0].c;
    if (vtoCount === 0) {
      await pool.query(
        `INSERT INTO vto (
           core_values, core_focus_purpose, core_focus_niche,
           ten_year_target, ten_year_measurables,
           target_market, three_uniques, proven_process, guarantee,
           three_year_future_date, three_year_revenue, three_year_profit,
           three_year_measurables, three_year_looks_like,
           one_year_future_date, one_year_revenue, one_year_profit,
           one_year_measurables, one_year_goals
         ) VALUES (
           $1::jsonb, $2, $3,
           $4, $5::jsonb,
           $6, $7::jsonb, $8, $9,
           $10, $11, $12,
           $13::jsonb, $14::jsonb,
           $15, $16, $17,
           $18::jsonb, $19::jsonb
         )`,
        [
          JSON.stringify(CORE_VALUES),
          CORE_FOCUS_PURPOSE, CORE_FOCUS_NICHE,
          TEN_YEAR_TARGET, JSON.stringify(TEN_YEAR_MEASURABLES),
          TARGET_MARKET, JSON.stringify(THREE_UNIQUES), PROVEN_PROCESS, GUARANTEE,
          '2028-04-30', '$2.4M', '$600K',
          JSON.stringify(THREE_YEAR_MEASURABLES), JSON.stringify(THREE_YEAR_LOOKS_LIKE),
          '2027-04-30', '$1.5M', '$300K operating',
          JSON.stringify(ONE_YEAR_MEASURABLES), JSON.stringify(ONE_YEAR_GOALS),
        ]
      );
    } else {
      // Existing-row path (production): the first-run seed already ran when
      // the user opened the V/TO tab, before we had the Ninety.io export.
      // Fill ONLY the fields that are still empty — never clobber fields
      // the user may have edited in the app. All conditions are defensive
      // (checks both default value and length so 'already edited' content
      // stays put).
      await pool.query(
        `UPDATE vto SET core_values = $1::jsonb
          WHERE jsonb_array_length(core_values) = 0`,
        [JSON.stringify(CORE_VALUES)]
      );
      await pool.query(
        `UPDATE vto SET core_focus_purpose = $1 WHERE core_focus_purpose = ''`,
        [CORE_FOCUS_PURPOSE]
      );
      await pool.query(
        `UPDATE vto SET core_focus_niche = $1 WHERE core_focus_niche = ''`,
        [CORE_FOCUS_NICHE]
      );
      await pool.query(
        `UPDATE vto SET ten_year_target = $1 WHERE ten_year_target = ''`,
        [TEN_YEAR_TARGET]
      );
      await pool.query(
        `UPDATE vto SET target_market = $1 WHERE target_market = ''`,
        [TARGET_MARKET]
      );
      await pool.query(
        `UPDATE vto SET three_uniques = $1::jsonb
          WHERE jsonb_array_length(three_uniques) = 0`,
        [JSON.stringify(THREE_UNIQUES)]
      );
      await pool.query(
        `UPDATE vto SET proven_process = $1 WHERE proven_process = ''`,
        [PROVEN_PROCESS]
      );
      await pool.query(
        `UPDATE vto SET guarantee = $1 WHERE guarantee = ''`,
        [GUARANTEE]
      );
    }

    // Budget — 26-line FY27 skeleton. Owner edits values in the grid; lines
    // come pre-sectioned matching the accounting-policy doc.
    const budgetCount = (await pool.query('SELECT COUNT(*)::int AS c FROM budget_lines')).rows[0].c;
    if (budgetCount === 0) {
      const seed = [
        ['FY27', 'income', 'Full-service new (claim fees)',       0, null],
        ['FY27', 'income', 'Full-service renewals',               1, null],
        ['FY27', 'income', 'MRR subscription',                    2, null],
        ['FY27', 'income', 'Other income',                        3, null],
        ['FY27', 'cogs',   'Consulting expense',                  0, null],
        ['FY27', 'cogs',   'PM payroll (production-related)',     1, null],
        ['FY27', 'cogs',   'Software service costs (35%)',        2, null],
        ['FY27', 'opex',   'Owner market salary (Jude + Logan)',  0, '$150K each per accounting policy'],
        ['FY27', 'opex',   'Staff — Sales (Evan)',                1, null],
        ['FY27', 'opex',   'Staff — PM (James, non-production)',  2, null],
        ['FY27', 'opex',   'Staff — Platform (Mike, non-prod)',   3, null],
        ['FY27', 'opex',   'Marketing — Google Ads',              4, null],
        ['FY27', 'opex',   'Marketing — Partnerships',            5, null],
        ['FY27', 'opex',   'Marketing — Content / AI search',     6, null],
        ['FY27', 'opex',   'Marketing — Events',                  7, null],
        ['FY27', 'opex',   'Software — SaaS tools',               8, null],
        ['FY27', 'opex',   'Software — Infrastructure / hosting', 9, null],
        ['FY27', 'opex',   'Professional fees — Legal',           10, null],
        ['FY27', 'opex',   'Professional fees — Accounting',      11, null],
        ['FY27', 'opex',   'Insurance',                           12, null],
        ['FY27', 'opex',   'Travel',                              13, null],
        ['FY27', 'opex',   'Office & admin',                      14, null],
        ['FY27', 'opex',   'Bank fees & interest',                15, null],
        ['FY27', 'opex',   'Rent',                                 16, 'Victoria anchor — ~$5K/month FY26 actual'],
        ['FY27', 'other',  'Owner dividend (above-market draw)',  0, '$60K each above $150K market'],
        ['FY27', 'other',  'BDC line of credit interest',         1, null],
        ['FY27', 'other',  'Bad debt expense',                    2, null],
      ];
      for (const [fy, section, category, sort, notes] of seed) {
        await pool.query(
          'INSERT INTO budget_lines (fiscal_year, section, category, sort_order, notes) VALUES ($1,$2,$3,$4,$5)',
          [fy, section, category, sort, notes]
        );
      }
    } else {
      // Existing-deploy path: ensure the Rent line exists even if the
      // initial 26-line seed already ran before Rent was added.
      const hasRent = (await pool.query(
        "SELECT 1 FROM budget_lines WHERE fiscal_year='FY27' AND category='Rent' LIMIT 1"
      )).rows[0];
      if (!hasRent) {
        await pool.query(
          `INSERT INTO budget_lines (fiscal_year, section, category, sort_order, notes)
           VALUES ('FY27', 'opex', 'Rent', 16, 'Victoria anchor — ~$5K/month FY26 actual')`
        );
      }
    }

    // FY27 budget values — monthly distribution derived from FY26 actuals
    // (seasonality for full-service revenue), a back-loaded linear ramp for
    // MRR, and flat /12 for the rest. Idempotent: skips any line that
    // already has a non-zero budget cell so owner edits are preserved.
    await seedBudgetValuesIfEmpty();
  }

  async function seedBudgetValuesIfEmpty() {
    // FY27 months: May 2026 → April 2027.
    const MONTHS = [
      '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01',
      '2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01',
      '2027-01-01', '2027-02-01', '2027-03-01', '2027-04-01',
    ];
    // FY26 revenue seasonality (from the May 2025–Apr 2026 P&L).
    // Applied to the seasonal revenue lines; sums to 1.0.
    const SEASONAL = [
      0.0636, 0.1078, 0.1224, 0.0069, 0.1862, 0.1419,
      0.0401, 0.0376, 0.0368, 0.0710, 0.1117, 0.0740,
    ];
    // MRR back-loaded ramp ($20K May → $40K Apr). Hand-curated so the
    // curve reflects slow early ramp + steeper growth as platform matures.
    const MRR_RAMP = [
      20000, 20000, 21000, 22000, 23000, 24000,
      26000, 28000, 31000, 33000, 36000, 40000,
    ];
    // Category → { annual, shape }
    // - 'seasonal' uses SEASONAL weights
    // - 'mrr'      uses MRR_RAMP verbatim
    // - 'flat'     distributes evenly /12
    // - 'skip'     no cells written (line stays $0)
    const PLAN = {
      // Income (annual $1.5M)
      'Full-service new (claim fees)':        { annual: 900000, shape: 'seasonal' },
      'Full-service renewals':                { annual: 230000, shape: 'flat' },
      'MRR subscription':                     { annual: 320000, shape: 'mrr' },
      'Other income':                         { annual: 50000,  shape: 'flat' },
      // COGS (annual $675K → 55% GM)
      'Consulting expense':                   { annual: 15000,  shape: 'flat' },
      'PM payroll (production-related)':      { annual: 620000, shape: 'flat' },
      'Software service costs (35%)':         { annual: 40000,  shape: 'flat' },
      // OpEx — James + Mike fully in COGS so OpEx lines stay $0
      'Owner market salary (Jude + Logan)':   { annual: 300000, shape: 'flat' },
      'Staff — Sales (Evan)':                 { annual: 100000, shape: 'flat' },
      'Staff — PM (James, non-production)':   { annual: 0,      shape: 'skip' },
      'Staff — Platform (Mike, non-prod)':    { annual: 0,      shape: 'skip' },
      'Marketing — Google Ads':               { annual: 50000,  shape: 'flat' },
      'Marketing — Partnerships':             { annual: 10000,  shape: 'flat' },
      'Marketing — Content / AI search':      { annual: 15000,  shape: 'flat' },
      'Marketing — Events':                   { annual: 15000,  shape: 'flat' },
      'Software — SaaS tools':                { annual: 40000,  shape: 'flat' },
      'Software — Infrastructure / hosting':  { annual: 20000,  shape: 'flat' },
      'Professional fees — Legal':            { annual: 15000,  shape: 'flat' },
      'Professional fees — Accounting':       { annual: 20000,  shape: 'flat' },
      'Insurance':                            { annual: 4000,   shape: 'flat' },
      'Travel':                               { annual: 15000,  shape: 'flat' },
      'Office & admin':                       { annual: 15000,  shape: 'flat' },
      'Bank fees & interest':                 { annual: 5000,   shape: 'flat' },
      'Rent':                                 { annual: 60000,  shape: 'flat' },
      // Other
      'Owner dividend (above-market draw)':   { annual: 120000, shape: 'flat' },
      'BDC line of credit interest':          { annual: 5000,   shape: 'flat' },
      'Bad debt expense':                     { annual: 5000,   shape: 'flat' },
    };

    function distribute(annual, shape) {
      if (shape === 'skip') return null;
      if (shape === 'mrr')  return MRR_RAMP.slice();
      if (shape === 'seasonal') return SEASONAL.map(w => Math.round(annual * w));
      // flat: round to nearest dollar, absorb rounding drift into last month
      const monthly = Math.round(annual / 12);
      const arr = MONTHS.map(() => monthly);
      arr[arr.length - 1] = annual - monthly * (MONTHS.length - 1);
      return arr;
    }

    const lines = (await pool.query(
      "SELECT id, category FROM budget_lines WHERE fiscal_year='FY27'"
    )).rows;
    for (const line of lines) {
      const plan = PLAN[line.category];
      if (!plan) continue;
      const amounts = distribute(plan.annual, plan.shape);
      if (!amounts) continue;

      // Idempotency: skip lines that already have any non-zero budget cell.
      // This keeps the draft from clobbering owner edits.
      const hasBudget = (await pool.query(
        'SELECT 1 FROM budget_cells WHERE line_id=$1 AND budget_amount > 0 LIMIT 1',
        [line.id]
      )).rows[0];
      if (hasBudget) continue;

      for (let i = 0; i < MONTHS.length; i++) {
        if (!amounts[i]) continue;
        await pool.query(
          `INSERT INTO budget_cells (line_id, period_date, budget_amount)
           VALUES ($1, $2, $3)
           ON CONFLICT (line_id, period_date)
           DO UPDATE SET budget_amount = EXCLUDED.budget_amount, updated_at = NOW()`,
          [line.id, MONTHS[i], amounts[i]]
        );
      }
    }
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
    getByCoachingPhone: async (phone) => (await pool.query('SELECT * FROM users WHERE coaching_phone=$1', [phone])).rows[0] ?? null,
    updateCoachingSettings: async (id, { coaching_enabled, coaching_phone }) => {
      const { rows } = await pool.query(
        'UPDATE users SET coaching_enabled=$1, coaching_phone=$2 WHERE id=$3 RETURNING *',
        [!!coaching_enabled, coaching_phone || null, id]
      );
      return rows[0] ?? null;
    },
    create: async (name, color) => (await pool.query(
      'INSERT INTO users (name,color) VALUES ($1,$2) RETURNING *', [name, color || '#6366f1']
    )).rows[0],
    update: async (id, name, color) => (await pool.query(
      'UPDATE users SET name=$1,color=$2 WHERE id=$3 RETURNING *', [name, color, id]
    )).rows[0] ?? null,
    setRole: async (id, role) => (await pool.query(
      'UPDATE users SET role=$1 WHERE id=$2 RETURNING *', [role, id]
    )).rows[0] ?? null,
    countOwners: async () => (await pool.query(
      `SELECT COUNT(*)::int AS c FROM users WHERE role='owner'`
    )).rows[0].c,
    delete: async (id) => pool.query('DELETE FROM users WHERE id=$1', [id]),
    findOrCreateByEmail: async (email, name, picture) => {
      const colors = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ef4444'];
      const role = (email === 'jude@sred.ca' || email === 'logan@sred.ca') ? 'owner' : 'member';
      const existing = (await pool.query('SELECT * FROM users WHERE email=$1', [email])).rows[0];
      if (existing) {
        // Keep name and picture in sync with Google profile. Preserve an
        // already-assigned 'owner' role; upgrade 'member' to 'owner' for
        // seat holders on subsequent logins.
        return (await pool.query(
          `UPDATE users SET name=$1, picture=$2,
             role = CASE WHEN role='owner' THEN 'owner' ELSE $4 END
           WHERE id=$3 RETURNING *`,
          [name, picture || null, existing.id, role]
        )).rows[0];
      }
      const count = (await pool.query('SELECT COUNT(*)::int AS c FROM users')).rows[0].c;
      const color = colors[count % colors.length];
      return (await pool.query(
        'INSERT INTO users (name,email,color,picture,role) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [name, email, color, picture || null, role]
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
         WHERE owner_id=$1 AND status <> 'done'
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

    // Stella's VAPI prompt storage. LifeCoach's pre-call builder renders each
    // enabled user's full system prompt once per day and pushes it here via
    // setAssistantPrompt. At call time, Ninety looks it up by user id and
    // returns it to VAPI as an assistant override.
    setAssistantPrompt: async (user_id, system_prompt) => {
      await pool.query(
        `INSERT INTO coaching_assistant_prompts (user_id, system_prompt, updated_at)
         VALUES ($1,$2,NOW())
         ON CONFLICT (user_id) DO UPDATE SET system_prompt=EXCLUDED.system_prompt, updated_at=NOW()`,
        [user_id, system_prompt]
      );
    },
    getAssistantPrompt: async (user_id) => {
      const { rows } = await pool.query(
        'SELECT system_prompt, updated_at FROM coaching_assistant_prompts WHERE user_id=$1',
        [user_id]
      );
      return rows[0] ?? null;
    },

    // All users currently opted in. Used by the pre-call cron to iterate and
    // build per-user prompts.
    listEnabledUsers: async () => {
      const { rows } = await pool.query(
        `SELECT id, name, email, coaching_phone
         FROM users WHERE coaching_enabled = TRUE
         ORDER BY id`
      );
      return rows;
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

  // Single-row V/TO for the whole org. getOrCreate guarantees a row exists so
  // the frontend never has to handle "not created yet" state — it gets back
  // empty strings / empty arrays on first call.
  const VTO_FIELDS = [
    'core_values', 'core_focus_purpose', 'core_focus_niche',
    'ten_year_target', 'ten_year_measurables',
    'target_market', 'three_uniques', 'proven_process', 'guarantee',
    'three_year_future_date', 'three_year_revenue', 'three_year_profit',
    'three_year_measurables', 'three_year_looks_like',
    'one_year_future_date', 'one_year_revenue', 'one_year_profit',
    'one_year_measurables', 'one_year_goals',
  ];
  const VTO_JSON_FIELDS = new Set([
    'core_values', 'ten_year_measurables', 'three_uniques',
    'three_year_measurables', 'three_year_looks_like',
    'one_year_measurables', 'one_year_goals',
  ]);
  const VTO_DATE_FIELDS = new Set(['three_year_future_date', 'one_year_future_date']);
  const vtoQueries = {
    getOrCreate: async () => {
      const existing = await pool.query('SELECT * FROM vto ORDER BY id ASC LIMIT 1');
      if (existing.rows[0]) return existing.rows[0];
      const inserted = await pool.query('INSERT INTO vto DEFAULT VALUES RETURNING *');
      return inserted.rows[0];
    },
    update: async (fields) => {
      const row = await vtoQueries.getOrCreate();
      const keys = VTO_FIELDS.filter(k => k in fields);
      if (!keys.length) return row;
      const values = keys.map(k => {
        const v = fields[k];
        if (VTO_JSON_FIELDS.has(k)) return JSON.stringify(Array.isArray(v) ? v : []);
        if (VTO_DATE_FIELDS.has(k)) return (v === '' || v == null) ? null : v;
        // Text columns are NOT NULL DEFAULT ''
        return v == null ? '' : String(v);
      });
      const sets = keys.map((k, i) => (
        VTO_JSON_FIELDS.has(k) ? `${k}=$${i + 1}::jsonb` : `${k}=$${i + 1}`
      )).join(', ');
      const { rows } = await pool.query(
        `UPDATE vto SET ${sets}, updated_at=NOW() WHERE id=$${keys.length + 1} RETURNING *`,
        [...values, row.id]
      );
      return rows[0];
    },
  };

  // Budget — two tables: budget_lines (row definitions) and budget_cells
  // (per-month values with budget + actual). getAll returns both flat arrays
  // so the frontend can build its own grid. Actual amounts are written by the
  // QB sync job (setActual), not by the user-facing upsertCell which only
  // touches budget_amount.
  const BUDGET_LINE_FIELDS = ['fiscal_year', 'section', 'category', 'sort_order', 'qb_account_id', 'notes'];
  const budgetQueries = {
    getAll: async (fiscalYear) => {
      const lines = fiscalYear
        ? (await pool.query('SELECT * FROM budget_lines WHERE fiscal_year=$1 ORDER BY sort_order ASC, id ASC', [fiscalYear])).rows
        : (await pool.query('SELECT * FROM budget_lines ORDER BY fiscal_year DESC, sort_order ASC, id ASC')).rows;
      if (!lines.length) return { lines: [], cells: [] };
      const ids = lines.map(l => l.id);
      const cells = (await pool.query(
        `SELECT id, line_id, period_date, budget_amount, actual_amount, actual_source, actual_synced_at
           FROM budget_cells WHERE line_id = ANY($1::int[])
           ORDER BY line_id, period_date`,
        [ids]
      )).rows;
      return { lines, cells };
    },
    createLine: async (fields) => {
      const keys = BUDGET_LINE_FIELDS.filter(k => k in fields);
      if (!fields.fiscal_year || !fields.category) throw new Error('fiscal_year and category are required');
      const cols = keys.join(', ');
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
      const { rows } = await pool.query(
        `INSERT INTO budget_lines (${cols}) VALUES (${placeholders}) RETURNING *`,
        keys.map(k => fields[k])
      );
      return rows[0];
    },
    updateLine: async (id, fields) => {
      const keys = BUDGET_LINE_FIELDS.filter(k => k in fields);
      if (!keys.length) {
        return (await pool.query('SELECT * FROM budget_lines WHERE id=$1', [id])).rows[0] ?? null;
      }
      const sets = keys.map((k, i) => `${k}=$${i + 1}`).join(', ');
      const { rows } = await pool.query(
        `UPDATE budget_lines SET ${sets}, updated_at=NOW() WHERE id=$${keys.length + 1} RETURNING *`,
        [...keys.map(k => fields[k]), id]
      );
      return rows[0] ?? null;
    },
    deleteLine: async (id) => pool.query('DELETE FROM budget_lines WHERE id=$1', [id]),
    // Wipe an entire fiscal year's budget — used by the QB rebuild flow
    // so we can start clean with accounts straight from the chart.
    // Cascades to budget_cells via ON DELETE CASCADE on the FK.
    deleteAllForFiscalYear: async (fiscalYear) => {
      await pool.query('DELETE FROM budget_lines WHERE fiscal_year=$1', [fiscalYear]);
    },
    upsertCell: async ({ line_id, period_date, budget_amount }) => {
      const { rows } = await pool.query(
        `INSERT INTO budget_cells (line_id, period_date, budget_amount)
         VALUES ($1, $2, $3)
         ON CONFLICT (line_id, period_date)
         DO UPDATE SET budget_amount = EXCLUDED.budget_amount, updated_at = NOW()
         RETURNING *`,
        [line_id, period_date, budget_amount]
      );
      return rows[0];
    },
    setActual: async ({ line_id, period_date, actual_amount, source }) => {
      const { rows } = await pool.query(
        `INSERT INTO budget_cells (line_id, period_date, actual_amount, actual_source, actual_synced_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (line_id, period_date)
         DO UPDATE SET actual_amount = EXCLUDED.actual_amount,
                       actual_source = EXCLUDED.actual_source,
                       actual_synced_at = NOW(),
                       updated_at = NOW()
         RETURNING *`,
        [line_id, period_date, actual_amount, source || 'manual']
      );
      return rows[0];
    },
  };

  // QuickBooks Online connection. One row per realm (company); in practice
  // SRED.ca has a single QB company so we'll typically see one row.
  const qbConnectionQueries = {
    getActive: async () => (
      await pool.query('SELECT * FROM qb_connections ORDER BY updated_at DESC LIMIT 1')
    ).rows[0] ?? null,
    getByRealm: async (realmId) => (
      await pool.query('SELECT * FROM qb_connections WHERE realm_id=$1', [realmId])
    ).rows[0] ?? null,
    upsert: async ({ realm_id, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, connected_by_user_id }) => {
      const { rows } = await pool.query(
        `INSERT INTO qb_connections
           (realm_id, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, connected_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (realm_id) DO UPDATE SET
           access_token             = EXCLUDED.access_token,
           refresh_token            = EXCLUDED.refresh_token,
           access_token_expires_at  = EXCLUDED.access_token_expires_at,
           refresh_token_expires_at = EXCLUDED.refresh_token_expires_at,
           connected_by_user_id     = EXCLUDED.connected_by_user_id,
           updated_at               = NOW()
         RETURNING *`,
        [realm_id, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at || null, connected_by_user_id || null]
      );
      return rows[0];
    },
    updateTokens: async (id, { access_token, refresh_token, access_token_expires_at, refresh_token_expires_at }) => (
      await pool.query(
        `UPDATE qb_connections SET
           access_token=$1, refresh_token=$2,
           access_token_expires_at=$3, refresh_token_expires_at=$4,
           updated_at=NOW()
         WHERE id=$5 RETURNING *`,
        [access_token, refresh_token, access_token_expires_at, refresh_token_expires_at || null, id]
      )
    ).rows[0] ?? null,
    markSynced: async (id) => (
      await pool.query(
        'UPDATE qb_connections SET last_synced_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *', [id]
      )
    ).rows[0] ?? null,
    disconnect: async () => pool.query('DELETE FROM qb_connections'),
  };

  // Per-user sidebar tab visibility. Only the assignable tabs are stored here;
  // default tabs (my90, issues, team-issues, meetings, insights) are always on.
  const tabAccessQueries = {
    listForUser: async (userId) => {
      const { rows } = await pool.query(
        'SELECT tab FROM user_tab_access WHERE user_id=$1 ORDER BY tab', [userId]
      );
      return rows.map(r => r.tab);
    },
    listAll: async () => {
      const { rows } = await pool.query('SELECT user_id, tab FROM user_tab_access');
      const by = {};
      rows.forEach(r => { (by[r.user_id] ||= []).push(r.tab); });
      return by; // { <user_id>: ['vto','rocks', ...] }
    },
    set: async (userId, tabs) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM user_tab_access WHERE user_id=$1', [userId]);
        const unique = Array.from(new Set((tabs || []).filter(Boolean)));
        for (const tab of unique) {
          await client.query(
            'INSERT INTO user_tab_access (user_id,tab) VALUES ($1,$2) ON CONFLICT DO NOTHING',
            [userId, tab]
          );
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
      return tabAccessQueries.listForUser(userId);
    },
  };

  module.exports = { initDb, pool, userQueries, rockQueries, issueQueries, agendaQueries, meetingQueries, teamIssueQueries, milestoneQueries, coachingQueries, vtoQueries, budgetQueries, qbConnectionQueries, tabAccessQueries };

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
  // Backfill role on existing rows; mark Jude + Logan (by email or name) as owners.
  // Mirrors the Postgres migration above so both branches behave identically.
  const OWNER_EMAILS = new Set(['jude@sred.ca', 'logan@sred.ca']);
  const OWNER_NAMES  = new Set(['Logan']);
  (db.users || []).forEach(u => {
    if (!u.role) u.role = 'member';
    if (OWNER_EMAILS.has(u.email) || OWNER_NAMES.has(u.name)) u.role = 'owner';
  });
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
    getByCoachingPhone: async (phone) => db.users.find(u => u.coaching_phone === phone) ?? null,
    updateCoachingSettings: async (id, { coaching_enabled, coaching_phone }) => {
      const u = db.users.find(x => x.id === +id); if (!u) return null;
      u.coaching_enabled = !!coaching_enabled;
      u.coaching_phone = coaching_phone || null;
      persist(db);
      return u;
    },
    create:   async (name, color) => {
      const user = { id: nextId('users'), name, color: color || '#6366f1', role: 'member', created_at: nowStr() };
      db.users.push(user); persist(db); return user;
    },
    update: async (id, name, color) => {
      const u = db.users.find(u => u.id === +id); if (!u) return null;
      u.name = name; u.color = color; persist(db); return u;
    },
    setRole: async (id, role) => {
      const u = db.users.find(u => u.id === +id); if (!u) return null;
      u.role = role; persist(db); return u;
    },
    countOwners: async () => db.users.filter(u => (u.role || 'member') === 'owner').length,
    delete: async (id) => { db.users = db.users.filter(u => u.id !== +id); persist(db); },
    findOrCreateByEmail: async (email, name, picture) => {
      const colors = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ef4444'];
      const existing = db.users.find(u => u.email === email);
      if (existing) {
        existing.name = name;
        existing.picture = picture || null;
        if (!existing.role) existing.role = OWNER_EMAILS.has(email) ? 'owner' : 'member';
        persist(db); return existing;
      }
      const color = colors[db.users.length % colors.length];
      const role  = OWNER_EMAILS.has(email) ? 'owner' : 'member';
      const user  = { id: nextId('users'), name, email, color, picture: picture || null, role, created_at: nowStr() };
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
        .filter(r => r.owner_id === uid && r.status !== 'done')
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

    setAssistantPrompt: async (user_id, system_prompt) => {
      if (!db.coaching_assistant_prompts) db.coaching_assistant_prompts = [];
      const uid = +user_id;
      const idx = db.coaching_assistant_prompts.findIndex(p => p.user_id === uid);
      const row = { user_id: uid, system_prompt, updated_at: nowStr() };
      if (idx >= 0) db.coaching_assistant_prompts[idx] = row;
      else db.coaching_assistant_prompts.push(row);
      persist(db);
    },
    getAssistantPrompt: async (user_id) => {
      if (!db.coaching_assistant_prompts) return null;
      return db.coaching_assistant_prompts.find(p => p.user_id === +user_id) ?? null;
    },
    listEnabledUsers: async () => {
      return db.users
        .filter(u => u.coaching_enabled)
        .map(u => ({ id: u.id, name: u.name, email: u.email, coaching_phone: u.coaching_phone }));
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

  // Single-row V/TO. Mirrors the Postgres vtoQueries interface.
  const VTO_FIELDS = [
    'core_values', 'core_focus_purpose', 'core_focus_niche',
    'ten_year_target', 'ten_year_measurables',
    'target_market', 'three_uniques', 'proven_process', 'guarantee',
    'three_year_future_date', 'three_year_revenue', 'three_year_profit',
    'three_year_measurables', 'three_year_looks_like',
    'one_year_future_date', 'one_year_revenue', 'one_year_profit',
    'one_year_measurables', 'one_year_goals',
  ];
  const VTO_JSON_FIELDS = new Set([
    'core_values', 'ten_year_measurables', 'three_uniques',
    'three_year_measurables', 'three_year_looks_like',
    'one_year_measurables', 'one_year_goals',
  ]);
  function defaultVto() {
    return {
      id: 1,
      core_values: [],
      core_focus_purpose: '',
      core_focus_niche: '',
      ten_year_target: '',
      ten_year_measurables: [],
      target_market: '',
      three_uniques: [],
      proven_process: '',
      guarantee: '',
      three_year_future_date: null,
      three_year_revenue: '',
      three_year_profit: '',
      three_year_measurables: [],
      three_year_looks_like: [],
      one_year_future_date: null,
      one_year_revenue: '',
      one_year_profit: '',
      one_year_measurables: [],
      one_year_goals: [],
      created_at: nowStr(),
      updated_at: nowStr(),
    };
  }
  const vtoQueries = {
    getOrCreate: async () => {
      if (!db.vto) { db.vto = defaultVto(); persist(db); }
      return { ...db.vto };
    },
    update: async (fields) => {
      if (!db.vto) db.vto = defaultVto();
      for (const k of VTO_FIELDS) {
        if (!(k in fields)) continue;
        const v = fields[k];
        if (VTO_JSON_FIELDS.has(k))      db.vto[k] = Array.isArray(v) ? v : [];
        else if (k.endsWith('_future_date')) db.vto[k] = (v === '' || v == null) ? null : v;
        else                              db.vto[k] = v == null ? '' : String(v);
      }
      db.vto.updated_at = nowStr();
      persist(db);
      return { ...db.vto };
    },
  };

  // Budget — JSON-mode mirror of the Postgres budgetQueries interface.
  const BUDGET_LINE_FIELDS = ['fiscal_year', 'section', 'category', 'sort_order', 'qb_account_id', 'notes'];
  if (!db.budget_lines) { db.budget_lines = []; persist(db); }
  if (!db.budget_cells) { db.budget_cells = []; persist(db); }
  if (!db._seq.budget_lines) db._seq.budget_lines = 0;
  if (!db._seq.budget_cells) db._seq.budget_cells = 0;
  const budgetQueries = {
    getAll: async (fiscalYear) => {
      const lines = (fiscalYear
        ? db.budget_lines.filter(l => l.fiscal_year === fiscalYear)
        : [...db.budget_lines]
      ).sort((a, b) => (a.sort_order - b.sort_order) || (a.id - b.id));
      const ids = new Set(lines.map(l => l.id));
      const cells = db.budget_cells
        .filter(c => ids.has(c.line_id))
        .sort((a, b) => (a.line_id - b.line_id) || a.period_date.localeCompare(b.period_date));
      return { lines, cells };
    },
    createLine: async (fields) => {
      if (!fields.fiscal_year || !fields.category) throw new Error('fiscal_year and category are required');
      const line = {
        id: nextId('budget_lines'),
        fiscal_year: fields.fiscal_year,
        section:     fields.section || 'opex',
        category:    fields.category,
        sort_order:  fields.sort_order ?? 0,
        qb_account_id: fields.qb_account_id || null,
        notes:       fields.notes || null,
        created_at:  nowStr(),
        updated_at:  nowStr(),
      };
      db.budget_lines.push(line); persist(db); return line;
    },
    updateLine: async (id, fields) => {
      const l = db.budget_lines.find(x => x.id === +id); if (!l) return null;
      BUDGET_LINE_FIELDS.forEach(k => { if (k in fields) l[k] = fields[k]; });
      l.updated_at = nowStr();
      persist(db); return l;
    },
    deleteLine: async (id) => {
      db.budget_lines = db.budget_lines.filter(l => l.id !== +id);
      db.budget_cells = db.budget_cells.filter(c => c.line_id !== +id);
      persist(db);
    },
    deleteAllForFiscalYear: async (fiscalYear) => {
      const kept = db.budget_lines.filter(l => l.fiscal_year !== fiscalYear);
      const killedIds = new Set(
        db.budget_lines.filter(l => l.fiscal_year === fiscalYear).map(l => l.id)
      );
      db.budget_lines = kept;
      db.budget_cells = db.budget_cells.filter(c => !killedIds.has(c.line_id));
      persist(db);
    },
    upsertCell: async ({ line_id, period_date, budget_amount }) => {
      const existing = db.budget_cells.find(c => c.line_id === +line_id && c.period_date === period_date);
      if (existing) {
        existing.budget_amount = Number(budget_amount);
        existing.updated_at = nowStr();
        persist(db); return existing;
      }
      const cell = {
        id: nextId('budget_cells'),
        line_id: +line_id,
        period_date,
        budget_amount: Number(budget_amount),
        actual_amount: null,
        actual_source: null,
        actual_synced_at: null,
        created_at: nowStr(),
        updated_at: nowStr(),
      };
      db.budget_cells.push(cell); persist(db); return cell;
    },
    setActual: async ({ line_id, period_date, actual_amount, source }) => {
      const existing = db.budget_cells.find(c => c.line_id === +line_id && c.period_date === period_date);
      if (existing) {
        existing.actual_amount = Number(actual_amount);
        existing.actual_source = source || 'manual';
        existing.actual_synced_at = nowStr();
        existing.updated_at = nowStr();
        persist(db); return existing;
      }
      const cell = {
        id: nextId('budget_cells'),
        line_id: +line_id,
        period_date,
        budget_amount: 0,
        actual_amount: Number(actual_amount),
        actual_source: source || 'manual',
        actual_synced_at: nowStr(),
        created_at: nowStr(),
        updated_at: nowStr(),
      };
      db.budget_cells.push(cell); persist(db); return cell;
    },
  };

  // QuickBooks Online connection — JSON-mode mirror.
  if (!db.qb_connections) { db.qb_connections = []; persist(db); }
  if (!db._seq.qb_connections) db._seq.qb_connections = 0;
  const qbConnectionQueries = {
    getActive: async () => {
      if (!db.qb_connections.length) return null;
      return [...db.qb_connections].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
    },
    getByRealm: async (realmId) => db.qb_connections.find(c => c.realm_id === realmId) ?? null,
    upsert: async ({ realm_id, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, connected_by_user_id }) => {
      const existing = db.qb_connections.find(c => c.realm_id === realm_id);
      if (existing) {
        existing.access_token = access_token;
        existing.refresh_token = refresh_token;
        existing.access_token_expires_at = access_token_expires_at;
        existing.refresh_token_expires_at = refresh_token_expires_at || null;
        existing.connected_by_user_id = connected_by_user_id || null;
        existing.updated_at = nowStr();
        persist(db); return existing;
      }
      const conn = {
        id: nextId('qb_connections'),
        realm_id, access_token, refresh_token,
        access_token_expires_at,
        refresh_token_expires_at: refresh_token_expires_at || null,
        connected_by_user_id: connected_by_user_id || null,
        last_synced_at: null,
        created_at: nowStr(),
        updated_at: nowStr(),
      };
      db.qb_connections.push(conn); persist(db); return conn;
    },
    updateTokens: async (id, { access_token, refresh_token, access_token_expires_at, refresh_token_expires_at }) => {
      const c = db.qb_connections.find(x => x.id === +id); if (!c) return null;
      c.access_token = access_token;
      c.refresh_token = refresh_token;
      c.access_token_expires_at = access_token_expires_at;
      c.refresh_token_expires_at = refresh_token_expires_at || null;
      c.updated_at = nowStr();
      persist(db); return c;
    },
    markSynced: async (id) => {
      const c = db.qb_connections.find(x => x.id === +id); if (!c) return null;
      c.last_synced_at = nowStr();
      c.updated_at = nowStr();
      persist(db); return c;
    },
    disconnect: async () => { db.qb_connections = []; persist(db); },
  };

  if (!db.user_tab_access) { db.user_tab_access = []; persist(db); }

  const tabAccessQueries = {
    listForUser: async (userId) =>
      db.user_tab_access.filter(r => r.user_id === +userId).map(r => r.tab).sort(),
    listAll: async () => {
      const by = {};
      db.user_tab_access.forEach(r => { (by[r.user_id] ||= []).push(r.tab); });
      return by;
    },
    set: async (userId, tabs) => {
      const uid = +userId;
      db.user_tab_access = db.user_tab_access.filter(r => r.user_id !== uid);
      const unique = Array.from(new Set((tabs || []).filter(Boolean)));
      unique.forEach(tab => db.user_tab_access.push({ user_id: uid, tab }));
      persist(db);
      return tabAccessQueries.listForUser(uid);
    },
  };

  module.exports = { initDb, userQueries, rockQueries, issueQueries, agendaQueries, meetingQueries, teamIssueQueries, milestoneQueries, coachingQueries, vtoQueries, budgetQueries, qbConnectionQueries, tabAccessQueries };
}
