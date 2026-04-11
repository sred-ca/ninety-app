/* ── State ───────────────────────────────────────────────────────── */
const state = {
  currentUser: null,
  users: [],
  rocks: [],
  issues: [],
  userVotes: [],
  currentView: 'rocks',
  quarterFilter: '',
  issueStatusFilter: '',
  issueOwnerFilter: '',
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

function avatar(name, color, size = 28) {
  const el = document.createElement('div');
  el.className = 'avatar';
  el.style.background = color || '#6366f1';
  el.style.width = el.style.height = size + 'px';
  el.style.fontSize = (size * 0.38) + 'px';
  el.textContent = initials(name);
  return el;
}

function badge(text, cls) {
  const el = document.createElement('span');
  el.className = `badge badge-${cls}`;
  el.textContent = text.replace('_', ' ');
  return el;
}

function quarters(count = 8) {
  const result = [];
  const now = new Date();
  let year = now.getFullYear();
  let q = Math.ceil((now.getMonth() + 1) / 3);
  for (let i = 0; i < count; i++) {
    result.push(`Q${q} ${year}`);
    q--;
    if (q === 0) { q = 4; year--; }
  }
  return result;
}

function currentQuarter() {
  const now = new Date();
  return `Q${Math.ceil((now.getMonth() + 1) / 3)} ${now.getFullYear()}`;
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

/* ── User Picker ─────────────────────────────────────────────────── */
async function loadUsers() {
  state.users = await api.get('/api/users');
  renderUserPicker();
  renderIssueOwnerFilter();
}

function renderUserPicker() {
  const list = qs('#user-list');
  list.innerHTML = '';
  state.users.forEach(u => {
    const btn = document.createElement('button');
    btn.className = 'user-list-item';
    btn.appendChild(avatar(u.name, u.color, 32));
    btn.appendChild(document.createTextNode(u.name));
    btn.addEventListener('click', () => selectUser(u));
    list.appendChild(btn);
  });
}

function selectUser(user) {
  state.currentUser = user;
  localStorage.setItem('ninety_user_id', user.id);
  closeModal('user-modal');
  qs('#app').classList.remove('hidden');
  updateSidebarUser();
  loadAll();
}

function updateSidebarUser() {
  const u = state.currentUser;
  const avEl = qs('#sidebar-avatar');
  avEl.style.background = u.color;
  avEl.textContent = initials(u.name);
  qs('#sidebar-username').textContent = u.name;
}

/* ── Add New User ────────────────────────────────────────────────── */
qs('#add-user-btn').addEventListener('click', () => {
  qs('#add-user-form').classList.toggle('hidden');
  if (!qs('#add-user-form').classList.contains('hidden')) {
    qs('#new-user-name').focus();
  }
});

qs('#save-user-btn').addEventListener('click', async () => {
  const name = qs('#new-user-name').value.trim();
  if (!name) return;
  const colors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#06b6d4'];
  const color = colors[state.users.length % colors.length];
  const user = await api.post('/api/users', { name, color });
  state.users.push(user);
  renderUserPicker();
  qs('#new-user-name').value = '';
  qs('#add-user-form').classList.add('hidden');
  selectUser(user);
});

qs('#new-user-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') qs('#save-user-btn').click();
});

/* ── Switch user ─────────────────────────────────────────────────── */
qs('#switch-user-btn').addEventListener('click', () => {
  renderUserPicker();
  openModal('user-modal');
});

/* ── Navigation ──────────────────────────────────────────────────── */
qsa('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    qsa('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    qsa('.view').forEach(v => v.classList.remove('active'));
    qs(`#view-${view}`).classList.add('active');
    state.currentView = view;
    if (view === 'meetings') loadMeetings();
  });
});

/* ── Modal close buttons ─────────────────────────────────────────── */
qsa('[data-modal]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.modal));
});
qsa('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay && overlay.id !== 'user-modal') closeModal(overlay.id);
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
      ownerCell.appendChild(avatar(rock.owner_name, rock.owner_color));
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
      <button class="icon-btn edit-rock-btn" data-id="${rock.id}" title="Edit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="icon-btn danger delete-rock-btn" data-id="${rock.id}" data-title="${esc(rock.title)}" title="Delete">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
      </button>
    `;

    row.append(titleCell, ownerCell, progressCell, statusCell, actions);
    list.appendChild(row);
  });

  // Events
  qsa('.edit-rock-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openRockModal(parseInt(btn.dataset.id)); });
  });
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
  const url = state.issueStatusFilter ? `/api/issues?status=${state.issueStatusFilter}` : '/api/issues';
  [state.issues, state.userVotes] = await Promise.all([
    api.get(url),
    state.currentUser ? api.get(`/api/issues/votes/${state.currentUser.id}`) : Promise.resolve([]),
  ]);
  renderIssues();
}

/* Build a single issue card DOM element */
function buildIssueCard(issue) {
  const isArchived = !!issue.archived;
  const isSolved   = issue.status === 'solved';
  const card = document.createElement('div');
  card.className = `issue-card ${isSolved ? 'solved' : ''} ${isArchived ? 'archived' : ''}`;

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

  card.innerHTML = `
    <div class="issue-card-top">
      <div class="issue-priority-dot ${issue.priority}"></div>
      <div class="issue-title">${esc(issue.title)}</div>
    </div>
    ${issue.description ? `<div class="issue-desc">${esc(issue.description)}</div>` : ''}
    <div class="issue-card-meta-row">
      ${dueDateHtml}
      ${issue.owner_name ? `<span class="issue-owner-chip"></span>` : ''}
    </div>
    <div class="issue-card-bottom">
      <div class="issue-meta">
        <span class="badge badge-${issue.status}">${issue.status === 'in_progress' ? 'In Progress' : issue.status === 'blocker' ? 'Blocker' : issue.status.replace('_', ' ')}</span>
        <span class="badge badge-${issue.priority}">${issue.priority}</span>
      </div>
      <div class="issue-actions">
        ${!isArchived ? `<button class="vote-btn ${voted ? 'voted' : ''}" data-id="${issue.id}" title="${voted ? 'Remove vote' : 'Vote to prioritize'}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>
          ${issue.votes}
        </button>` : ''}
        ${solveBtn}
        ${!isArchived ? `<button class="icon-btn edit-issue-btn" data-id="${issue.id}" title="Edit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>` : ''}
        ${archiveBtn}
        ${unarchiveBtn}
        ${!isArchived ? `<button class="icon-btn danger delete-issue-btn" data-id="${issue.id}" data-title="${esc(issue.title)}" title="Delete">
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
      chip.prepend(avatar(issue.owner_name, issue.owner_color, 18));
      chip.append(document.createTextNode(issue.owner_name));
    }
  }

  return card;
}

function renderIssueOwnerFilter() {
  const sel = qs('#issue-owner-filter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">All Owners</option>' +
    state.users.map(u => `<option value="${u.id}" ${cur == u.id ? 'selected' : ''}>${u.name}</option>`).join('');
  sel.value = cur;
}

function renderIssues() {
  const grid = qs('#issues-list');
  const empty = qs('#issues-empty');
  grid.innerHTML = '';

  // Apply owner filter client-side
  const ownerFilter = state.issueOwnerFilter ? +state.issueOwnerFilter : null;
  const filtered = ownerFilter
    ? state.issues.filter(i => i.owner_id === ownerFilter)
    : state.issues;

  // Stats: exclude archived from counts; Total excludes solved (use all issues for accurate counts)
  const activeIssues = state.issues.filter(i => !i.archived);
  const inProgress = activeIssues.filter(i => i.status === 'in_progress').length;
  const blockers   = activeIssues.filter(i => i.status === 'blocker').length;
  const solved     = activeIssues.filter(i => i.status === 'solved').length;
  const total      = inProgress + blockers; // all open (non-solved) issues
  qs('#issues-stats').innerHTML = `
    <div class="stat-card"><span class="stat-label">Total Open</span><span class="stat-value">${total}</span></div>
    <div class="stat-card accent"><span class="stat-label">In Progress</span><span class="stat-value">${inProgress}</span></div>
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

    activeSolved.forEach(issue => grid.appendChild(buildIssueCard(issue)));

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
      grid.appendChild(divider);
      archivedSolved.forEach(issue => grid.appendChild(buildIssueCard(issue)));
    }
  } else {
    filtered.forEach(issue => grid.appendChild(buildIssueCard(issue)));
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

  qsa('.edit-issue-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openIssueModal(parseInt(btn.dataset.id)); });
  });

  qsa('.delete-issue-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); confirmDelete('issue', btn.dataset.id, btn.dataset.title); });
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
}

/* Issue owner filter */
qs('#issue-owner-filter').addEventListener('change', () => {
  state.issueOwnerFilter = qs('#issue-owner-filter').value;
  renderIssues();
});

/* Issue filter tabs */
qsa('#issue-filter-tabs .filter-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    qsa('#issue-filter-tabs .filter-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.issueStatusFilter = tab.dataset.status;
    loadIssues();
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
    else if (type === 'agenda')  { await api.del(`/api/agendas/${id}`);  closeModal('confirm-modal'); loadAgendas(); }
    else if (type === 'meeting') { await api.del(`/api/meetings/${id}`); closeModal('confirm-modal'); loadMeetings(); }
  } catch (e) { alert(e.message); }
  state.pendingDelete = null;
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

/* ── Upcoming meetings ───────────────────────────────────────────── */
function renderMeetingsUpcoming() {
  const list = qs('#meetings-upcoming-list');
  const empty = qs('#meetings-upcoming-empty');
  const upcoming = state.meetings.filter(m => m.status === 'upcoming');
  list.innerHTML = '';
  if (upcoming.length === 0) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<div class="table-header" style="grid-template-columns:1fr 200px 120px">
    <span class="th">Meeting</span><span class="th">Scheduled</span><span class="th"></span>
  </div>`;
  const body = document.createElement('div');
  upcoming.forEach(m => {
    const row = document.createElement('div');
    row.className = 'table-row';
    row.style.gridTemplateColumns = '1fr 200px 120px';
    const agenda = state.agendas.find(a => a.id === m.agenda_id);
    const displayTitle = agenda ? agenda.title : m.title;
    const when = m.scheduled_at ? new Date(m.scheduled_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : 'Unscheduled';
    row.innerHTML = `
      <div class="rock-title-cell"><div class="rock-title">${esc(displayTitle)}</div></div>
      <div style="color:var(--text2);font-size:13px">${when}</div>
      <div class="row-actions" style="opacity:1;gap:6px">
        <button class="btn btn-primary btn-sm start-scheduled-btn" data-id="${m.id}" data-agenda="${m.agenda_id}" data-title="${esc(displayTitle)}" style="font-size:12px;padding:4px 10px">Start</button>
        <button class="icon-btn danger delete-meeting-btn" data-id="${m.id}" data-title="${esc(displayTitle)}" title="Delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </div>`;
    body.appendChild(row);
  });
  card.appendChild(body);
  list.appendChild(card);
  qsa('.start-scheduled-btn').forEach(btn => {
    btn.addEventListener('click', () => startRunner(+btn.dataset.agenda, btn.dataset.title, +btn.dataset.id));
  });
  qsa('.delete-meeting-btn').forEach(btn => {
    btn.addEventListener('click', () => confirmDelete('meeting', btn.dataset.id, btn.dataset.title));
  });
}

/* ── Schedule a meeting ──────────────────────────────────────────── */
qs('#start-meeting-btn').addEventListener('click', () => {
  populateAgendaSelects();
  openModal('pick-agenda-modal');
});
qs('#confirm-start-meeting-btn').addEventListener('click', async () => {
  const agendaId = +qs('#pick-agenda-select').value;
  const agenda = state.agendas.find(a => a.id === agendaId);
  if (!agenda) return;
  closeModal('pick-agenda-modal');
  await startRunner(agendaId, agenda.title, null);
});

const schedBtn = qs('#schedule-meeting-btn-empty');
if (schedBtn) schedBtn.addEventListener('click', () => { populateAgendaSelects(); openModal('schedule-meeting-modal'); });

qs('#confirm-schedule-btn').addEventListener('click', async () => {
  const agendaId = +qs('#schedule-agenda-select').value;
  const agenda = state.agendas.find(a => a.id === agendaId);
  const dt = qs('#schedule-datetime').value;
  if (!agenda) return;
  await api.post('/api/meetings', {
    agenda_id: agendaId,
    title: agenda.title,
    scheduled_at: dt ? new Date(dt).toISOString() : null,
    status: 'upcoming',
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
    row.style.gridTemplateColumns = '32px 1fr 160px 80px 48px';
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
      if (!name) return;
      await api.put(`/api/agenda-sections/${sec.id}`, { name, duration_minutes: dur, visible: vis });
      const s = state.currentAgendaSections.find(s => s.id === sec.id);
      if (s) { s.name = name; s.duration_minutes = dur; s.visible = vis; }
      const total2 = state.currentAgendaSections.reduce((s,x) => s + (x.duration_minutes||0), 0);
      qs('#agenda-total-time').textContent = `Total: ${total2 >= 60 ? Math.floor(total2/60)+'h '+total2%60+'m' : total2+' min'}`;
    };
    row.querySelector('.section-name-input').addEventListener('blur', save);
    row.querySelector('.section-dur-input').addEventListener('change', save);
    row.querySelector('.section-visible-input').addEventListener('change', save);
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

async function startRunner(agendaId, title, existingMeetingId) {
  const sections = await api.get(`/api/agendas/${agendaId}/sections`);
  const visible = sections.filter(s => s.visible);
  if (visible.length === 0) { alert('This agenda has no visible sections.'); return; }

  // Create or update meeting record
  let meetingId = existingMeetingId;
  if (!meetingId) {
    const m = await api.post('/api/meetings', {
      agenda_id: agendaId, title, sections_snapshot: visible,
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
      if (m.id !== 'user-modal') closeModal(m.id);
    });
  }
});

/* ── XSS protection ──────────────────────────────────────────────── */
function esc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Load all ────────────────────────────────────────────────────── */
async function loadAll() {
  await Promise.all([
    populateQuarterFilter().then(() => loadRocks()),
    loadIssues(),
  ]);
}

/* ── Boot ────────────────────────────────────────────────────────── */
(async function init() {
  await loadUsers();

  // Restore last user from localStorage
  const savedId = localStorage.getItem('ninety_user_id');
  if (savedId) {
    const user = state.users.find(u => u.id === parseInt(savedId));
    if (user) {
      selectUser(user);
      return;
    }
  }

  // Show user picker
  openModal('user-modal');
})();
