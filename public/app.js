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
  pendingDelete: null,
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

function openModal(id) { qs(`#${id}`).classList.add('active'); }
function closeModal(id) { qs(`#${id}`).classList.remove('active'); }

/* ── User Picker ─────────────────────────────────────────────────── */
async function loadUsers() {
  state.users = await api.get('/api/users');
  renderUserPicker();
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
  const card = document.createElement('div');
  card.className = `issue-card ${issue.status === 'solved' ? 'solved' : ''} ${isArchived ? 'archived' : ''}`;

  const voted = state.userVotes.includes(issue.id);

  // Archive button: shown on solved, non-archived cards
  const archiveBtn = (issue.status === 'solved' && !isArchived)
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
    <div class="issue-card-bottom">
      <div class="issue-meta">
        ${issue.owner_name ? `<span style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text2)"></span>` : ''}
        <span class="badge badge-${issue.status}">${issue.status}</span>
        <span class="badge badge-${issue.priority}">${issue.priority}</span>
      </div>
      <div class="issue-actions">
        ${!isArchived ? `<button class="vote-btn ${voted ? 'voted' : ''}" data-id="${issue.id}" title="${voted ? 'Remove vote' : 'Vote to prioritize'}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>
          ${issue.votes}
        </button>` : ''}
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

  // Inject avatar
  if (issue.owner_name) {
    const metaSpan = card.querySelector('.issue-meta > span');
    if (metaSpan) {
      metaSpan.prepend(avatar(issue.owner_name, issue.owner_color, 20));
      metaSpan.append(document.createTextNode(issue.owner_name));
    }
  }

  return card;
}

function renderIssues() {
  const grid = qs('#issues-list');
  const empty = qs('#issues-empty');
  grid.innerHTML = '';

  // Stats: exclude archived from counts
  const activeIssues = state.issues.filter(i => !i.archived);
  const total = activeIssues.length;
  const identified = activeIssues.filter(i => i.status === 'identified').length;
  const discussing = activeIssues.filter(i => i.status === 'discussing').length;
  const solved = activeIssues.filter(i => i.status === 'solved').length;
  qs('#issues-stats').innerHTML = `
    <div class="stat-card"><span class="stat-label">Total</span><span class="stat-value">${total}</span></div>
    <div class="stat-card yellow"><span class="stat-label">Identified</span><span class="stat-value">${identified}</span></div>
    <div class="stat-card accent"><span class="stat-label">Discussing</span><span class="stat-value">${discussing}</span></div>
    <div class="stat-card green"><span class="stat-label">Solved</span><span class="stat-value">${solved}</span></div>
  `;

  if (state.issues.length === 0) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  if (state.issueStatusFilter === 'solved') {
    // Solved tab: active solved first, then archived under a divider
    const activeSolved   = state.issues.filter(i => !i.archived);
    const archivedSolved = state.issues.filter(i =>  i.archived);

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
    // All / Identified / Discussing tabs: server already filtered out archived
    state.issues.forEach(issue => grid.appendChild(buildIssueCard(issue)));
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

/* Issue filter tabs */
qsa('.filter-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    qsa('.filter-tab').forEach(t => t.classList.remove('active'));
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
  qs('#issue-status').value = issue ? issue.status : 'identified';
  qs('#issue-status-group').style.display = issue ? 'flex' : 'none';

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
    if (type === 'rock') { await api.del(`/api/rocks/${id}`); closeModal('confirm-modal'); loadRocks(); }
    else if (type === 'issue') { await api.del(`/api/issues/${id}`); closeModal('confirm-modal'); loadIssues(); }
  } catch (e) { alert(e.message); }
  state.pendingDelete = null;
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
