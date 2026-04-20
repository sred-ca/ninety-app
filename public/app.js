/* ── State ───────────────────────────────────────────────────────── */
const state = {
  currentUser: null,
  users: [],
  rocks: [],
  issues: [],
  userVotes: [],
  currentView: 'my90',
  my90Rocks: [],
  my90Issues: [],
  my90Meetings: [],
  my90Votes: [],
  quarterFilter: '',
  issueStatusFilter: 'in_progress',
  issueOwnerFilter: [],
  issueVisibilityFilter: 'public',
  issueViewMode: 'cards',
  // Team Issues (IDS discussion items — distinct from the "To-Dos" feature above)
  teamIssues: [],
  teamIssueHorizonFilter: 'short_term',
  teamIssueOwnerFilter: [],
  teamIssueViewMode: 'cards',
  pendingDelete: null,
  // Meetings
  agendas: [],
  meetings: [],
  meetingsSubTab: 'upcoming',
  currentAgendaId: null,  // null = list view, number = editing that agenda
  currentAgendaSections: [],
  runner: {
    active: false,
    meetingId: null,
    title: '',
    sections: [],       // visible sections only
    sectionIdx: 0,
    sectionElapsed: 0,  // seconds into current section
    totalElapsed: 0,    // total seconds elapsed
    playing: false,
    interval: null,
  },
  // Insights
  insightsSubTab: 'rocks',
  insightsPeriod: 'current',
  insightsOwner: '',
  insightCharts: {},
  insightsRocks: [],
  insightsTodos: [],
  insightsMeetings: [],
};

/* ── API ─────────────────────────────────────────────────────────── */
const api = {
  async get(path) {
    const r = await fetch(path);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    return j.data;
  },
  async post(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    return j.data;
  },
  async put(path, body) {
    const r = await fetch(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    return j.data;
  },
  async del(path) {
    const r = await fetch(path, { method: 'DELETE' });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    return j.data;
  },
};

/* ── Helpers ─────────────────────────────────────────────────────── */
function qs(sel) { return document.querySelector(sel); }
function qsa(sel) { return [...document.querySelectorAll(sel)]; }

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function avatar(name, picture, color, size = 28) {
  const el = document.createElement('div');
  el.className = 'avatar';
  el.style.width = el.style.height = size + 'px';
  if (picture) {
    const img = document.createElement('img');
    img.src = picture;
    img.alt = name || '';
    img.referrerPolicy = 'no-referrer';
    // Fall back to initials if the image fails (e.g., Google URL rotated)
    img.onerror = () => {
      el.removeChild(img);
      el.style.background = color || '#6366f1';
      el.style.fontSize = (size * 0.38) + 'px';
      el.textContent = initials(name);
    };
    el.appendChild(img);
  } else {
    el.style.background = color || '#6366f1';
    el.style.fontSize = (size * 0.38) + 'px';
    el.textContent = initials(name);
  }
  return el;
}

const ISSUE_STATUS_LABELS = {
  in_progress: 'In Progress',
  waiting_for: 'Waiting For',
  blocker:     'Blocker',
  solved:      'Solved',
};
function issueStatusLabel(s) { return ISSUE_STATUS_LABELS[s] || s.replace(/_/g, ' '); }

function badge(text, cls) {
  const el = document.createElement('span');
  el.className = `badge badge-${cls}`;
  el.textContent = text.replace('_', ' ');
  return el;
}

function quarters() {
  const now = new Date();
  const y = now.getFullYear();
  return [`Q4 ${y}`, `Q3 ${y}`, `Q2 ${y}`, `Q1 ${y}`];
}

function currentQuarter() {
  const now = new Date();
  return `Q${Math.ceil((now.getMonth() + 1) / 3)} ${now.getFullYear()}`;
}

function periodDateRange(period) {
  const now = new Date();
  const y = now.getFullYear();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  const qStart = (qn, yr) => new Date(yr, (qn - 1) * 3, 1);
  const qEnd   = (qn, yr) => new Date(yr, qn * 3, 0, 23, 59, 59, 999);
  if (period === 'current') return { start: qStart(q, y), end: qEnd(q, y) };
  if (period === 'last') {
    const lq = q === 1 ? 4 : q - 1;
    const ly = q === 1 ? y - 1 : y;
    return { start: qStart(lq, ly), end: qEnd(lq, ly) };
  }
  return { start: new Date(0), end: new Date(9999, 0) };
}

/* Add N business days to today, return YYYY-MM-DD string */
function addBusinessDays(n) {
  const d = new Date();
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}

/* Format a YYYY-MM-DD due date for display; returns {text, urgency} */
function formatDueDate(dateStr) {
  if (!dateStr) return null;
  const today = new Date().toISOString().slice(0, 10);
  const due   = dateStr.slice(0, 10);
  const [y, m, d] = due.split('-').map(Number);
  // Format as "Apr 15"
  const label = new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (due < today)  return { text: label, urgency: 'overdue' };
  if (due === today) return { text: 'Today', urgency: 'today' };
  // Check if tomorrow
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  if (due === tomorrow.toISOString().slice(0, 10)) return { text: 'Tomorrow', urgency: 'soon' };
  return { text: label, urgency: 'normal' };
}

function openModal(id) { qs(`#${id}`).classList.add('active'); }
function closeModal(id) { qs(`#${id}`).classList.remove('active'); }

/* ── Auth / User ─────────────────────────────────────────────────── */
async function loadUsers() {
  state.users = await api.get('/api/users');
  renderIssueOwnerFilter();
  renderTeamIssueOwnerFilter();
}

function showLoginScreen(errorMsg) {
  qs('#login-screen').classList.remove('hidden');
  qs('#app').classList.add('hidden');
  if (errorMsg) {
    const el = qs('#login-error');
    el.textContent = errorMsg;
    el.classList.remove('hidden');
  }
}

function enterApp(user) {
  state.currentUser = user;
  qs('#login-screen').classList.add('hidden');
  qs('#app').classList.remove('hidden');
  updateSidebarUser();
  loadAll();
}

function updateSidebarUser() {
  const u = state.currentUser;
  if (!u) return;
  const fresh = avatar(u.name, u.picture, u.color, 28);
  qs('#sidebar-avatar').replaceWith(Object.assign(fresh, { id: 'sidebar-avatar' }));
  qs('#sidebar-username').textContent = u.name;
}

/* ── Navigation ──────────────────────────────────────────────────── */
qsa('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    qsa('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    qsa('.view').forEach(v => v.classList.remove('active'));
    qs(`#view-${view}`).classList.add('active');
    state.currentView = view;
    if (view === 'my90')      loadMy90();
    if (view === 'meetings')  loadMeetings();
    if (view === 'insights')  loadInsights();
  });
});

/* ── Modal close buttons ─────────────────────────────────────────── */
qsa('[data-modal]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.modal));
});
qsa('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

/* ════════════════════════════════════════════════════════════════════
   ROCKS
   ════════════════════════════════════════════════════════════════════ */

async function loadRocks() {
  const url = state.quarterFilter ? `/api/rocks?quarter=${encodeURIComponent(state.quarterFilter)}` : '/api/rocks';
  state.rocks = await api.get(url);
  renderRocks();
}

function renderRocks() {
  const list = qs('#rocks-list');
  const empty = qs('#rocks-empty');
  list.innerHTML = '';

  // Stats
  const total = state.rocks.length;
  const done = state.rocks.filter(r => r.status === 'done').length;
  const onTrack = state.rocks.filter(r => r.status === 'on_track').length;
  const offTrack = state.rocks.filter(r => r.status === 'off_track').length;
  qs('#rocks-stats').innerHTML = `
    <div class="stat-card"><span class="stat-label">Total</span><span class="stat-value">${total}</span></div>
    <div class="stat-card green"><span class="stat-label">On Track</span><span class="stat-value">${onTrack}</span></div>
    <div class="stat-card red"><span class="stat-label">Off Track</span><span class="stat-value">${offTrack}</span></div>
    <div class="stat-card accent"><span class="stat-label">Done</span><span class="stat-value">${done}</span></div>
  `;

  if (state.rocks.length === 0) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  state.rocks.forEach(rock => {
    const row = document.createElement('div');
    row.className = 'table-row';
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => openRockModal(rock.id));

    // Title cell
    const titleCell = document.createElement('div');
    titleCell.className = 'rock-title-cell';
    titleCell.innerHTML = `<div class="rock-title">${esc(rock.title)}</div>`;
    if (rock.description) {
      titleCell.innerHTML += `<div class="rock-desc">${esc(rock.description)}</div>`;
    }

    // Owner cell
    const ownerCell = document.createElement('div');
    ownerCell.className = 'owner-cell';
    if (rock.owner_name) {
      ownerCell.appendChild(avatar(rock.owner_name, rock.owner_picture, rock.owner_color));
      ownerCell.appendChild(document.createTextNode(rock.owner_name));
    } else {
      ownerCell.innerHTML = '<span style="color:var(--text2);font-size:12px">Unassigned</span>';
    }

    // Progress cell
    const pct = rock.progress || 0;
    const progressCell = document.createElement('div');
    progressCell.className = 'progress-cell';
    progressCell.innerHTML = `
      <div class="progress-bar-wrap">
        <div class="progress-bar-fill ${rock.status === 'done' ? 'done' : ''}" style="width:${pct}%"></div>
      </div>
      <span class="progress-label-sm">${pct}%</span>
    `;

    // Status badge
    const statusLabels = { on_track: 'On Track', off_track: 'Off Track', done: 'Done', not_started: 'Not Started' };
    const statusCell = document.createElement('div');
    statusCell.appendChild(badge(statusLabels[rock.status] || rock.status, rock.status));

    // Actions
    const actions = document.createElement('div');
    actions.className = 'row-actions';
    actions.innerHTML = `
      <button class="icon-btn danger delete-rock-btn" data-id="${rock.id}" data-title="${esc(rock.title)}" title="Delete">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
      </button>
    `;

    row.append(titleCell, ownerCell, progressCell, statusCell, actions);
    list.appendChild(row);
  });

  // Events
  qsa('.delete-rock-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); confirmDelete('rock', btn.dataset.id, btn.dataset.title); });
  });
}

/* Quarter filter */
async function populateQuarterFilter() {
  const qs_ = qs('#quarter-filter');
  const serverQuarters = await api.get('/api/rocks/quarters');
  const allQ = [...new Set([currentQuarter(), ...quarters(8), ...serverQuarters])];
  qs_.innerHTML = `<option value="">All Quarters</option>` +
    allQ.map(q => `<option value="${q}" ${q === currentQuarter() ? 'selected' : ''}>${q}</option>`).join('');
  state.quarterFilter = currentQuarter();
  qs_.addEventListener('change', () => { state.quarterFilter = qs_.value; loadRocks(); });
}

/* Add Rock modal */
qs('#add-rock-btn').addEventListener('click', () => openRockModal(null));

function openRockModal(editId) {
  const rock = editId ? state.rocks.find(r => r.id === editId) : null;
  qs('#rock-modal-title').textContent = rock ? 'Edit Rock' : 'Add Rock';
  qs('#rock-id').value = rock ? rock.id : '';
  qs('#rock-title').value = rock ? rock.title : '';
  qs('#rock-description').value = rock ? (rock.description || '') : '';
  qs('#rock-status').value = rock ? rock.status : 'not_started';
  qs('#rock-progress').value = rock ? rock.progress : 0;
  qs('#progress-label').textContent = `${rock ? rock.progress : 0}%`;

  // Populate owner dropdown
  const ownerSel = qs('#rock-owner');
  ownerSel.innerHTML = '<option value="">Unassigned</option>' +
    state.users.map(u => `<option value="${u.id}" ${rock && rock.owner_id === u.id ? 'selected' : ''}>${u.name}</option>`).join('');
  if (!rock) ownerSel.value = state.currentUser ? state.currentUser.id : '';

  // Populate quarter dropdown
  const allQ = [...new Set([currentQuarter(), ...quarters(8)])];
  const qSel = qs('#rock-quarter');
  qSel.innerHTML = allQ.map(q => `<option value="${q}" ${rock ? (rock.quarter === q ? 'selected' : '') : (q === (state.quarterFilter || currentQuarter()) ? 'selected' : '')}>${q}</option>`).join('');

  openModal('rock-modal');
  qs('#rock-title').focus();
}

// Progress slider live update
qs('#rock-progress').addEventListener('input', () => {
  qs('#progress-label').textContent = `${qs('#rock-progress').value}%`;
});

qs('#save-rock-btn').addEventListener('click', async () => {
  const id = qs('#rock-id').value;
  const body = {
    title: qs('#rock-title').value.trim(),
    description: qs('#rock-description').value.trim(),
    owner_id: qs('#rock-owner').value || null,
    quarter: qs('#rock-quarter').value,
    status: qs('#rock-status').value,
    progress: parseInt(qs('#rock-progress').value),
  };
  if (!body.title) { qs('#rock-title').focus(); return; }
  try {
    if (id) {
      await api.put(`/api/rocks/${id}`, body);
    } else {
      await api.post('/api/rocks', body);
    }
    closeModal('rock-modal');
    loadRocks();
  } catch (e) { alert(e.message); }
});

/* ════════════════════════════════════════════════════════════════════
   ISSUES
   ════════════════════════════════════════════════════════════════════ */

async function loadIssues() {
  // Always fetch the full visible set (including archived) so the stats bar
  // stays stable regardless of client-side status/owner filters.
  [state.issues, state.userVotes] = await Promise.all([
    api.get('/api/issues?include_archived=1'),
    state.currentUser ? api.get(`/api/issues/votes/${state.currentUser.id}`) : Promise.resolve([]),
  ]);
  renderIssues();
}

/* Build a single issue card DOM element */
function buildIssueCard(issue) {
  const isArchived = !!issue.archived;
  const isSolved   = issue.status === 'solved';
  const isPrivate  = !!issue.private;
  const isOwner    = !!(state.currentUser && issue.owner_id === state.currentUser.id);
  const card = document.createElement('div');
  card.className = `issue-card ${isSolved ? 'solved' : ''} ${isArchived ? 'archived' : ''} ${isPrivate ? 'private' : ''}`;
  if (!isArchived) {
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => openIssueModal(issue.id));
  }

  const voted = state.userVotes.includes(issue.id);

  // Due date chip
  const due = formatDueDate(issue.due_date);
  const dueDateHtml = due
    ? `<div class="due-date-chip due-${due.urgency}">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;flex-shrink:0">
           <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
         </svg>
         ${due.text}
       </div>`
    : '';

  // Solve (checkmark) button: shown on non-solved, non-archived cards
  const solveBtn = (!isSolved && !isArchived)
    ? `<button class="icon-btn solve-issue-btn" data-id="${issue.id}" title="Mark as Solved">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
       </button>`
    : '';

  // Archive button: shown on solved, non-archived cards
  const archiveBtn = (isSolved && !isArchived)
    ? `<button class="icon-btn archive-issue-btn" data-id="${issue.id}" title="Archive">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="21 8 21 21 3 21 3 8"/>
          <rect x="1" y="3" width="22" height="5"/>
          <line x1="10" y1="12" x2="14" y2="12"/>
        </svg>
       </button>`
    : '';

  // Unarchive button: shown only on archived cards
  const unarchiveBtn = isArchived
    ? `<button class="icon-btn unarchive-issue-btn" data-id="${issue.id}" title="Unarchive">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="21 8 21 21 3 21 3 8"/>
          <rect x="1" y="3" width="22" height="5"/>
          <polyline points="10 12 12 10 14 12"/>
        </svg>
       </button>`
    : '';

  // Privacy toggle: only the owner sees this control. Closed padlock when private,
  // open padlock when public. Not shown on archived cards.
  const privateBtn = (isOwner && !isArchived)
    ? `<button class="icon-btn privacy-toggle-btn ${isPrivate ? 'is-private' : ''}" data-id="${issue.id}" data-private="${isPrivate ? '1' : '0'}" title="${isPrivate ? 'Make public' : 'Make private'}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          ${isPrivate
            ? '<path d="M7 11V7a5 5 0 0 1 10 0v4"/>'
            : '<path d="M7 11V7a5 5 0 0 1 9.9-1"/>'}
        </svg>
       </button>`
    : '';

  // Small lock marker prepended to the title when private, so owners can scan at a glance.
  const privateMark = isPrivate
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;flex-shrink:0;margin-right:6px;vertical-align:-1px;opacity:.7"><rect x="5" y="11" width="14" height="9" rx="2" ry="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`
    : '';

  card.innerHTML = `
    <div class="issue-card-top">
      <div class="issue-priority-dot ${issue.priority}"></div>
      <div class="issue-title">${privateMark}${esc(issue.title)}</div>
    </div>
    ${issue.description ? `<div class="issue-desc">${esc(issue.description)}</div>` : ''}
    <div class="issue-card-meta-row">
      ${dueDateHtml}
      ${issue.owner_name ? `<span class="issue-owner-chip"></span>` : ''}
    </div>
    <div class="issue-card-bottom">
      <div class="issue-meta">
        <span class="badge badge-${issue.status}">${issueStatusLabel(issue.status)}</span>
        <span class="badge badge-${issue.priority}">${issue.priority}</span>
      </div>
      <div class="issue-actions">
        ${!isArchived ? `<button class="vote-btn ${voted ? 'voted' : ''}" data-id="${issue.id}" title="${voted ? 'Remove vote' : 'Vote to prioritize'}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>
          ${issue.votes}
        </button>` : ''}
        ${solveBtn}
        ${privateBtn}
        ${archiveBtn}
        ${unarchiveBtn}
        ${!isArchived && !isSolved ? `<button class="icon-btn delete-issue-btn" data-id="${issue.id}" title="Move to Solved">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>` : ''}
      </div>
    </div>
  `;

  // Inject owner avatar
  if (issue.owner_name) {
    const chip = card.querySelector('.issue-owner-chip');
    if (chip) {
      chip.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:12px;color:var(--text2)';
      chip.prepend(avatar(issue.owner_name, issue.owner_picture, issue.owner_color, 18));
      chip.append(document.createTextNode(issue.owner_name));
    }
  }

  return card;
}

/* Build a single issue row (list view) */
function buildIssueRow(issue) {
  const isArchived = !!issue.archived;
  const isSolved   = issue.status === 'solved';
  const isPrivate  = !!issue.private;
  const isOwner    = !!(state.currentUser && issue.owner_id === state.currentUser.id);
  const voted      = state.userVotes.includes(issue.id);
  const due        = formatDueDate(issue.due_date);
  const statusLabel = issueStatusLabel(issue.status);

  const row = document.createElement('div');
  row.className = `table-row issue-table-row ${isSolved ? 'solved' : ''} ${isArchived ? 'archived' : ''} ${isPrivate ? 'private' : ''}`;
  if (!isArchived) {
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => openIssueModal(issue.id));
  }

  const privateMark = isPrivate
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;flex-shrink:0;margin-right:6px;vertical-align:-1px;opacity:.7"><rect x="5" y="11" width="14" height="9" rx="2" ry="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`
    : '';

  row.innerHTML = `
    <div class="issue-title-cell">
      <div class="issue-priority-dot ${issue.priority}" style="margin-right:8px;flex-shrink:0"></div>
      <div class="issue-row-title">${privateMark}${esc(issue.title)}</div>
    </div>
    <div class="issue-row-owner"></div>
    <div class="issue-row-due">${due ? `<span class="due-date-chip due-${due.urgency}">${due.text}</span>` : '<span style="color:var(--text2)">—</span>'}</div>
    <div><span class="badge badge-${issue.priority}">${issue.priority}</span></div>
    <div><span class="badge badge-${issue.status}">${statusLabel}</span></div>
    <div class="issue-row-votes">
      ${!isArchived ? `<button class="vote-btn ${voted ? 'voted' : ''}" data-id="${issue.id}" title="${voted ? 'Remove vote' : 'Vote to prioritize'}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>
        ${issue.votes}
      </button>` : `<span style="color:var(--text2);font-size:13px">${issue.votes}</span>`}
    </div>
    <div class="row-actions">
      ${(!isSolved && !isArchived) ? `<button class="icon-btn solve-issue-btn" data-id="${issue.id}" title="Mark as Solved">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      </button>` : ''}
      ${(isOwner && !isArchived) ? `<button class="icon-btn privacy-toggle-btn ${isPrivate ? 'is-private' : ''}" data-id="${issue.id}" data-private="${isPrivate ? '1' : '0'}" title="${isPrivate ? 'Make public' : 'Make private'}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>${isPrivate ? '<path d="M7 11V7a5 5 0 0 1 10 0v4"/>' : '<path d="M7 11V7a5 5 0 0 1 9.9-1"/>'}</svg>
      </button>` : ''}
      ${(isSolved && !isArchived) ? `<button class="icon-btn archive-issue-btn" data-id="${issue.id}" title="Archive">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
      </button>` : ''}
      ${isArchived ? `<button class="icon-btn unarchive-issue-btn" data-id="${issue.id}" title="Unarchive">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><polyline points="10 12 12 10 14 12"/></svg>
      </button>` : ''}
      ${(!isArchived && !isSolved) ? `<button class="icon-btn delete-issue-btn" data-id="${issue.id}" title="Move to Solved">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
      </button>` : ''}
    </div>
  `;

  // Owner cell with avatar
  const ownerCell = row.querySelector('.issue-row-owner');
  if (issue.owner_name) {
    ownerCell.appendChild(avatar(issue.owner_name, issue.owner_picture, issue.owner_color, 22));
    ownerCell.appendChild(document.createTextNode(issue.owner_name));
  } else {
    ownerCell.innerHTML = '<span style="color:var(--text2);font-size:13px">Unassigned</span>';
  }

  return row;
}

function renderIssueOwnerFilter() {
  const panel = qs('#issue-owner-filter-panel');
  const selected = new Set(state.issueOwnerFilter.map(Number));
  panel.innerHTML =
    state.users.map(u => `
      <label class="owner-multiselect-option">
        <input type="checkbox" data-user-id="${u.id}" ${selected.has(u.id) ? 'checked' : ''}/>
        <span>${esc(u.name)}</span>
      </label>
    `).join('') +
    `<div class="owner-multiselect-divider"></div>
     <button type="button" class="owner-multiselect-clear" id="issue-owner-filter-clear">Clear selection</button>`;
  updateIssueOwnerFilterLabel();
}

function updateIssueOwnerFilterLabel() {
  const labelEl = qs('#issue-owner-filter-label');
  const ids = state.issueOwnerFilter.map(Number);
  if (ids.length === 0) { labelEl.textContent = 'All Owners'; return; }
  if (ids.length === 1) {
    const u = state.users.find(x => x.id === ids[0]);
    labelEl.textContent = u ? u.name : '1 owner';
    return;
  }
  if (ids.length === 2) {
    const names = ids.map(id => state.users.find(x => x.id === id)?.name).filter(Boolean);
    labelEl.textContent = names.join(', ');
    return;
  }
  labelEl.textContent = `${ids.length} owners`;
}

function renderIssues() {
  const grid = qs('#issues-list');
  const tableEl = qs('#issues-table');
  const tableBody = qs('#issues-table-body');
  const empty = qs('#issues-empty');
  const listMode = state.issueViewMode === 'list';
  const container = listMode ? tableBody : grid;
  const buildFn   = listMode ? buildIssueRow : buildIssueCard;
  grid.innerHTML = '';
  tableBody.innerHTML = '';
  grid.hidden = listMode;
  tableEl.hidden = !listMode;

  // Scope everything (list + stats) to the current visibility tab
  const inScope = state.issues.filter(i =>
    state.issueVisibilityFilter === 'private' ? i.private : !i.private
  );

  // Apply owner filter client-side (multi-select; empty = no filter)
  const ownerIds = state.issueOwnerFilter.map(Number);
  const ownerScoped = ownerIds.length
    ? inScope.filter(i => ownerIds.includes(i.owner_id))
    : inScope;

  // Apply status filter client-side (so stats above remain stable)
  // Non-solved tabs hide archived; solved tab keeps archived for the divider section.
  const statusFilter = state.issueStatusFilter;
  const filtered = statusFilter === 'solved'
    ? ownerScoped.filter(i => i.status === 'solved')
    : statusFilter
      ? ownerScoped.filter(i => i.status === statusFilter && !i.archived)
      : ownerScoped.filter(i => !i.archived);

  // Stats: exclude archived from counts; Total = all open (non-solved)
  const activeIssues = inScope.filter(i => !i.archived);
  const inProgress = activeIssues.filter(i => i.status === 'in_progress').length;
  const waitingFor = activeIssues.filter(i => i.status === 'waiting_for').length;
  const blockers   = activeIssues.filter(i => i.status === 'blocker').length;
  const solved     = activeIssues.filter(i => i.status === 'solved').length;
  const total      = inProgress + waitingFor + blockers;
  qs('#issues-stats').innerHTML = `
    <div class="stat-card"><span class="stat-label">Total Open</span><span class="stat-value">${total}</span></div>
    <div class="stat-card accent"><span class="stat-label">In Progress</span><span class="stat-value">${inProgress}</span></div>
    <div class="stat-card yellow"><span class="stat-label">Waiting For</span><span class="stat-value">${waitingFor}</span></div>
    <div class="stat-card red"><span class="stat-label">Blockers</span><span class="stat-value">${blockers}</span></div>
    <div class="stat-card green"><span class="stat-label">Solved</span><span class="stat-value">${solved}</span></div>
  `;

  if (filtered.length === 0) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  if (state.issueStatusFilter === 'solved') {
    // Solved tab: active solved first, then archived under a divider
    const activeSolved   = filtered.filter(i => !i.archived);
    const archivedSolved = filtered.filter(i =>  i.archived);

    if (activeSolved.length === 0 && archivedSolved.length === 0) {
      empty.classList.remove('hidden'); return;
    }

    activeSolved.forEach(issue => container.appendChild(buildFn(issue)));

    if (archivedSolved.length > 0) {
      const divider = document.createElement('div');
      divider.className = 'archived-section-header';
      divider.innerHTML = `
        <div class="archived-header-line"></div>
        <span class="archived-header-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;flex-shrink:0">
            <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/>
            <line x1="10" y1="12" x2="14" y2="12"/>
          </svg>
          Archived &middot; ${archivedSolved.length}
        </span>
        <div class="archived-header-line"></div>
      `;
      container.appendChild(divider);
      archivedSolved.forEach(issue => container.appendChild(buildFn(issue)));
    }
  } else {
    filtered.forEach(issue => container.appendChild(buildFn(issue)));
  }

  // ── Events ────────────────────────────────────────────────────────
  qsa('.vote-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!state.currentUser) return;
      const updated = await api.post(`/api/issues/${btn.dataset.id}/vote`, { user_id: state.currentUser.id });
      const idx = state.issues.findIndex(i => i.id === updated.id);
      if (idx >= 0) state.issues[idx] = updated;
      const vIdx = state.userVotes.indexOf(updated.id);
      if (vIdx >= 0) state.userVotes.splice(vIdx, 1);
      else state.userVotes.push(updated.id);
      renderIssues();
    });
  });

  qsa('.delete-issue-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api.put(`/api/issues/${btn.dataset.id}`, { status: 'solved' });
      loadIssues();
    });
  });

  qsa('.solve-issue-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api.put(`/api/issues/${btn.dataset.id}`, { status: 'solved' });
      loadIssues();
    });
  });

  qsa('.archive-issue-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api.put(`/api/issues/${btn.dataset.id}`, { archived: true });
      loadIssues();
    });
  });

  qsa('.unarchive-issue-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api.put(`/api/issues/${btn.dataset.id}`, { archived: false });
      loadIssues();
    });
  });

  qsa('.privacy-toggle-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const makePrivate = btn.dataset.private !== '1';
      await api.put(`/api/issues/${btn.dataset.id}`, { private: makePrivate });
      loadIssues();
    });
  });
}

/* Issue owner multiselect */
qs('#issue-owner-filter-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const panel = qs('#issue-owner-filter-panel');
  panel.hidden = !panel.hidden;
});
qs('#issue-owner-filter-panel').addEventListener('click', (e) => {
  e.stopPropagation();
  if (e.target.matches('input[type=checkbox][data-user-id]')) {
    const id = +e.target.dataset.userId;
    const idx = state.issueOwnerFilter.indexOf(id);
    if (e.target.checked && idx < 0) state.issueOwnerFilter.push(id);
    if (!e.target.checked && idx >= 0) state.issueOwnerFilter.splice(idx, 1);
    updateIssueOwnerFilterLabel();
    renderIssues();
  } else if (e.target.id === 'issue-owner-filter-clear') {
    state.issueOwnerFilter = [];
    renderIssueOwnerFilter();
    renderIssues();
  }
});
document.addEventListener('click', (e) => {
  const root = qs('#issue-owner-filter');
  if (!root.contains(e.target)) qs('#issue-owner-filter-panel').hidden = true;
});

/* Issue view-mode toggle (cards / list) — persisted to localStorage */
const ISSUE_VIEW_MODE_KEY = 'ninety.issueViewMode';
{
  const saved = localStorage.getItem(ISSUE_VIEW_MODE_KEY);
  if (saved === 'cards' || saved === 'list') {
    state.issueViewMode = saved;
    qsa('#issue-view-toggle .view-mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === saved);
    });
  }
}
qsa('#issue-view-toggle .view-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    qsa('#issue-view-toggle .view-mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.issueViewMode = btn.dataset.mode;
    try { localStorage.setItem(ISSUE_VIEW_MODE_KEY, btn.dataset.mode); } catch {}
    renderIssues();
  });
});

/* Issue visibility tabs (Public / Private) */
qsa('#issue-visibility-tabs .filter-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    qsa('#issue-visibility-tabs .filter-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.issueVisibilityFilter = tab.dataset.visibility;
    renderIssues();
  });
});

/* Issue filter tabs (client-side; stats bar stays full) */
qsa('#issue-filter-tabs .filter-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    qsa('#issue-filter-tabs .filter-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.issueStatusFilter = tab.dataset.status;
    renderIssues();
  });
});

/* Add Issue modal */
qs('#add-issue-btn').addEventListener('click', () => openIssueModal(null));

function openIssueModal(editId) {
  const issue = editId ? state.issues.find(i => i.id === editId) : null;
  qs('#issue-modal-title').textContent = issue ? 'Edit Issue' : 'Add Issue';
  qs('#issue-id').value = issue ? issue.id : '';
  qs('#issue-title').value = issue ? issue.title : '';
  qs('#issue-description').value = issue ? (issue.description || '') : '';
  qs('#issue-priority').value = issue ? issue.priority : 'medium';
  qs('#issue-status').value = issue ? issue.status : 'in_progress';
  qs('#issue-status-group').style.display = issue ? 'flex' : 'none';
  qs('#issue-private').checked = issue ? !!issue.private : (state.issueVisibilityFilter === 'private');

  // Due date: existing value or default to 5 business days from today
  qs('#issue-due-date').value = issue
    ? (issue.due_date ? issue.due_date.slice(0, 10) : '')
    : addBusinessDays(5);

  const ownerSel = qs('#issue-owner');
  ownerSel.innerHTML = '<option value="">Unassigned</option>' +
    state.users.map(u => `<option value="${u.id}" ${issue && issue.owner_id === u.id ? 'selected' : ''}>${u.name}</option>`).join('');
  if (!issue) ownerSel.value = state.currentUser ? state.currentUser.id : '';

  openModal('issue-modal');
  qs('#issue-title').focus();
}

qs('#save-issue-btn').addEventListener('click', async () => {
  const id = qs('#issue-id').value;
  const body = {
    title: qs('#issue-title').value.trim(),
    description: qs('#issue-description').value.trim(),
    owner_id: qs('#issue-owner').value || null,
    priority: qs('#issue-priority').value,
    status: qs('#issue-status').value,
    due_date: qs('#issue-due-date').value || null,
    private: qs('#issue-private').checked,
  };
  if (!body.title) { qs('#issue-title').focus(); return; }
  try {
    if (id) {
      await api.put(`/api/issues/${id}`, body);
    } else {
      await api.post('/api/issues', body);
    }
    closeModal('issue-modal');
    loadIssues();
  } catch (e) { alert(e.message); }
});

/* ════════════════════════════════════════════════════════════════════
   CONFIRM DELETE
   ════════════════════════════════════════════════════════════════════ */
function confirmDelete(type, id, title) {
  state.pendingDelete = { type, id };
  qs('#confirm-message').textContent = `Delete "${title}"? This cannot be undone.`;
  openModal('confirm-modal');
}

qs('#confirm-delete-btn').addEventListener('click', async () => {
  if (!state.pendingDelete) return;
  const { type, id } = state.pendingDelete;
  try {
    if (type === 'rock')    { await api.del(`/api/rocks/${id}`);    closeModal('confirm-modal'); loadRocks(); }
    else if (type === 'issue')   { await api.del(`/api/issues/${id}`);   closeModal('confirm-modal'); loadIssues(); }
    else if (type === 'team-issue') { await api.del(`/api/team-issues/${id}`); closeModal('confirm-modal'); loadTeamIssues(); }
    else if (type === 'agenda')  { await api.del(`/api/agendas/${id}`);  closeModal('confirm-modal'); loadAgendas(); }
    else if (type === 'meeting') { await api.del(`/api/meetings/${id}`); closeModal('confirm-modal'); loadMeetings(); }
  } catch (e) { alert(e.message); }
  state.pendingDelete = null;
});

/* ════════════════════════════════════════════════════════════════════
   TEAM ISSUES (IDS-style discussion items; distinct from To-Dos)
   ════════════════════════════════════════════════════════════════════ */

async function loadTeamIssues() {
  state.teamIssues = await api.get('/api/team-issues?include_archived=1');
  renderTeamIssues();
}

function rankBadge(rank) {
  if (rank == null) return '<span class="rank-badge empty">—</span>';
  return `<span class="rank-badge">${rank}</span>`;
}

function rankChipSelector(issueId, currentRank) {
  return `<div class="rank-chip-selector" data-issue-id="${issueId}">
    ${[1,2,3].map(r => `<button type="button" class="rank-chip ${currentRank === r ? 'active' : ''}" data-rank="${r}" title="Rank ${r}">${r}</button>`).join('')}
  </div>`;
}

function buildTeamIssueCard(issue) {
  const isArchived = !!issue.archived;
  const card = document.createElement('div');
  card.className = `issue-card ${isArchived ? 'archived' : ''}`;
  if (!isArchived) {
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => openTeamIssueModal(issue.id));
  }

  const showRankChips = !isArchived && issue.horizon === 'short_term';
  const rankIndicator = issue.horizon === 'short_term' ? rankBadge(issue.top_rank) : '';

  card.innerHTML = `
    <div class="issue-card-top">
      ${rankIndicator ? `<div style="margin-right:8px;flex-shrink:0">${rankIndicator}</div>` : ''}
      <div class="issue-title">${esc(issue.title)}</div>
    </div>
    ${issue.description ? `<div class="issue-desc">${esc(issue.description)}</div>` : ''}
    <div class="issue-card-meta-row">
      ${issue.owner_name ? `<span class="issue-owner-chip"></span>` : ''}
    </div>
    <div class="issue-card-bottom">
      <div class="issue-meta"></div>
      <div class="issue-actions">
        ${showRankChips ? rankChipSelector(issue.id, issue.top_rank) : ''}
        ${!isArchived ? `<button class="icon-btn solve-team-issue-btn" data-id="${issue.id}" title="Mark as Solved">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        </button>` : ''}
      </div>
    </div>
  `;

  if (issue.owner_name) {
    const chip = card.querySelector('.issue-owner-chip');
    if (chip) {
      chip.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:12px;color:var(--text2)';
      chip.prepend(avatar(issue.owner_name, issue.owner_picture, issue.owner_color, 18));
      chip.append(document.createTextNode(issue.owner_name));
    }
  }

  return card;
}

function buildTeamIssueRow(issue) {
  const isArchived = !!issue.archived;
  const row = document.createElement('div');
  row.className = `table-row team-issue-row ${isArchived ? 'archived' : ''}`;
  if (!isArchived) {
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => openTeamIssueModal(issue.id));
  }

  const rankCell = issue.horizon === 'short_term' && !isArchived
    ? rankChipSelector(issue.id, issue.top_rank)
    : (issue.horizon === 'short_term' ? rankBadge(issue.top_rank) : '<span style="color:var(--text2)">—</span>');

  row.innerHTML = `
    <div>${rankCell}</div>
    <div class="issue-row-title">${esc(issue.title)}</div>
    <div class="issue-row-owner"></div>
    <div class="row-actions">
      ${!isArchived ? `<button class="icon-btn solve-team-issue-btn" data-id="${issue.id}" title="Mark as Solved">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      </button>` : ''}
    </div>
  `;

  const ownerCell = row.querySelector('.issue-row-owner');
  if (issue.owner_name) {
    ownerCell.appendChild(avatar(issue.owner_name, issue.owner_picture, issue.owner_color, 22));
    ownerCell.appendChild(document.createTextNode(issue.owner_name));
  } else {
    ownerCell.innerHTML = '<span style="color:var(--text2);font-size:13px">Unassigned</span>';
  }

  return row;
}

function renderTeamIssueOwnerFilter() {
  const panel = qs('#team-issue-owner-filter-panel');
  const selected = new Set(state.teamIssueOwnerFilter.map(Number));
  panel.innerHTML =
    state.users.map(u => `
      <label class="owner-multiselect-option">
        <input type="checkbox" data-user-id="${u.id}" ${selected.has(u.id) ? 'checked' : ''}/>
        <span>${esc(u.name)}</span>
      </label>
    `).join('') +
    `<div class="owner-multiselect-divider"></div>
     <button type="button" class="owner-multiselect-clear" id="team-issue-owner-filter-clear">Clear selection</button>`;
  updateTeamIssueOwnerFilterLabel();
}

function updateTeamIssueOwnerFilterLabel() {
  const labelEl = qs('#team-issue-owner-filter-label');
  const ids = state.teamIssueOwnerFilter.map(Number);
  if (ids.length === 0) { labelEl.textContent = 'All Owners'; return; }
  if (ids.length === 1) {
    const u = state.users.find(x => x.id === ids[0]);
    labelEl.textContent = u ? u.name : '1 owner';
    return;
  }
  if (ids.length === 2) {
    const names = ids.map(id => state.users.find(x => x.id === id)?.name).filter(Boolean);
    labelEl.textContent = names.join(', ');
    return;
  }
  labelEl.textContent = `${ids.length} owners`;
}

function renderTeamIssues() {
  const grid = qs('#team-issues-list');
  const tableEl = qs('#team-issues-table');
  const tableBody = qs('#team-issues-table-body');
  const empty = qs('#team-issues-empty');
  const listMode = state.teamIssueViewMode === 'list';
  const container = listMode ? tableBody : grid;
  const buildFn   = listMode ? buildTeamIssueRow : buildTeamIssueCard;
  grid.innerHTML = '';
  tableBody.innerHTML = '';
  grid.hidden = listMode;
  tableEl.hidden = !listMode;

  // Scope by horizon tab; hide solved + archived (the only "done" signal now
  // that issues don't expose a status concept in the UI).
  const inScope = state.teamIssues.filter(t =>
    t.horizon === state.teamIssueHorizonFilter && !t.archived && t.status !== 'solved'
  );

  // Owner filter (multi-select)
  const ownerIds = state.teamIssueOwnerFilter.map(Number);
  const filtered = ownerIds.length
    ? inScope.filter(t => ownerIds.includes(t.owner_id))
    : inScope;

  if (filtered.length === 0) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  filtered.forEach(t => container.appendChild(buildFn(t)));

  // Event wiring (scoped to current container). Solve = soft-remove from view
  // (we still write status='solved' server-side so the row drops out of the list).
  container.querySelectorAll('.solve-team-issue-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api.put(`/api/team-issues/${btn.dataset.id}`, { status: 'solved' });
      loadTeamIssues();
    });
  });
  container.querySelectorAll('.rank-chip').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const sel = btn.closest('.rank-chip-selector');
      if (!sel) return;
      const issueId = sel.dataset.issueId;
      const wantRank = +btn.dataset.rank;
      // Toggle: clicking an already-active rank clears it
      const newRank = btn.classList.contains('active') ? null : wantRank;
      await api.put(`/api/team-issues/${issueId}/rank`, { rank: newRank });
      loadTeamIssues();
    });
  });
}

/* ── Modal ────────────────────────────────────────────────────────── */
qs('#add-team-issue-btn').addEventListener('click', () => openTeamIssueModal(null));

function openTeamIssueModal(editId) {
  const issue = editId ? state.teamIssues.find(t => t.id === editId) : null;
  qs('#team-issue-modal-title').textContent = issue ? 'Edit Issue' : 'Add Issue';
  qs('#team-issue-id').value = issue ? issue.id : '';
  qs('#team-issue-title').value = issue ? issue.title : '';
  qs('#team-issue-description').value = issue ? (issue.description || '') : '';
  qs('#team-issue-horizon').value = issue ? issue.horizon : state.teamIssueHorizonFilter;

  const ownerSel = qs('#team-issue-owner');
  ownerSel.innerHTML = '<option value="">Unassigned</option>' +
    state.users.map(u => `<option value="${u.id}" ${issue && issue.owner_id === u.id ? 'selected' : ''}>${u.name}</option>`).join('');
  if (!issue) ownerSel.value = state.currentUser ? state.currentUser.id : '';

  openModal('team-issue-modal');
  qs('#team-issue-title').focus();
}

qs('#save-team-issue-btn').addEventListener('click', async () => {
  const id = qs('#team-issue-id').value;
  const body = {
    title: qs('#team-issue-title').value.trim(),
    description: qs('#team-issue-description').value.trim(),
    owner_id: qs('#team-issue-owner').value || null,
    horizon: qs('#team-issue-horizon').value,
  };
  if (!body.title) { qs('#team-issue-title').focus(); return; }
  try {
    if (id) {
      await api.put(`/api/team-issues/${id}`, body);
    } else {
      await api.post('/api/team-issues', body);
    }
    closeModal('team-issue-modal');
    loadTeamIssues();
  } catch (e) { alert(e.message); }
});

/* ── Horizon tabs (Short Term / Long Term) ────────────────────────── */
qsa('#team-issue-horizon-tabs .filter-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    qsa('#team-issue-horizon-tabs .filter-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.teamIssueHorizonFilter = tab.dataset.horizon;
    renderTeamIssues();
  });
});

/* ── Owner multiselect ────────────────────────────────────────────── */
qs('#team-issue-owner-filter-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const panel = qs('#team-issue-owner-filter-panel');
  panel.hidden = !panel.hidden;
});
qs('#team-issue-owner-filter-panel').addEventListener('click', (e) => {
  e.stopPropagation();
  if (e.target.matches('input[type=checkbox][data-user-id]')) {
    const id = +e.target.dataset.userId;
    const idx = state.teamIssueOwnerFilter.indexOf(id);
    if (e.target.checked && idx < 0) state.teamIssueOwnerFilter.push(id);
    if (!e.target.checked && idx >= 0) state.teamIssueOwnerFilter.splice(idx, 1);
    updateTeamIssueOwnerFilterLabel();
    renderTeamIssues();
  } else if (e.target.id === 'team-issue-owner-filter-clear') {
    state.teamIssueOwnerFilter = [];
    renderTeamIssueOwnerFilter();
    renderTeamIssues();
  }
});
document.addEventListener('click', (e) => {
  const root = qs('#team-issue-owner-filter');
  if (!root.contains(e.target)) qs('#team-issue-owner-filter-panel').hidden = true;
});

/* ── View-mode toggle (persisted) ─────────────────────────────────── */
const TEAM_ISSUE_VIEW_MODE_KEY = 'ninety.teamIssueViewMode';
{
  const saved = localStorage.getItem(TEAM_ISSUE_VIEW_MODE_KEY);
  if (saved === 'cards' || saved === 'list') {
    state.teamIssueViewMode = saved;
    qsa('#team-issue-view-toggle .view-mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === saved);
    });
  }
}
qsa('#team-issue-view-toggle .view-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    qsa('#team-issue-view-toggle .view-mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.teamIssueViewMode = btn.dataset.mode;
    try { localStorage.setItem(TEAM_ISSUE_VIEW_MODE_KEY, btn.dataset.mode); } catch {}
    renderTeamIssues();
  });
});

/* ════════════════════════════════════════════════════════════════════
   MEETINGS
   ════════════════════════════════════════════════════════════════════ */

/* ── Sub-tab switching ───────────────────────────────────────────── */
qsa('#meetings-subtabs .filter-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    qsa('#meetings-subtabs .filter-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.meetingsSubTab = tab.dataset.mtab;
    qsa('.meetings-panel').forEach(p => p.classList.add('hidden'));
    qs(`#meetings-panel-${state.meetingsSubTab}`).classList.remove('hidden');
  });
});

/* ── Load all meetings data ──────────────────────────────────────── */
async function loadMeetings() {
  [state.agendas, state.meetings] = await Promise.all([
    api.get('/api/agendas'),
    api.get('/api/meetings'),
  ]);
  renderMeetingsUpcoming();
  renderMeetingsPast();
  renderAgendasList();
  populateAgendaSelects();
}

async function loadAgendas() {
  state.agendas = await api.get('/api/agendas');
  renderAgendasList();
  populateAgendaSelects();
}

function populateAgendaSelects() {
  [qs('#pick-agenda-select'), qs('#schedule-agenda-select')].forEach(sel => {
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = state.agendas.length
      ? state.agendas.map(a => `<option value="${a.id}">${esc(a.title)}</option>`).join('')
      : '<option value="">No agendas yet</option>';
    sel.value = cur;
  });
}

/* Fill an .attendee-picker container with one row per user. selectedIds is
   a Set of numeric user ids that start checked. Returns the element for chaining. */
function renderAttendeePicker(pickerEl, selectedIds = new Set()) {
  if (!pickerEl) return;
  pickerEl.innerHTML = '';
  state.users.forEach(u => {
    const label = document.createElement('label');
    label.className = 'attendee-option';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = String(u.id);
    if (selectedIds.has(u.id)) cb.checked = true;
    label.appendChild(cb);
    label.appendChild(avatar(u.name, u.picture, u.color, 22));
    const nameSpan = document.createElement('span');
    nameSpan.textContent = u.name;
    label.appendChild(nameSpan);
    pickerEl.appendChild(label);
  });
}

function collectAttendees(pickerEl) {
  return Array.from(pickerEl.querySelectorAll('input[type=checkbox]'))
    .filter(cb => cb.checked)
    .map(cb => +cb.value);
}

/* ── Live-now banner (attendees of an in-progress meeting) ────────── */
function renderLiveNowBanner() {
  const banner = qs('#meetings-live-banner');
  if (!banner) return;
  const me = state.currentUser?.id;
  const liveForMe = state.meetings.filter(m =>
    m.status === 'in_progress'
    && Array.isArray(m.attendees)
    && me && m.attendees.some(a => a.id === me)
  );
  if (liveForMe.length === 0) { banner.hidden = true; banner.innerHTML = ''; return; }
  banner.hidden = false;
  banner.innerHTML = liveForMe.map(m => {
    const agenda = state.agendas.find(a => a.id === m.agenda_id);
    const title = agenda ? agenda.title : m.title;
    return `
      <div class="meetings-live-card">
        <div class="meetings-live-pulse"></div>
        <div class="meetings-live-text">
          <div class="meetings-live-label">Live now</div>
          <div class="meetings-live-title">${esc(title)}</div>
        </div>
        <button class="btn btn-primary live-join-btn" data-id="${m.id}" data-agenda="${m.agenda_id}" data-title="${esc(title)}">Join</button>
      </div>
    `;
  }).join('');
  banner.querySelectorAll('.live-join-btn').forEach(btn => {
    btn.addEventListener('click', () => startRunner(+btn.dataset.agenda, btn.dataset.title, +btn.dataset.id));
  });
}

/* ── Upcoming meetings ───────────────────────────────────────────── */
function renderMeetingsUpcoming() {
  renderLiveNowBanner();
  const list = qs('#meetings-upcoming-list');
  const empty = qs('#meetings-upcoming-empty');
  const upcoming = state.meetings.filter(m => m.status === 'upcoming');
  list.innerHTML = '';
  if (upcoming.length === 0) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<div class="table-header" style="grid-template-columns:1fr 180px 180px 160px">
    <span class="th">Meeting</span><span class="th">Attendees</span><span class="th">Scheduled</span><span class="th"></span>
  </div>`;
  const body = document.createElement('div');
  upcoming.forEach(m => {
    const row = document.createElement('div');
    row.className = 'table-row';
    row.style.gridTemplateColumns = '1fr 180px 180px 160px';
    const agenda = state.agendas.find(a => a.id === m.agenda_id);
    const displayTitle = agenda ? agenda.title : m.title;
    const when = m.scheduled_at ? new Date(m.scheduled_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : 'Unscheduled';
    row.innerHTML = `
      <div class="rock-title-cell"><div class="rock-title">${esc(displayTitle)}</div></div>
      <div class="attendee-strip-cell"></div>
      <div style="color:var(--text2);font-size:13px">${when}</div>
      <div class="row-actions" style="opacity:1;gap:6px">
        <button class="btn btn-primary btn-sm start-scheduled-btn" data-id="${m.id}" data-agenda="${m.agenda_id}" data-title="${esc(displayTitle)}" style="font-size:12px;padding:4px 10px">Start</button>
        <button class="icon-btn edit-attendees-btn" data-id="${m.id}" title="Edit attendees">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/></svg>
        </button>
        <button class="icon-btn danger delete-meeting-btn" data-id="${m.id}" data-title="${esc(displayTitle)}" title="Delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </div>`;
    // Attendee avatar strip
    const stripCell = row.querySelector('.attendee-strip-cell');
    if (m.attendees && m.attendees.length) {
      const strip = document.createElement('div');
      strip.className = 'attendee-strip';
      m.attendees.slice(0, 5).forEach(a => strip.appendChild(avatar(a.name, a.picture, a.color, 22)));
      if (m.attendees.length > 5) {
        const more = document.createElement('span');
        more.style.cssText = 'font-size:12px;color:var(--text2);margin-left:4px';
        more.textContent = `+${m.attendees.length - 5}`;
        strip.appendChild(more);
      }
      stripCell.appendChild(strip);
    } else {
      stripCell.innerHTML = '<span class="attendee-strip-empty">No attendees</span>';
    }
    body.appendChild(row);
  });
  card.appendChild(body);
  list.appendChild(card);
  qsa('.start-scheduled-btn').forEach(btn => {
    btn.addEventListener('click', () => startRunner(+btn.dataset.agenda, btn.dataset.title, +btn.dataset.id));
  });
  qsa('.edit-attendees-btn').forEach(btn => {
    btn.addEventListener('click', () => openEditAttendeesModal(+btn.dataset.id));
  });
  qsa('.delete-meeting-btn').forEach(btn => {
    btn.addEventListener('click', () => confirmDelete('meeting', btn.dataset.id, btn.dataset.title));
  });
}

function openEditAttendeesModal(meetingId) {
  const m = state.meetings.find(x => x.id === meetingId);
  if (!m) return;
  qs('#edit-attendees-meeting-id').value = meetingId;
  const seed = new Set((m.attendees || []).map(a => a.id));
  renderAttendeePicker(qs('#edit-attendees-picker'), seed);
  openModal('edit-attendees-modal');
}

qs('#save-attendees-btn').addEventListener('click', async () => {
  const meetingId = +qs('#edit-attendees-meeting-id').value;
  if (!meetingId) return;
  const userIds = collectAttendees(qs('#edit-attendees-picker'));
  try {
    await api.put(`/api/meetings/${meetingId}/attendees`, { userIds });
    closeModal('edit-attendees-modal');
    loadMeetings();
  } catch (e) { alert(e.message); }
});

/* ── Schedule a meeting ──────────────────────────────────────────── */
qs('#start-meeting-btn').addEventListener('click', () => {
  populateAgendaSelects();
  // Default to the current user selected
  const seed = new Set(state.currentUser ? [state.currentUser.id] : []);
  renderAttendeePicker(qs('#pick-attendees'), seed);
  openModal('pick-agenda-modal');
});
qs('#confirm-start-meeting-btn').addEventListener('click', async () => {
  const agendaId = +qs('#pick-agenda-select').value;
  const agenda = state.agendas.find(a => a.id === agendaId);
  if (!agenda) return;
  const attendeeIds = collectAttendees(qs('#pick-attendees'));
  closeModal('pick-agenda-modal');
  await startRunner(agendaId, agenda.title, null, attendeeIds);
});

const schedBtn = qs('#schedule-meeting-btn-empty');
if (schedBtn) schedBtn.addEventListener('click', () => {
  populateAgendaSelects();
  const seed = new Set(state.currentUser ? [state.currentUser.id] : []);
  renderAttendeePicker(qs('#schedule-attendees'), seed);
  openModal('schedule-meeting-modal');
});

qs('#confirm-schedule-btn').addEventListener('click', async () => {
  const agendaId = +qs('#schedule-agenda-select').value;
  const agenda = state.agendas.find(a => a.id === agendaId);
  const dt = qs('#schedule-datetime').value;
  if (!agenda) return;
  const attendee_ids = collectAttendees(qs('#schedule-attendees'));
  await api.post('/api/meetings', {
    agenda_id: agendaId,
    title: agenda.title,
    scheduled_at: dt ? new Date(dt).toISOString() : null,
    status: 'upcoming',
    attendee_ids,
  });
  closeModal('schedule-meeting-modal');
  loadMeetings();
});

/* ── Past meetings ───────────────────────────────────────────────── */
function renderMeetingsPast() {
  const list = qs('#meetings-past-list');
  const empty = qs('#meetings-past-empty');
  const past = state.meetings.filter(m => m.status === 'completed');
  list.innerHTML = '';
  if (past.length === 0) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<div class="table-header" style="grid-template-columns:1fr 180px 100px 48px">
    <span class="th">Meeting</span><span class="th">Date</span><span class="th">Duration</span><span class="th"></span>
  </div>`;
  const body = document.createElement('div');
  past.forEach(m => {
    const row = document.createElement('div');
    row.className = 'table-row';
    row.style.gridTemplateColumns = '1fr 180px 100px 48px';
    const pastAgenda = state.agendas.find(a => a.id === m.agenda_id);
    const pastTitle = pastAgenda ? pastAgenda.title : m.title;
    const when = m.started_at ? new Date(m.started_at).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}) : '—';
    let dur = '—';
    if (m.started_at && m.ended_at) {
      const secs = Math.round((new Date(m.ended_at) - new Date(m.started_at)) / 1000);
      dur = secs >= 3600 ? `${Math.floor(secs/3600)}h ${Math.floor((secs%3600)/60)}m` : `${Math.floor(secs/60)}m`;
    }
    row.innerHTML = `
      <div class="rock-title">${esc(pastTitle)}</div>
      <div style="color:var(--text2);font-size:13px">${when}</div>
      <div style="color:var(--text2);font-size:13px">${dur}</div>
      <div class="row-actions" style="opacity:1">
        <button class="icon-btn danger delete-meeting-btn" data-id="${m.id}" data-title="${esc(pastTitle)}" title="Delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </div>`;
    body.appendChild(row);
  });
  card.appendChild(body);
  list.appendChild(card);
  qsa('.delete-meeting-btn').forEach(btn => {
    btn.addEventListener('click', () => confirmDelete('meeting', btn.dataset.id, btn.dataset.title));
  });
}

/* ── Agendas list ────────────────────────────────────────────────── */
function renderAgendasList() {
  const list = qs('#agendas-list');
  const empty = qs('#agendas-empty');
  const table = qs('#agendas-table');
  list.innerHTML = '';
  if (state.agendas.length === 0) {
    table.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }
  table.classList.remove('hidden');
  empty.classList.add('hidden');
  state.agendas.forEach(a => {
    const row = document.createElement('div');
    row.className = 'table-row';
    row.style.gridTemplateColumns = '1fr 120px 80px';
    // Compute total time from sections if we have them cached
    row.innerHTML = `
      <div class="rock-title" style="cursor:pointer">${esc(a.title)}</div>
      <div style="color:var(--text2);font-size:13px" class="agenda-total-cell" data-id="${a.id}">— min</div>
      <div class="row-actions" style="opacity:1">
        <button class="icon-btn edit-agenda-btn" data-id="${a.id}" title="Edit agenda">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="icon-btn danger delete-agenda-btn" data-id="${a.id}" data-title="${esc(a.title)}" title="Delete agenda">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </div>`;
    row.querySelector('.rock-title').addEventListener('click', () => openAgendaEditor(a.id));
    list.appendChild(row);
    // Load section totals async
    api.get(`/api/agendas/${a.id}/sections`).then(sections => {
      const total = sections.reduce((s, sec) => s + sec.duration_minutes, 0);
      const cell = list.querySelector(`.agenda-total-cell[data-id="${a.id}"]`);
      if (cell) cell.textContent = total >= 60 ? `${Math.floor(total/60)}h ${total%60}m` : `${total} min`;
    }).catch(() => {});
  });
  qsa('.edit-agenda-btn').forEach(btn => btn.addEventListener('click', () => openAgendaEditor(+btn.dataset.id)));
  qsa('.delete-agenda-btn').forEach(btn => btn.addEventListener('click', () => confirmDelete('agenda', btn.dataset.id, btn.dataset.title)));
}

/* ── Create agenda ───────────────────────────────────────────────── */
qs('#create-agenda-btn').addEventListener('click', async () => {
  const a = await api.post('/api/agendas', { title: 'New Agenda' });
  state.agendas.unshift(a);
  openAgendaEditor(a.id);
});

/* ── Agenda editor ───────────────────────────────────────────────── */
async function openAgendaEditor(agendaId) {
  state.currentAgendaId = agendaId;
  const agenda = state.agendas.find(a => a.id === agendaId);
  qs('#agenda-title-input').value = agenda ? agenda.title : '';
  qs('#agendas-list-view').classList.add('hidden');
  qs('#agenda-editor').classList.remove('hidden');
  state.currentAgendaSections = await api.get(`/api/agendas/${agendaId}/sections`);
  renderAgendaSections();
}

function renderAgendaSections() {
  const list = qs('#agenda-sections-list');
  list.innerHTML = '';
  const total = state.currentAgendaSections.reduce((s, sec) => s + (sec.duration_minutes || 0), 0);
  qs('#agenda-total-time').textContent = `Total: ${total >= 60 ? Math.floor(total/60)+'h '+total%60+'m' : total+' min'}`;

  state.currentAgendaSections.forEach((sec, idx) => {
    const row = document.createElement('div');
    row.className = 'table-row agenda-section-row';
    row.style.gridTemplateColumns = '32px 1fr 160px 80px 90px 90px 48px';
    row.dataset.id = sec.id;
    row.innerHTML = `
      <div style="color:var(--text2);font-size:12px;text-align:center">${idx+1}</div>
      <div><input type="text" class="section-name-input" value="${esc(sec.name)}" placeholder="Section name" style="background:transparent;border:none;border-bottom:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:14px;width:100%;padding:2px 4px;outline:none" /></div>
      <div><input type="number" class="section-dur-input" value="${sec.duration_minutes}" min="1" max="180" style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--font);font-size:13px;padding:4px 8px;width:80px;outline:none" /></div>
      <div style="display:flex;align-items:center">
        <label class="toggle-switch">
          <input type="checkbox" class="section-visible-input" ${sec.visible ? 'checked' : ''} />
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div style="display:flex;align-items:center">
        <label class="toggle-switch" title="Display team issues during this section">
          <input type="checkbox" class="section-shows-issues-input" ${sec.shows_issues ? 'checked' : ''} />
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div style="display:flex;align-items:center">
        <label class="toggle-switch" title="Display attendee to-dos during this section">
          <input type="checkbox" class="section-shows-todos-input" ${sec.shows_todos ? 'checked' : ''} />
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div>
        <button class="icon-btn danger delete-section-btn" data-id="${sec.id}" title="Remove">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`;
    // Debounced save on field change
    const save = async () => {
      const name = row.querySelector('.section-name-input').value.trim();
      const dur  = +row.querySelector('.section-dur-input').value || 5;
      const vis  = row.querySelector('.section-visible-input').checked;
      const showsIssues = row.querySelector('.section-shows-issues-input').checked;
      const showsTodos  = row.querySelector('.section-shows-todos-input').checked;
      if (!name) return;
      await api.put(`/api/agenda-sections/${sec.id}`, { name, duration_minutes: dur, visible: vis, shows_issues: showsIssues, shows_todos: showsTodos });
      const s = state.currentAgendaSections.find(s => s.id === sec.id);
      if (s) { s.name = name; s.duration_minutes = dur; s.visible = vis; s.shows_issues = showsIssues; s.shows_todos = showsTodos; }
      const total2 = state.currentAgendaSections.reduce((s,x) => s + (x.duration_minutes||0), 0);
      qs('#agenda-total-time').textContent = `Total: ${total2 >= 60 ? Math.floor(total2/60)+'h '+total2%60+'m' : total2+' min'}`;
    };
    row.querySelector('.section-name-input').addEventListener('blur', save);
    row.querySelector('.section-dur-input').addEventListener('change', save);
    row.querySelector('.section-visible-input').addEventListener('change', save);
    row.querySelector('.section-shows-issues-input').addEventListener('change', save);
    row.querySelector('.section-shows-todos-input').addEventListener('change', save);
    row.querySelector('.delete-section-btn').addEventListener('click', async () => {
      await api.del(`/api/agenda-sections/${sec.id}`);
      state.currentAgendaSections = state.currentAgendaSections.filter(s => s.id !== sec.id);
      renderAgendaSections();
    });
    list.appendChild(row);
  });
}

qs('#add-section-btn').addEventListener('click', async () => {
  const sort = state.currentAgendaSections.length;
  const sec = await api.post(`/api/agendas/${state.currentAgendaId}/sections`, {
    name: 'New Section', duration_minutes: 5, visible: true, sort_order: sort,
  });
  state.currentAgendaSections.push(sec);
  renderAgendaSections();
  // Focus the new name input
  const inputs = qsa('#agenda-sections-list .section-name-input');
  if (inputs.length) inputs[inputs.length - 1].focus();
});

qs('#save-agenda-btn').addEventListener('click', async () => {
  const title = qs('#agenda-title-input').value.trim() || 'Untitled Agenda';
  await api.put(`/api/agendas/${state.currentAgendaId}`, { title });
  const a = state.agendas.find(a => a.id === state.currentAgendaId);
  if (a) a.title = title;
  backToAgendasList();
});

qs('#agenda-back-btn').addEventListener('click', backToAgendasList);

function backToAgendasList() {
  state.currentAgendaId = null;
  qs('#agenda-editor').classList.add('hidden');
  qs('#agendas-list-view').classList.remove('hidden');
  loadAgendas();
}

/* ════════════════════════════════════════════════════════════════════
   MEETING RUNNER
   ════════════════════════════════════════════════════════════════════ */
function fmtTime(secs) {
  const s = Math.abs(Math.round(secs));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return (secs < 0 ? '-' : '') + String(m).padStart(2,'0') + ':' + String(ss).padStart(2,'0');
}

async function startRunner(agendaId, title, existingMeetingId, attendeeIds) {
  const sections = await api.get(`/api/agendas/${agendaId}/sections`);
  const visible = sections.filter(s => s.visible);
  if (visible.length === 0) { alert('This agenda has no visible sections.'); return; }

  // Create or update meeting record
  let meetingId = existingMeetingId;
  if (!meetingId) {
    const m = await api.post('/api/meetings', {
      agenda_id: agendaId, title, sections_snapshot: visible,
      attendee_ids: Array.isArray(attendeeIds) ? attendeeIds : [],
    });
    meetingId = m.id;
  }
  await api.put(`/api/meetings/${meetingId}`, { status: 'in_progress', started_at: new Date().toISOString() });

  const r = state.runner;
  r.active = true;
  r.meetingId = meetingId;
  r.title = title;
  r.sections = visible;
  r.sectionIdx = 0;
  r.sectionElapsed = 0;
  r.totalElapsed = 0;
  r.playing = true;
  // Capture attendees on the active meeting so the to-dos panel can filter.
  // For ad-hoc starts we synthesize from the just-picked ids; for
  // scheduled-meeting starts we rely on the record loaded in state.meetings.
  const liveMeeting = state.meetings.find(m => m.id === meetingId);
  if (liveMeeting?.attendees?.length) {
    r.attendees = liveMeeting.attendees;
  } else if (Array.isArray(attendeeIds) && attendeeIds.length) {
    r.attendees = attendeeIds
      .map(id => state.users.find(u => u.id === id))
      .filter(Boolean)
      .map(u => ({ id: u.id, name: u.name, color: u.color, picture: u.picture ?? null }));
  } else {
    r.attendees = [];
  }

  qs('#runner-title').textContent = title;
  qs('#meeting-runner').classList.remove('hidden');
  renderRunnerSidebar();
  updateRunnerDisplay();

  // Start interval
  if (r.interval) clearInterval(r.interval);
  r.interval = setInterval(() => {
    if (!r.playing) return;
    r.sectionElapsed++;
    r.totalElapsed++;
    updateRunnerDisplay();
  }, 1000);
}

function renderRunnerSidebar() {
  const r = state.runner;
  const el = qs('#runner-agenda-items');
  el.innerHTML = '';
  r.sections.forEach((sec, idx) => {
    const item = document.createElement('div');
    item.className = `runner-agenda-item${idx === r.sectionIdx ? ' active' : ''}${idx < r.sectionIdx ? ' done' : ''}`;
    item.innerHTML = `
      <span class="runner-item-num">${idx+1}</span>
      <span class="runner-item-name">${esc(sec.name)}</span>
      <span class="runner-item-time">${sec.duration_minutes} MIN</span>`;
    item.addEventListener('click', () => {
      r.sectionIdx = idx;
      r.sectionElapsed = 0;
      renderRunnerSidebar();
      updateRunnerDisplay();
    });
    el.appendChild(item);
  });
}

function updateRunnerDisplay() {
  const r = state.runner;
  const sec = r.sections[r.sectionIdx];
  const allocated = sec.duration_minutes * 60;
  const remaining = allocated - r.sectionElapsed;

  qs('#runner-total-elapsed').textContent = fmtTime(r.totalElapsed);
  qs('#runner-section-remaining').textContent = fmtTime(remaining);
  qs('#runner-section-remaining').style.color = remaining < 0 ? 'var(--red)' : remaining < 60 ? 'var(--yellow)' : '';
  qs('#runner-section-alloc').textContent = `/ ${sec.duration_minutes} min`;
  qs('#runner-section-name').textContent = sec.name;
  qs('#runner-section-number').textContent = `${r.sectionIdx + 1} / ${r.sections.length}`;

  // Progress bar
  const pct = Math.min(100, (r.sectionElapsed / allocated) * 100);
  qs('#runner-progress-fill').style.width = pct + '%';
  qs('#runner-progress-fill').style.background = remaining < 0 ? 'var(--red)' : 'var(--accent)';

  // Play/pause icons
  qs('#runner-play-icon').classList.toggle('hidden', r.playing);
  qs('#runner-pause-icon').classList.toggle('hidden', !r.playing);

  // Team-issues panel: only for sections flagged shows_issues
  renderRunnerIssuesPanel(sec);
  // To-dos panel: only for sections flagged shows_todos
  renderRunnerTodosPanel(sec);
}

function renderRunnerIssuesPanel(sec) {
  const panel = qs('#runner-issues-panel');
  const list  = qs('#runner-issues-list');
  if (!sec || !sec.shows_issues) { panel.hidden = true; return; }
  panel.hidden = false;

  // Short-term, non-archived, unsolved; sort by rank asc NULLS last, then created_at desc.
  const items = (state.teamIssues || [])
    .filter(t => t.horizon === 'short_term' && !t.archived && t.status !== 'solved')
    .sort((a, b) => (a.top_rank ?? 99) - (b.top_rank ?? 99) || b.created_at.localeCompare(a.created_at));

  if (items.length === 0) {
    list.innerHTML = '<div style="color:var(--text2);font-size:13px;padding:8px 2px">No short-term issues yet.</div>';
    return;
  }

  list.innerHTML = '';
  items.forEach(t => {
    const row = document.createElement('div');
    row.className = `runner-issue-row ${t.status === 'solved' ? 'solved' : ''}`;
    row.innerHTML = `
      <div>${rankBadge(t.top_rank)}</div>
      <div class="runner-issue-title">${esc(t.title)}</div>
      <div class="runner-issue-owner"></div>
      <div style="display:flex;align-items:center;gap:6px">
        ${rankChipSelector(t.id, t.top_rank)}
        <button class="icon-btn runner-solve-team-issue-btn" data-id="${t.id}" title="Mark as Solved">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
      </div>
    `;
    const ownerCell = row.querySelector('.runner-issue-owner');
    if (t.owner_name) {
      ownerCell.appendChild(avatar(t.owner_name, t.owner_picture, t.owner_color, 22));
    }
    list.appendChild(row);
  });

  // Wire rank chips
  list.querySelectorAll('.rank-chip').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const sel = btn.closest('.rank-chip-selector');
      if (!sel) return;
      const issueId = sel.dataset.issueId;
      const wantRank = +btn.dataset.rank;
      const newRank = btn.classList.contains('active') ? null : wantRank;
      await api.put(`/api/team-issues/${issueId}/rank`, { rank: newRank });
      await loadTeamIssues();
      updateRunnerDisplay();
    });
  });
  // Wire solve buttons
  list.querySelectorAll('.runner-solve-team-issue-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api.put(`/api/team-issues/${btn.dataset.id}`, { status: 'solved' });
      await loadTeamIssues();
      updateRunnerDisplay();
    });
  });
}

function renderRunnerTodosPanel(sec) {
  const panel = qs('#runner-todos-panel');
  const list  = qs('#runner-todos-list');
  if (!sec || !sec.shows_todos) { panel.hidden = true; return; }
  panel.hidden = false;

  const attendeeIds = new Set((state.runner.attendees || []).map(a => a.id));
  // Flat list of every attendee's open (non-solved, non-archived) to-dos, sorted by owner name.
  const items = (state.issues || [])
    .filter(i => attendeeIds.has(i.owner_id) && !i.archived && i.status !== 'solved')
    .sort((a, b) => (a.owner_name || '').localeCompare(b.owner_name || '') || b.created_at.localeCompare(a.created_at));

  if (attendeeIds.size === 0) {
    list.innerHTML = '<div style="color:var(--text2);font-size:13px;padding:8px 2px">No attendees on this meeting.</div>';
    return;
  }
  if (items.length === 0) {
    list.innerHTML = '<div style="color:var(--text2);font-size:13px;padding:8px 2px">No open to-dos for the attendees.</div>';
    return;
  }

  list.innerHTML = '';
  items.forEach(i => {
    const row = document.createElement('div');
    row.className = 'runner-issue-row';
    row.innerHTML = `
      <div></div>
      <div class="runner-issue-title">${esc(i.title)}</div>
      <div class="runner-issue-owner"></div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="badge badge-${i.status}">${issueStatusLabel(i.status)}</span>
        <button class="icon-btn runner-solve-todo-btn" data-id="${i.id}" title="Mark as Solved">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
      </div>
    `;
    const ownerCell = row.querySelector('.runner-issue-owner');
    if (i.owner_name) ownerCell.appendChild(avatar(i.owner_name, i.owner_picture, i.owner_color, 22));
    list.appendChild(row);
  });

  list.querySelectorAll('.runner-solve-todo-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api.put(`/api/issues/${btn.dataset.id}`, { status: 'solved' });
      await loadIssues();
      updateRunnerDisplay();
    });
  });
}

qs('#runner-playpause-btn').addEventListener('click', () => {
  state.runner.playing = !state.runner.playing;
  updateRunnerDisplay();
});

qs('#runner-prev-btn').addEventListener('click', () => {
  const r = state.runner;
  if (r.sectionIdx > 0) { r.sectionIdx--; r.sectionElapsed = 0; renderRunnerSidebar(); updateRunnerDisplay(); }
});

qs('#runner-next-btn').addEventListener('click', () => {
  const r = state.runner;
  if (r.sectionIdx < r.sections.length - 1) { r.sectionIdx++; r.sectionElapsed = 0; renderRunnerSidebar(); updateRunnerDisplay(); }
});

qs('#runner-finish-btn').addEventListener('click', async () => {
  const r = state.runner;
  if (r.interval) clearInterval(r.interval);
  r.playing = false;
  await api.put(`/api/meetings/${r.meetingId}`, { status: 'completed', ended_at: new Date().toISOString() });
  qs('#meeting-runner').classList.add('hidden');
  r.active = false;
  // Switch to past meetings tab
  qsa('#meetings-subtabs .filter-tab').forEach(t => t.classList.remove('active'));
  qs('#meetings-subtabs .filter-tab[data-mtab="past"]').classList.add('active');
  state.meetingsSubTab = 'past';
  qsa('.meetings-panel').forEach(p => p.classList.add('hidden'));
  qs('#meetings-panel-past').classList.remove('hidden');
  loadMeetings();
});

/* ── Keyboard shortcuts ──────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    qsa('.modal-overlay.active').forEach(m => {
      closeModal(m.id);
    });
  }
});

/* ── XSS protection ──────────────────────────────────────────────── */
function esc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ════════════════════════════════════════════════════════════════════
   MY 90
   ════════════════════════════════════════════════════════════════════ */

async function loadMy90() {
  const in90Str = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const uid = state.currentUser?.id;

  const [allRocks, allIssues, allMeetings, votes] = await Promise.all([
    api.get('/api/rocks?quarter=' + encodeURIComponent(currentQuarter())),
    api.get('/api/issues'),
    api.get('/api/meetings'),
    uid ? api.get(`/api/issues/votes/${uid}`) : Promise.resolve([]),
  ]);

  state.my90Rocks    = allRocks.filter(r => r.owner_id === uid);
  state.my90Issues   = allIssues.filter(i =>
    i.owner_id === uid && !i.archived && i.status !== 'solved'
  );
  state.my90Meetings = allMeetings.filter(m =>
    m.status === 'upcoming' && m.scheduled_at && m.scheduled_at.slice(0, 10) <= in90Str
  );
  state.my90Votes = votes;

  renderMy90();
}

function renderMy90() {
  const grid = qs('#my90-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const u = state.currentUser;
  if (u) {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    qs('#my90-subtitle').textContent = `${u.name.split(' ')[0]}'s workspace · ${today}`;
  }

  // Helper: navigate to another tab
  function goToView(view) {
    const btn = qs(`.nav-item[data-view="${view}"]`);
    if (btn) btn.click();
  }

  // ── Box 1: My Rocks ───────────────────────────────────────────────
  const rocksBox = document.createElement('div');
  rocksBox.className = 'card my90-box';

  const rockStatusLabel = { on_track: 'On Track', off_track: 'Off Track', done: 'Done', not_started: 'Not Started' };

  rocksBox.innerHTML = `
    <div class="my90-box-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="my90-box-icon">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
      </svg>
      <span class="my90-box-title">My Rocks</span>
      <span class="my90-box-quarter">${currentQuarter()}</span>
      <span class="my90-box-count">${state.my90Rocks.length}</span>
      <button class="btn btn-ghost my90-view-all" data-goto="rocks">View All</button>
    </div>
    <div class="my90-box-body" id="my90-rocks-body"></div>
  `;

  const rocksBody = rocksBox.querySelector('#my90-rocks-body');
  if (state.my90Rocks.length === 0) {
    rocksBody.innerHTML = `<div class="my90-empty">No rocks for ${currentQuarter()} — add one in the Rocks tab.</div>`;
  } else {
    state.my90Rocks.forEach(rock => {
      const pct = rock.progress || 0;
      const isDone = rock.status === 'done';
      const row = document.createElement('div');
      row.className = 'my90-row';
      row.innerHTML = `
        <div class="my90-row-title">${esc(rock.title)}</div>
        <div class="my90-mini-progress"><div class="my90-mini-progress-fill ${isDone ? 'done' : ''}" style="width:${pct}%"></div></div>
        <span class="my90-pct">${pct}%</span>
      `;
      const badgeEl = badge(rockStatusLabel[rock.status] || rock.status, rock.status);
      badgeEl.classList.add('my90-badge');
      row.appendChild(badgeEl);
      rocksBody.appendChild(row);
    });
  }

  rocksBox.querySelector('.my90-view-all').addEventListener('click', () => goToView('rocks'));
  grid.appendChild(rocksBox);

  // ── Box 2: My To-Dos ──────────────────────────────────────────────
  const todosBox = document.createElement('div');
  todosBox.className = 'card my90-box';

  const blockerCount  = state.my90Issues.filter(i => i.status === 'blocker').length;
  const overdueCount  = state.my90Issues.filter(i => {
    if (!i.due_date) return false;
    return i.due_date.slice(0, 10) < new Date().toISOString().slice(0, 10);
  }).length;

  todosBox.innerHTML = `
    <div class="my90-box-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="my90-box-icon">
        <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
      </svg>
      <span class="my90-box-title">My To-Dos</span>
      ${blockerCount  ? `<span class="my90-box-alert red">${blockerCount} blocker${blockerCount > 1 ? 's' : ''}</span>` : ''}
      ${overdueCount  ? `<span class="my90-box-alert yellow">${overdueCount} overdue</span>` : ''}
      <span class="my90-box-count">${state.my90Issues.length}</span>
      <button class="btn btn-ghost my90-view-all" data-goto="issues">View All</button>
    </div>
    <div class="my90-box-body" id="my90-todos-body"></div>
  `;

  const todosBody = todosBox.querySelector('#my90-todos-body');
  if (state.my90Issues.length === 0) {
    todosBody.innerHTML = `<div class="my90-empty">No open to-dos assigned to you.</div>`;
  } else {
    state.my90Issues.forEach(issue => {
      const due = formatDueDate(issue.due_date);
      const row = document.createElement('div');
      row.className = 'my90-row';
      row.innerHTML = `
        <div class="issue-priority-dot ${issue.priority}" style="flex-shrink:0"></div>
        <div class="my90-row-title">${esc(issue.title)}</div>
        ${due ? `<div class="due-date-chip due-${due.urgency}" style="flex-shrink:0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;flex-shrink:0">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
          </svg>${due.text}</div>` : ''}
      `;
      const badgeEl = badge(issueStatusLabel(issue.status), issue.status);
      badgeEl.classList.add('my90-badge');
      row.appendChild(badgeEl);
      todosBody.appendChild(row);
    });
  }

  todosBox.querySelector('.my90-view-all').addEventListener('click', () => goToView('issues'));
  grid.appendChild(todosBox);

  // ── Box 3: Upcoming Meetings ──────────────────────────────────────
  const meetingsBox = document.createElement('div');
  meetingsBox.className = 'card my90-box';

  meetingsBox.innerHTML = `
    <div class="my90-box-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="my90-box-icon">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
      <span class="my90-box-title">Upcoming Meetings</span>
      <span class="my90-box-count">${state.my90Meetings.length}</span>
      <button class="btn btn-ghost my90-view-all" data-goto="meetings">View All</button>
    </div>
    <div class="my90-box-body" id="my90-meetings-body"></div>
  `;

  const meetingsBody = meetingsBox.querySelector('#my90-meetings-body');
  if (state.my90Meetings.length === 0) {
    meetingsBody.innerHTML = `<div class="my90-empty">No upcoming meetings in the next 90 days.</div>`;
  } else {
    state.my90Meetings.forEach(m => {
      const row = document.createElement('div');
      row.className = 'my90-row';
      let dateStr = '';
      if (m.scheduled_at) {
        const d = new Date(m.scheduled_at);
        dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
          ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      }
      row.innerHTML = `
        <div class="my90-row-title">${esc(m.title)}</div>
        ${dateStr ? `<span class="my90-meeting-date">${dateStr}</span>` : '<span class="my90-meeting-date" style="color:var(--text2)">Unscheduled</span>'}
      `;
      meetingsBody.appendChild(row);
    });
  }

  meetingsBox.querySelector('.my90-view-all').addEventListener('click', () => goToView('meetings'));
  grid.appendChild(meetingsBox);
}

/* ════════════════════════════════════════════════════════════════════
   INSIGHTS
   ════════════════════════════════════════════════════════════════════ */

let insightsListenersWired = false;

function applyChartJsDefaults() {
  Chart.defaults.color = '#9494b0';
  Chart.defaults.borderColor = '#2e2e42';
  Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.plugins.legend.labels.boxWidth = 12;
  Chart.defaults.plugins.legend.labels.padding = 16;
  Chart.defaults.plugins.tooltip.backgroundColor = '#222230';
  Chart.defaults.plugins.tooltip.titleColor = '#e8e8f0';
  Chart.defaults.plugins.tooltip.bodyColor = '#9494b0';
  Chart.defaults.plugins.tooltip.borderColor = '#2e2e42';
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
}

function destroyChart(id) {
  if (state.insightCharts[id]) {
    state.insightCharts[id].destroy();
    delete state.insightCharts[id];
  }
}

function initInsightsListeners() {
  if (insightsListenersWired) return;
  insightsListenersWired = true;

  qs('#insights-owner-filter').addEventListener('change', () => {
    state.insightsOwner = qs('#insights-owner-filter').value;
    renderInsightsActiveTab();
  });

  qsa('#insights-period-tabs .filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      qsa('#insights-period-tabs .filter-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.insightsPeriod = btn.dataset.period;
      renderInsightsActiveTab();
    });
  });

  qsa('.insights-subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      qsa('.insights-subtab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.insightsSubTab = btn.dataset.itab;
      qsa('.insights-panel').forEach(p => { p.style.display = 'none'; });
      qs(`#insights-panel-${state.insightsSubTab}`).style.display = '';
      renderInsightsActiveTab();
    });
  });
}

async function loadInsights() {
  applyChartJsDefaults();
  initInsightsListeners();

  // Populate owner dropdown from already-loaded users
  const ownerSel = qs('#insights-owner-filter');
  ownerSel.innerHTML = '<option value="">All People</option>' +
    state.users.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('');
  ownerSel.value = state.insightsOwner;

  // Fetch all data (client-side filtering)
  [state.insightsRocks, state.insightsTodos, state.insightsMeetings] = await Promise.all([
    api.get('/api/rocks'),
    api.get('/api/issues'),
    api.get('/api/meetings'),
  ]);

  renderInsightsActiveTab();
}

function renderInsightsActiveTab() {
  const tab = state.insightsSubTab;
  if (tab === 'rocks')    renderInsightsRocks();
  if (tab === 'todos')    renderInsightsTodos();
  if (tab === 'meetings') renderInsightsMeetings();
}

function filterByOwnerAndPeriod(items, dateField) {
  const { start, end } = periodDateRange(state.insightsPeriod);
  return items.filter(item => {
    if (state.insightsOwner && String(item.owner_id) !== state.insightsOwner) return false;
    if (dateField && item[dateField]) {
      const d = new Date(item[dateField]);
      if (d < start || d > end) return false;
    }
    return true;
  });
}

function filterMeetingsByPeriod(meetings) {
  const { start, end } = periodDateRange(state.insightsPeriod);
  return meetings.filter(m => {
    const d = new Date(m.scheduled_at || m.created_at);
    return d >= start && d <= end;
  });
}

function renderInsightsRocks() {
  const filtered  = filterByOwnerAndPeriod(state.insightsRocks, 'created_at');
  const total     = filtered.length;
  const done      = filtered.filter(r => r.status === 'done').length;
  const onT       = filtered.filter(r => r.status === 'on_track').length;
  const offT      = filtered.filter(r => r.status === 'off_track').length;
  const notStart  = filtered.filter(r => r.status === 'not_started').length;
  const avgProg   = total ? Math.round(filtered.reduce((s, r) => s + (r.progress || 0), 0) / total) : 0;
  const compRate  = total ? Math.round((done / total) * 100) : 0;

  qs('#insights-rocks-stats').innerHTML = `
    <div class="stat-card"><span class="stat-label">Total Rocks</span><span class="stat-value">${total}</span></div>
    <div class="stat-card green"><span class="stat-label">On Track</span><span class="stat-value">${onT}</span></div>
    <div class="stat-card red"><span class="stat-label">Off Track</span><span class="stat-value">${offT}</span></div>
    <div class="stat-card accent"><span class="stat-label">Done</span><span class="stat-value">${done}</span></div>
    <div class="stat-card"><span class="stat-label">Avg Progress</span><span class="stat-value">${avgProg}%</span></div>
    <div class="stat-card"><span class="stat-label">Completion Rate</span><span class="stat-value">${compRate}%</span></div>
  `;

  // Donut: status breakdown
  destroyChart('rocks-status');
  state.insightCharts['rocks-status'] = new Chart(qs('#chart-rocks-status').getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: ['Not Started', 'On Track', 'Off Track', 'Done'],
      datasets: [{ data: [notStart, onT, offT, done],
        backgroundColor: ['#2a2a3d', '#10b981', '#ef4444', '#3b82f6'],
        borderColor: '#1a1a24', borderWidth: 3, hoverOffset: 6 }],
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '65%',
      plugins: { legend: { position: 'bottom' },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} (${total ? Math.round(ctx.parsed / total * 100) : 0}%)` } } } },
  });

  // Bar: progress buckets
  destroyChart('rocks-progress');
  const bkts = [0, 0, 0, 0, 0];
  filtered.forEach(r => {
    const p = r.progress || 0;
    if (p === 100) bkts[4]++;
    else if (p >= 76) bkts[3]++;
    else if (p >= 51) bkts[2]++;
    else if (p >= 26) bkts[1]++;
    else bkts[0]++;
  });
  state.insightCharts['rocks-progress'] = new Chart(qs('#chart-rocks-progress').getContext('2d'), {
    type: 'bar',
    data: { labels: ['0–25%', '26–50%', '51–75%', '76–99%', '100%'],
      datasets: [{ label: 'Rocks', data: bkts, backgroundColor: '#6366f1', hoverBackgroundColor: '#7c7ff5', borderRadius: 6, borderSkipped: false }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { grid: { color: '#2e2e42' }, ticks: { color: '#9494b0' } },
                y: { grid: { color: '#2e2e42' }, ticks: { color: '#9494b0', precision: 0 }, beginAtZero: true } } },
  });

  // Horizontal bar: by owner
  destroyChart('rocks-owner');
  const om = {};
  filtered.forEach(r => {
    const n = r.owner_name || 'Unassigned';
    if (!om[n]) om[n] = { count: 0, prog: 0 };
    om[n].count++;
    om[n].prog += (r.progress || 0);
  });
  const oNames = Object.keys(om);
  state.insightCharts['rocks-owner'] = new Chart(qs('#chart-rocks-owner').getContext('2d'), {
    type: 'bar',
    data: { labels: oNames,
      datasets: [
        { label: 'Rock Count', data: oNames.map(n => om[n].count), backgroundColor: '#6366f1', hoverBackgroundColor: '#7c7ff5', borderRadius: 4, borderSkipped: false },
        { label: 'Avg Progress %', data: oNames.map(n => Math.round(om[n].prog / om[n].count)), backgroundColor: '#10b981', hoverBackgroundColor: '#34d399', borderRadius: 4, borderSkipped: false },
      ] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { position: 'bottom' },
        tooltip: { callbacks: { label: ctx => ctx.dataset.label === 'Avg Progress %' ? ` Avg Progress: ${ctx.parsed.x}%` : ` Rock Count: ${ctx.parsed.x}` } } },
      scales: { x: { grid: { color: '#2e2e42' }, ticks: { color: '#9494b0', precision: 0 }, beginAtZero: true },
                y: { grid: { color: 'transparent' }, ticks: { color: '#9494b0' } } } },
  });
}

function renderInsightsTodos() {
  const filtered = filterByOwnerAndPeriod(state.insightsTodos, 'created_at');
  const total    = filtered.length;
  const inProg   = filtered.filter(i => i.status === 'in_progress').length;
  const waiting  = filtered.filter(i => i.status === 'waiting_for').length;
  const blocker  = filtered.filter(i => i.status === 'blocker').length;
  const solved   = filtered.filter(i => i.status === 'solved').length;
  const highP    = filtered.filter(i => i.priority === 'high').length;
  const medP     = filtered.filter(i => i.priority === 'medium').length;
  const lowP     = filtered.filter(i => i.priority === 'low').length;

  qs('#insights-todos-stats').innerHTML = `
    <div class="stat-card"><span class="stat-label">Total</span><span class="stat-value">${total}</span></div>
    <div class="stat-card blue"><span class="stat-label">In Progress</span><span class="stat-value">${inProg}</span></div>
    <div class="stat-card yellow"><span class="stat-label">Waiting For</span><span class="stat-value">${waiting}</span></div>
    <div class="stat-card red"><span class="stat-label">Blockers</span><span class="stat-value">${blocker}</span></div>
    <div class="stat-card green"><span class="stat-label">Solved</span><span class="stat-value">${solved}</span></div>
    <div class="stat-card red"><span class="stat-label">High Priority</span><span class="stat-value">${highP}</span></div>
  `;

  destroyChart('todos-status');
  state.insightCharts['todos-status'] = new Chart(qs('#chart-todos-status').getContext('2d'), {
    type: 'doughnut',
    data: { labels: ['In Progress', 'Waiting For', 'Blocker', 'Solved'],
      datasets: [{ data: [inProg, waiting, blocker, solved], backgroundColor: ['#3b82f6', '#f59e0b', '#ef4444', '#10b981'],
        borderColor: '#1a1a24', borderWidth: 3, hoverOffset: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '65%',
      plugins: { legend: { position: 'bottom' },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} (${total ? Math.round(ctx.parsed / total * 100) : 0}%)` } } } },
  });

  destroyChart('todos-priority');
  state.insightCharts['todos-priority'] = new Chart(qs('#chart-todos-priority').getContext('2d'), {
    type: 'bar',
    data: { labels: ['High', 'Medium', 'Low'],
      datasets: [{ label: 'To-Dos', data: [highP, medP, lowP],
        backgroundColor: ['#ef4444', '#f59e0b', '#2a2a3d'],
        hoverBackgroundColor: ['#f87171', '#fbbf24', '#3a3a55'], borderRadius: 6, borderSkipped: false }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { grid: { color: '#2e2e42' }, ticks: { color: '#9494b0' } },
                y: { grid: { color: '#2e2e42' }, ticks: { color: '#9494b0', precision: 0 }, beginAtZero: true } } },
  });

  destroyChart('todos-owner');
  const om = {};
  filtered.forEach(i => { const n = i.owner_name || 'Unassigned'; om[n] = (om[n] || 0) + 1; });
  const oNames = Object.keys(om);
  state.insightCharts['todos-owner'] = new Chart(qs('#chart-todos-owner').getContext('2d'), {
    type: 'bar',
    data: { labels: oNames,
      datasets: [{ label: 'Open To-Dos', data: oNames.map(n => om[n]),
        backgroundColor: '#6366f1', hoverBackgroundColor: '#7c7ff5', borderRadius: 4, borderSkipped: false }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } },
      scales: { x: { grid: { color: '#2e2e42' }, ticks: { color: '#9494b0', precision: 0 }, beginAtZero: true },
                y: { grid: { color: 'transparent' }, ticks: { color: '#9494b0' } } } },
  });
}

function renderInsightsMeetings() {
  const filtered  = filterMeetingsByPeriod(state.insightsMeetings);
  const total     = filtered.length;
  const upcoming  = filtered.filter(m => m.status === 'upcoming').length;
  const inProg    = filtered.filter(m => m.status === 'in_progress').length;
  const completed = filtered.filter(m => m.status === 'completed').length;
  const withDur   = filtered.filter(m => m.status === 'completed' && m.started_at && m.ended_at);
  const avgDur    = withDur.length
    ? Math.round(withDur.reduce((s, m) => s + (new Date(m.ended_at) - new Date(m.started_at)), 0) / withDur.length / 60000)
    : 0;

  qs('#insights-meetings-stats').innerHTML = `
    <div class="stat-card"><span class="stat-label">Total</span><span class="stat-value">${total}</span></div>
    <div class="stat-card green"><span class="stat-label">Completed</span><span class="stat-value">${completed}</span></div>
    <div class="stat-card yellow"><span class="stat-label">Upcoming</span><span class="stat-value">${upcoming}</span></div>
    <div class="stat-card"><span class="stat-label">Avg Duration</span><span class="stat-value">${avgDur ? avgDur + ' min' : '—'}</span></div>
  `;

  destroyChart('meetings-status');
  state.insightCharts['meetings-status'] = new Chart(qs('#chart-meetings-status').getContext('2d'), {
    type: 'doughnut',
    data: { labels: ['Upcoming', 'In Progress', 'Completed'],
      datasets: [{ data: [upcoming, inProg, completed], backgroundColor: ['#f59e0b', '#6366f1', '#10b981'],
        borderColor: '#1a1a24', borderWidth: 3, hoverOffset: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '65%',
      plugins: { legend: { position: 'bottom' },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} (${total ? Math.round(ctx.parsed / total * 100) : 0}%)` } } } },
  });

  destroyChart('meetings-timeline');
  const monthMap = {};
  filtered.forEach(m => {
    const d = new Date(m.scheduled_at || m.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthMap[key] = (monthMap[key] || 0) + 1;
  });
  const monthKeys   = Object.keys(monthMap).sort();
  const monthLabels = monthKeys.map(k => {
    const [yr, mo] = k.split('-');
    return new Date(+yr, +mo - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  });
  state.insightCharts['meetings-timeline'] = new Chart(qs('#chart-meetings-timeline').getContext('2d'), {
    type: 'bar',
    data: { labels: monthLabels.length ? monthLabels : ['No data'],
      datasets: [{ label: 'Meetings', data: monthKeys.length ? monthKeys.map(k => monthMap[k]) : [0],
        backgroundColor: '#6366f1', hoverBackgroundColor: '#7c7ff5', borderRadius: 6, borderSkipped: false }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { grid: { color: '#2e2e42' }, ticks: { color: '#9494b0' } },
                y: { grid: { color: '#2e2e42' }, ticks: { color: '#9494b0', precision: 0 }, beginAtZero: true } } },
  });
}

/* ── Load all ────────────────────────────────────────────────────── */
async function loadAll() {
  await Promise.all([
    populateQuarterFilter().then(() => loadRocks()),
    loadIssues(),
    loadTeamIssues(),
    loadMy90(),
  ]);
}

/* ── Boot ────────────────────────────────────────────────────────── */
(async function init() {
  // Check for OAuth error in URL
  const params = new URLSearchParams(location.search);
  const oauthError = params.get('error');

  // Ask server who's logged in
  const me = await api.get('/api/me');

  if (me) {
    // Logged in — load the app
    await loadUsers();
    enterApp(me);
  } else {
    // Not logged in — show login screen
    const msgs = {
      unauthorized: 'Only @sred.ca accounts are allowed.',
      token_exchange: 'Sign-in failed. Please try again.',
      cancelled: 'Sign-in was cancelled.',
    };
    showLoginScreen(oauthError ? (msgs[oauthError] || 'Sign-in failed.') : null);
  }
})();
