/* ── State ───────────────────────────────────────────────────────── */
const state = {
  currentUser: null,
  users: [],
  rocks: [],
  issues: [],
  currentView: 'my90',
  my90Rocks: [],
  my90Issues: [],
  my90Meetings: [],
  quarterFilter: '',
  currentMilestones: [],
  currentMilestoneRockId: null,
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
    attendees: [],
    // To-dos panel: column filters + sort
    todoFilters: { blocker: true, waiting_for: true, in_progress: true },
    todoSort: { col: 'status', dir: 'asc' },
  },
  // Insights
  insightsSubTab: 'rocks',
  insightsPeriod: 'current',
  insightsOwner: '',
  insightCharts: {},
  insightsRocks: [],
  insightsTodos: [],
  insightsMeetings: [],
  // V/TO
  vto: null,
  vtoEditing: null, // section key currently in edit mode, or null
  // Budget
  budget: { lines: [], cells: [] },
  budgetFiscalYear: 'FY27',
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
  // Drop any persisted owner-filter IDs that no longer map to a real user.
  if (state.issueOwnerFilter.length) {
    const alive = new Set(state.users.map(u => u.id));
    const pruned = state.issueOwnerFilter.filter(id => alive.has(+id));
    if (pruned.length !== state.issueOwnerFilter.length) {
      state.issueOwnerFilter = pruned;
      if (typeof saveIssueOwnerFilter === 'function') saveIssueOwnerFilter();
    }
  }
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
  // Reveal assignable sidebar tabs per the admin matrix (owners see all).
  // The default tabs (My 90, To-Dos, Issues, Meetings, Insights) are always on.
  applyTabVisibility(user);
  // Show the Stella nav only when coaching is enabled on the server AND
  // the user has the tab. Coaching being disabled wins over tab grant.
  api.get('/api/coaching/enabled').then(d => {
    if (!(d && d.enabled)) qs('#stella-nav-item').style.display = 'none';
  }).catch(() => { /* silent — coaching flag is optional */ });
  loadAll();
}

function applyTabVisibility(user) {
  const grants = new Set(user?.tabs || []);
  const isOwner = user?.role === 'owner';
  const show = (tab) => isOwner || grants.has(tab);
  qs('#vto-nav-item')   .style.display = show('vto')    ? '' : 'none';
  qs('#budget-nav-item').style.display = show('budget') ? '' : 'none';
  qs('#stella-nav-item').style.display = show('stella') ? '' : 'none';
  qs('#admin-nav-item') .style.display = isOwner        ? '' : 'none';
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
    if (view === 'vto')       loadVto();
    if (view === 'meetings')  loadMeetings();
    if (view === 'insights')  loadInsights();
    if (view === 'stella')    loadStella();
    if (view === 'goals')     loadGoals();
    if (view === 'budget')    loadBudget();
    if (view === 'admin')     loadAdmin();
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
    const mTotal = rock.milestone_count || 0;
    const mDone  = rock.milestone_done_count || 0;
    const progressCell = document.createElement('div');
    progressCell.className = 'progress-cell';
    progressCell.innerHTML = `
      <div class="progress-bar-wrap">
        <div class="progress-bar-fill ${rock.status === 'done' ? 'done' : ''}" style="width:${pct}%"></div>
      </div>
      <span class="progress-label-sm">${pct}%</span>
      ${mTotal > 0 ? `<span class="progress-milestones-sm">${mDone} of ${mTotal}</span>` : ''}
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
  qs('#rock-progress').disabled = false;
  qs('#rock-progress-note').hidden = true;

  // Populate owner dropdown
  const ownerSel = qs('#rock-owner');
  ownerSel.innerHTML = '<option value="">Unassigned</option>' +
    state.users.map(u => `<option value="${u.id}" ${rock && rock.owner_id === u.id ? 'selected' : ''}>${u.name}</option>`).join('');
  if (!rock) ownerSel.value = state.currentUser ? state.currentUser.id : '';

  // Populate quarter dropdown
  const allQ = [...new Set([currentQuarter(), ...quarters(8)])];
  const qSel = qs('#rock-quarter');
  qSel.innerHTML = allQ.map(q => `<option value="${q}" ${rock ? (rock.quarter === q ? 'selected' : '') : (q === (state.quarterFilter || currentQuarter()) ? 'selected' : '')}>${q}</option>`).join('');

  // Populate goal dropdown from V/TO annual goals.
  const goalSel = qs('#rock-goal');
  const allGoals = (state.vto?.one_year_goals) || [];
  goalSel.innerHTML = '<option value="">— No goal —</option>' +
    allGoals.map((g, i) => `<option value="${esc(g.id || '')}" ${rock && rock.goal_id === g.id ? 'selected' : ''}>${i + 1}. ${esc((g.text || '').slice(0, 80))}</option>`).join('');

  // Milestones section — only shown when editing an existing rock.
  state.currentMilestones = [];
  state.currentMilestoneRockId = rock ? rock.id : null;
  qs('#milestones-list').innerHTML = '';
  qs('#milestones-count').textContent = '0';
  qs('#milestones-section').hidden = !rock;
  if (rock) loadAndRenderMilestones(rock.id);

  openModal('rock-modal');
  qs('#rock-title').focus();
}

async function loadAndRenderMilestones(rockId) {
  try {
    state.currentMilestones = await api.get(`/api/rocks/${rockId}/milestones`);
  } catch (e) { console.error(e); state.currentMilestones = []; }
  renderMilestoneList();
}

function renderMilestoneList() {
  const list = qs('#milestones-list');
  list.innerHTML = '';
  state.currentMilestones.forEach(m => list.appendChild(buildMilestoneRow(m)));
  qs('#milestones-count').textContent = String(state.currentMilestones.length);
  updateProgressFromMilestones();
}

function updateProgressFromMilestones() {
  const total = state.currentMilestones.length;
  const slider = qs('#rock-progress');
  const label  = qs('#progress-label');
  const note   = qs('#rock-progress-note');
  if (total === 0) {
    slider.disabled = false;
    note.hidden = true;
    return;
  }
  const done = state.currentMilestones.filter(m => m.done).length;
  const pct  = Math.round((done / total) * 100);
  slider.value = pct;
  slider.disabled = true;
  label.textContent = `${pct}%`;
  note.hidden = false;
}

function buildMilestoneRow(m) {
  const row = document.createElement('div');
  row.className = `milestone-row ${m.done ? 'done' : ''}`;
  row.dataset.id = m.id;
  row.innerHTML = `
    <button type="button" class="milestone-check ${m.done ? 'done' : ''}" title="Toggle done">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
    </button>
    <input type="text" class="milestone-title-input" value="${esc(m.title)}" />
    <input type="date" class="milestone-due-input" value="${m.due_date ? m.due_date.slice(0,10) : ''}" />
    <select class="milestone-owner-select">
      <option value="">Unassigned</option>
      ${state.users.map(u => `<option value="${u.id}" ${m.owner_id === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
    </select>
    <button type="button" class="milestone-delete-btn" title="Delete">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
    </button>
  `;

  row.querySelector('.milestone-check').addEventListener('click', async () => {
    const newDone = !m.done;
    try {
      await api.put(`/api/milestones/${m.id}`, { done: newDone });
      m.done = newDone;
      row.classList.toggle('done', newDone);
      row.querySelector('.milestone-check').classList.toggle('done', newDone);
      updateProgressFromMilestones();
      loadRocks(); // refresh list-view progress for the parent rock
    } catch (e) { alert(e.message); }
  });

  const titleInput = row.querySelector('.milestone-title-input');
  titleInput.addEventListener('blur', async () => {
    const v = titleInput.value.trim();
    if (!v) { titleInput.value = m.title; return; }
    if (v === m.title) return;
    try { await api.put(`/api/milestones/${m.id}`, { title: v }); m.title = v; }
    catch (e) { alert(e.message); titleInput.value = m.title; }
  });

  row.querySelector('.milestone-due-input').addEventListener('change', async (e) => {
    const v = e.target.value || null;
    try { await api.put(`/api/milestones/${m.id}`, { due_date: v }); m.due_date = v; }
    catch (err) { alert(err.message); }
  });

  row.querySelector('.milestone-owner-select').addEventListener('change', async (e) => {
    const v = e.target.value || null;
    try { await api.put(`/api/milestones/${m.id}`, { owner_id: v }); m.owner_id = v ? +v : null; }
    catch (err) { alert(err.message); }
  });

  row.querySelector('.milestone-delete-btn').addEventListener('click', async () => {
    try {
      await api.del(`/api/milestones/${m.id}`);
      state.currentMilestones = state.currentMilestones.filter(x => x.id !== m.id);
      renderMilestoneList();
      loadRocks();
    } catch (e) { alert(e.message); }
  });

  return row;
}

qs('#add-milestone-btn').addEventListener('click', async () => {
  const rockId = state.currentMilestoneRockId;
  if (!rockId) return;
  const rock = state.rocks.find(r => r.id === rockId);
  try {
    const m = await api.post(`/api/rocks/${rockId}/milestones`, {
      title: 'New milestone',
      owner_id: rock?.owner_id ?? null,
      sort_order: state.currentMilestones.length,
    });
    state.currentMilestones.push(m);
    renderMilestoneList();
    loadRocks();
    const rows = qsa('#milestones-list .milestone-row');
    const lastInput = rows[rows.length - 1]?.querySelector('.milestone-title-input');
    if (lastInput) { lastInput.focus(); lastInput.select(); }
  } catch (e) { alert(e.message); }
});

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
    goal_id: qs('#rock-goal').value || null,
  };
  // Only send manual progress when there are no milestones — otherwise the
  // server keeps it in sync with milestone completion automatically.
  if ((state.currentMilestones || []).length === 0) {
    body.progress = parseInt(qs('#rock-progress').value);
  }
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
  state.issues = await api.get('/api/issues?include_archived=1');
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

/* Issue owner multiselect (selection persisted to localStorage) */
const ISSUE_OWNER_FILTER_KEY = 'ninety.issueOwnerFilter';
{
  try {
    const saved = JSON.parse(localStorage.getItem(ISSUE_OWNER_FILTER_KEY) || 'null');
    if (Array.isArray(saved)) state.issueOwnerFilter = saved.map(Number).filter(Number.isFinite);
  } catch {}
}
function saveIssueOwnerFilter() {
  try { localStorage.setItem(ISSUE_OWNER_FILTER_KEY, JSON.stringify(state.issueOwnerFilter)); } catch {}
}

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
    saveIssueOwnerFilter();
    updateIssueOwnerFilterLabel();
    renderIssues();
  } else if (e.target.id === 'issue-owner-filter-clear') {
    state.issueOwnerFilter = [];
    saveIssueOwnerFilter();
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
  qs('#issue-modal-title').textContent = issue ? 'Edit To-Do' : 'Add To-Do';
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

  // Populate Rock dropdown — rocks for the current quarter, plus the rock
  // this to-do is already linked to (if it's from a different quarter).
  const rockSel = qs('#issue-rock');
  const goalIndexById = new Map((state.vto?.one_year_goals || []).map((g, i) => [g.id, i + 1]));
  const allRocks = state.rocks || [];
  const cq = currentQuarter();
  const rocksForPicker = [
    ...allRocks.filter(r => r.quarter === cq),
    ...(issue && issue.rock_id && allRocks.find(r => r.id === issue.rock_id && r.quarter !== cq)
        ? [allRocks.find(r => r.id === issue.rock_id)]
        : []),
  ];
  rockSel.innerHTML = '<option value="">— No rock —</option>' +
    rocksForPicker.map(r => {
      const goalNum = r.goal_id ? goalIndexById.get(r.goal_id) : null;
      const prefix = goalNum ? `[Goal ${goalNum}] ` : '';
      const sel = issue && issue.rock_id === r.id ? 'selected' : '';
      return `<option value="${r.id}" ${sel}>${esc(prefix)}${esc(r.title)} · ${esc(r.quarter)}</option>`;
    }).join('');

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
    rock_id: qs('#issue-rock').value ? +qs('#issue-rock').value : null,
  };
  if (!body.title) { qs('#issue-title').focus(); return; }
  try {
    if (id) {
      await api.put(`/api/issues/${id}`, body);
    } else {
      await api.post('/api/issues', body);
    }
    closeModal('issue-modal');
    await loadIssues();
    if (state.runner && state.runner.active) updateRunnerDisplay();
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
    await loadTeamIssues();
    if (state.runner && state.runner.active) updateRunnerDisplay();
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

function resetRunnerScroll() {
  const el = document.querySelector('.runner-content-area');
  if (el) el.scrollTop = 0;
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
      resetRunnerScroll();
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

/* Status priority for the runner to-dos default sort (lower = higher priority). */
const RUNNER_TODO_STATUS_RANK = { blocker: 0, waiting_for: 1, in_progress: 2 };

function renderRunnerTodosPanel(sec) {
  const panel = qs('#runner-todos-panel');
  const list  = qs('#runner-todos-list');
  if (!sec || !sec.shows_todos) { panel.hidden = true; return; }
  panel.hidden = false;

  const attendeeIds = new Set((state.runner.attendees || []).map(a => a.id));

  if (attendeeIds.size === 0) {
    list.innerHTML = '';
    renderRunnerTodosHeader(0, 0);
    list.innerHTML = '<div style="color:var(--text2);font-size:13px;padding:8px 2px">No attendees on this meeting.</div>';
    return;
  }

  // Base set: every attendee's open (non-solved, non-archived) to-dos in the
  // 3 statuses we surface in meetings.
  const allOpen = (state.issues || []).filter(i =>
    attendeeIds.has(i.owner_id)
    && !i.archived
    && (i.status === 'blocker' || i.status === 'waiting_for' || i.status === 'in_progress')
  );

  // Apply status filter chips.
  const filters = state.runner.todoFilters;
  const items = allOpen.filter(i => filters[i.status]);

  // Sort.
  const { col, dir } = state.runner.todoSort;
  const flip = dir === 'desc' ? -1 : 1;
  items.sort((a, b) => {
    if (col === 'status') {
      const sRank = (RUNNER_TODO_STATUS_RANK[a.status] - RUNNER_TODO_STATUS_RANK[b.status]);
      if (sRank !== 0) return sRank * flip;
      // Secondary: owner name (ascending regardless of primary direction)
      return (a.owner_name || '').localeCompare(b.owner_name || '');
    }
    if (col === 'owner') {
      const o = (a.owner_name || '').localeCompare(b.owner_name || '');
      if (o !== 0) return o * flip;
      return RUNNER_TODO_STATUS_RANK[a.status] - RUNNER_TODO_STATUS_RANK[b.status];
    }
    if (col === 'title') {
      return (a.title || '').localeCompare(b.title || '') * flip;
    }
    return 0;
  });

  renderRunnerTodosHeader(items.length, allOpen.length);

  list.innerHTML = '';
  if (items.length === 0) {
    list.innerHTML = '<div style="color:var(--text2);font-size:13px;padding:8px 2px">No to-dos match the current filters.</div>';
    return;
  }

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

function renderRunnerTodosHeader(shown, total) {
  const host = qs('#runner-todos-controls');
  if (!host) return;
  const { col, dir } = state.runner.todoSort;
  const arrow = (c) => col === c ? (dir === 'desc' ? ' ▼' : ' ▲') : '';
  const filters = state.runner.todoFilters;
  const countsByStatus = { blocker: 0, waiting_for: 0, in_progress: 0 };
  const attendeeIds = new Set((state.runner.attendees || []).map(a => a.id));
  (state.issues || []).forEach(i => {
    if (attendeeIds.has(i.owner_id) && !i.archived && countsByStatus[i.status] !== undefined) {
      countsByStatus[i.status]++;
    }
  });

  host.innerHTML = `
    <div class="runner-todos-filters">
      <button type="button" class="runner-todo-filter-chip ${filters.blocker ? 'active' : ''}" data-status="blocker">
        <span class="runner-todo-filter-dot blocker"></span> Blockers (${countsByStatus.blocker})
      </button>
      <button type="button" class="runner-todo-filter-chip ${filters.waiting_for ? 'active' : ''}" data-status="waiting_for">
        <span class="runner-todo-filter-dot waiting_for"></span> Waiting For (${countsByStatus.waiting_for})
      </button>
      <button type="button" class="runner-todo-filter-chip ${filters.in_progress ? 'active' : ''}" data-status="in_progress">
        <span class="runner-todo-filter-dot in_progress"></span> In Progress (${countsByStatus.in_progress})
      </button>
      <span class="runner-todo-count">${shown} of ${total}</span>
    </div>
    <div class="runner-todos-column-header">
      <div></div>
      <button type="button" class="runner-todo-sort-btn" data-col="title">Title${arrow('title')}</button>
      <button type="button" class="runner-todo-sort-btn" data-col="owner">Owner${arrow('owner')}</button>
      <button type="button" class="runner-todo-sort-btn" data-col="status">Status${arrow('status')}</button>
    </div>
  `;

  host.querySelectorAll('.runner-todo-filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = btn.dataset.status;
      state.runner.todoFilters[s] = !state.runner.todoFilters[s];
      updateRunnerDisplay();
    });
  });
  host.querySelectorAll('.runner-todo-sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = btn.dataset.col;
      if (state.runner.todoSort.col === c) {
        state.runner.todoSort.dir = state.runner.todoSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.runner.todoSort.col = c;
        state.runner.todoSort.dir = 'asc';
      }
      updateRunnerDisplay();
    });
  });
}

qs('#runner-add-issue-btn').addEventListener('click', () => {
  // Default the new issue to short_term so it appears in this runner panel.
  state.teamIssueHorizonFilter = 'short_term';
  openTeamIssueModal(null);
});
qs('#runner-add-todo-btn').addEventListener('click', () => {
  openIssueModal(null);
});

qs('#runner-playpause-btn').addEventListener('click', () => {
  state.runner.playing = !state.runner.playing;
  updateRunnerDisplay();
});

qs('#runner-prev-btn').addEventListener('click', () => {
  const r = state.runner;
  if (r.sectionIdx > 0) { r.sectionIdx--; r.sectionElapsed = 0; renderRunnerSidebar(); updateRunnerDisplay(); resetRunnerScroll(); }
});

qs('#runner-next-btn').addEventListener('click', () => {
  const r = state.runner;
  if (r.sectionIdx < r.sections.length - 1) { r.sectionIdx++; r.sectionElapsed = 0; renderRunnerSidebar(); updateRunnerDisplay(); resetRunnerScroll(); }
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

  const [allRocks, allIssues, allMeetings, vto] = await Promise.all([
    api.get('/api/rocks?quarter=' + encodeURIComponent(currentQuarter())),
    api.get('/api/issues'),
    api.get('/api/meetings'),
    api.get('/api/vto').catch(() => null),  // V/TO is optional; render without it on failure
  ]);
  state.my90Vto = vto;

  state.my90Rocks    = allRocks.filter(r => r.owner_id === uid);
  state.my90Issues   = allIssues.filter(i =>
    i.owner_id === uid && !i.archived && i.status !== 'solved'
  );
  state.my90Meetings = allMeetings.filter(m =>
    m.status === 'upcoming' && m.scheduled_at && m.scheduled_at.slice(0, 10) <= in90Str
  );

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

  // ── Vision card ───────────────────────────────────────────────────
  // Pulls Core Values + Core Focus from the V/TO row. Public-readable
  // signal of who we are; everything else V/TO stays private to that tab.
  const vto = state.my90Vto;
  const vals = (vto && vto.core_values) || [];
  const cause = vto && vto.core_focus_purpose;
  const niche = vto && vto.core_focus_niche;
  // Owners + users with 'vto' grant see the link to the full V/TO; everyone
  // else sees the cards (Vision + Goals) but no dead-end button.
  const canOpenVto = state.currentUser?.role === 'owner'
    || (state.currentUser?.tabs || []).includes('vto');
  const openVtoBtn = canOpenVto
    ? `<button class="btn btn-ghost my90-view-all" data-goto="vto">Open V/TO →</button>`
    : '';

  if (vals.length || cause || niche) {
    const visionBox = document.createElement('div');
    visionBox.className = 'card my90-box my90-box--full my90-vision';
    // Lead with the Cause as a centered statement — it's the WHY.
    // Then values as paired blocks. Niche moves into a secondary line below.
    const causeBlock = cause ? `
      <div class="my90-vision-cause">
        <div class="my90-vision-cause-text">${esc(cause)}</div>
        ${niche ? `<div class="my90-vision-niche-text">${esc(niche)}</div>` : ''}
      </div>` : '';
    const valuesBlock = vals.length ? `
      <div class="my90-vision-values">
        ${vals.map(v => `
          <div class="my90-vision-value">
            <div class="my90-vision-value-label">${esc(v.label || '')}</div>
            ${v.description ? `<div class="my90-vision-value-desc">${esc(v.description)}</div>` : ''}
          </div>`).join('')}
      </div>` : '';
    visionBox.innerHTML = `
      <div class="my90-vision-header">
        <span class="my90-vision-eyebrow">Who we are</span>
        ${openVtoBtn}
      </div>
      ${causeBlock}
      ${valuesBlock}
    `;
    grid.appendChild(visionBox);
    visionBox.querySelector('.my90-view-all')?.addEventListener('click', () => goToView('vto'));
  }

  // ── FY27 Goals card ───────────────────────────────────────────────
  // Reads one_year_goals from V/TO. Forward-compatible: when we add
  // rocks.goal_id and issues.rock_id later, this card grows progress
  // bars (rocks done / total + to-dos done / total per goal).
  // owner_ids (array) is preferred; owner_id (single) is the legacy fallback.
  const goalOwners = (g) => {
    const ids = Array.isArray(g.owner_ids) && g.owner_ids.length
      ? g.owner_ids
      : (g.owner_id ? [+g.owner_id] : []);
    return ids.map(id => state.users.find(u => u.id === +id)).filter(Boolean);
  };
  const goals = (vto && vto.one_year_goals) || [];
  if (goals.length) {
    const fyLabel = vto.one_year_future_date
      ? `to ${new Date(vto.one_year_future_date).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`
      : 'this year';
    const goalsBox = document.createElement('div');
    goalsBox.className = 'card my90-box my90-box--full my90-goals';
    goalsBox.innerHTML = `
      <div class="my90-box-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="my90-box-icon">
          <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
        </svg>
        <span class="my90-box-title">Annual Goals</span>
        <span class="my90-box-quarter">${fyLabel}</span>
        <span class="my90-box-count">${goals.length}</span>
        ${openVtoBtn}
      </div>
      <div class="my90-box-body my90-goals-body">
        ${goals.map((g, i) => {
          const owners = goalOwners(g);
          const ownerHtml = owners.length
            ? `<span class="my90-goal-owner">${owners.map(o => esc(o.name.split(' ')[0])).join(' · ')}</span>`
            : '';
          return `
            <div class="my90-goal">
              <div class="my90-goal-num">${i + 1}</div>
              <div class="my90-goal-text">${esc(g.text || '')}</div>
              ${ownerHtml}
            </div>`;
        }).join('')}
      </div>
    `;
    grid.appendChild(goalsBox);
    goalsBox.querySelector('.my90-view-all')?.addEventListener('click', () => goToView('vto'));
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

  // ── Box 2: My To-Dos (split into Public / Private columns) ────────
  const todosBox = document.createElement('div');
  todosBox.className = 'card my90-box my90-box--wide';

  const publicTodos  = state.my90Issues.filter(i => !i.private);
  const privateTodos = state.my90Issues.filter(i =>  i.private);

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
    <div class="my90-todos-columns">
      <div class="my90-todos-col">
        <div class="my90-todos-col-header">
          <span>Public To-Dos</span>
          <span class="my90-todos-col-count">${publicTodos.length}</span>
        </div>
        <div class="my90-todos-col-body" data-visibility="public"></div>
      </div>
      <div class="my90-todos-col my90-todos-col--private">
        <div class="my90-todos-col-header">
          <span>Private To-Dos</span>
          <span class="my90-todos-col-count">${privateTodos.length}</span>
        </div>
        <div class="my90-todos-col-body" data-visibility="private"></div>
      </div>
    </div>
  `;

  const fillColumn = (bodyEl, items) => {
    if (items.length === 0) {
      bodyEl.innerHTML = `<div class="my90-empty">None</div>`;
      return;
    }
    items.forEach(issue => {
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
      bodyEl.appendChild(row);
    });
  };

  fillColumn(todosBox.querySelector('[data-visibility="public"]'),  publicTodos);
  fillColumn(todosBox.querySelector('[data-visibility="private"]'), privateTodos);

  todosBox.querySelector('.my90-view-all').addEventListener('click', () => goToView('issues'));
  grid.appendChild(todosBox);

  // ── Box 3: Upcoming Meetings ──────────────────────────────────────
  const meetingsBox = document.createElement('div');
  meetingsBox.className = 'card my90-box my90-box--full';

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
  filtered
    .filter(i => i.status === 'solved')
    .forEach(i => { const n = i.owner_name || 'Unassigned'; om[n] = (om[n] || 0) + 1; });
  const oNames = Object.keys(om);
  state.insightCharts['todos-owner'] = new Chart(qs('#chart-todos-owner').getContext('2d'), {
    type: 'bar',
    data: { labels: oNames,
      datasets: [{ label: 'Solved To-Dos', data: oNames.map(n => om[n]),
        backgroundColor: '#10b981', hoverBackgroundColor: '#34d399', borderRadius: 4, borderSkipped: false }] },
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

/* ════════════════════════════════════════════════════════════════════
   STELLA  (coaching tab — read-only view of daily-reflection calls)
   ════════════════════════════════════════════════════════════════════ */

const stellaState = {
  offset: 0, pageSize: 20, hasMore: false, filterMissed: false,
  // When a heatmap cell is clicked we stash its date here; loadStella then
  // re-heroes that day's call instead of the latest.
  heroDate: null,
  // Cache of recent calls (latest page) for hero lookups without refetching.
  recentCalls: [],
};

async function loadStella() {
  qs('#stella-settings-gate').style.display = 'none';
  qs('#stella-stats').innerHTML    = '<div class="stella-loading">Loading stats…</div>';
  qs('#stella-hero').innerHTML     = '';
  qs('#stella-timeline').innerHTML = '<div class="stella-loading">Loading timeline…</div>';
  qs('#stella-pager').innerHTML    = '';

  // Gate: if coaching isn't enabled for this user, show onboarding card and stop.
  let settings;
  try { settings = await api.get('/api/coaching/settings'); } catch { settings = null; }
  if (!settings || !settings.coaching_enabled) {
    qs('#stella-stats').innerHTML = '';
    qs('#stella-timeline').innerHTML = '';
    const gate = qs('#stella-settings-gate');
    gate.style.display = '';
    gate.innerHTML = `
      <h2>Welcome to Stella</h2>
      <p>Stella is your daily reflection coach. She captures your commitments and gratitude from each call, and syncs them here as private To-Dos.</p>
      <p class="form-hint">To get started, enable Stella and enter the phone number your admin has assigned you.</p>
      <button class="btn btn-primary" id="stella-open-settings-from-gate">Enable Stella</button>
    `;
    qs('#stella-open-settings-from-gate').addEventListener('click', openStellaSettings);
    return;
  }

  try {
    const [stats, page, calendar] = await Promise.all([
      api.get('/api/coaching/stats'),
      api.get(`/api/coaching/calls?limit=${stellaState.pageSize}&offset=${stellaState.offset}`),
      api.get('/api/coaching/calendar?days=365'),
    ]);
    renderStellaStats(stats);
    stellaState.recentCalls = page.calls;
    renderStellaHeatmap(calendar);
    // Pick hero: if a heatmap cell was selected, use that day. Otherwise latest.
    const heroCall = (stellaState.heroDate)
      ? await pickHeroCall(stellaState.heroDate, page.calls)
      : (page.calls[0] || null);
    renderStellaHero(heroCall);
    stellaState.hasMore = !!page.has_more;
    renderStellaTimeline(page.calls.slice(page.calls[0] === heroCall ? 1 : 0));
    renderStellaPager();
  } catch (e) {
    qs('#stella-timeline').innerHTML = `<div class="empty-state"><p>Couldn't load Stella data: ${esc(e.message)}</p></div>`;
  }
}

// Fetch a call for a given date — try the recent cache first, fall back to
// scanning older pages if the user picked a day off-screen.
async function pickHeroCall(isoDate, recent) {
  const match = (c) => String(c.call_date).slice(0, 10) === isoDate;
  const cached = recent.find(match);
  if (cached) return cached;
  // Slow path: widen the window until we find the day or exhaust history.
  for (let offset = 0; offset < 400; offset += 100) {
    const p = await api.get(`/api/coaching/calls?limit=100&offset=${offset}`);
    const hit = p.calls.find(match);
    if (hit) return hit;
    if (!p.has_more) break;
  }
  return null;
}

// Render a GitHub-contributions-style grid for the last N days. Cells are
// weeks (columns) × days-of-week (rows), walking backwards from today.
function renderStellaHeatmap(calendar) {
  const wrap = qs('#stella-heatmap-wrap');
  if (!calendar || !Array.isArray(calendar.days)) { wrap.innerHTML = ''; return; }
  const byDate = Object.fromEntries((calendar.days || []).map(d => [d.date, d]));

  // Build an ordered list of dates ending today, going back 52 weeks + partial.
  // Align so the last column's rightmost row is today.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  // Walk back so the grid starts on a Sunday 52 weeks + (todayDow) days ago.
  const totalDays = 52 * 7 + (today.getDay() + 1); // +1 so today is included
  const start = new Date(today);
  start.setDate(start.getDate() - (totalDays - 1));
  // Snap to previous Sunday so rows line up.
  start.setDate(start.getDate() - start.getDay());

  const days = [];
  const cur = new Date(start);
  while (cur <= today) {
    const iso = cur.toISOString().slice(0, 10);
    days.push({ iso, d: new Date(cur), info: byDate[iso] || null });
    cur.setDate(cur.getDate() + 1);
  }
  // Group into weeks (columns), 7 per column
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  // Month labels: print the month name at the first week whose Sunday is in
  // that month (and only when it changes).
  let lastMonth = -1;
  const monthLabels = weeks.map((w, idx) => {
    const first = w[0];
    const m = first.d.getMonth();
    if (m !== lastMonth) {
      lastMonth = m;
      return { idx, label: first.d.toLocaleDateString(undefined, { month: 'short' }) };
    }
    return null;
  }).filter(Boolean);

  const intensity = (info) => {
    if (!info || !info.calls) return 0;
    if (info.commitments === 0) return 1;
    // Gradient by commitment-completion
    const r = info.completed / Math.max(info.commitments, 1);
    if (r >= 1) return 4;
    if (r >= 0.5) return 3;
    return 2;
  };

  const todayIso = today.toISOString().slice(0, 10);
  const selectedIso = stellaState.heroDate;

  const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

  const cells = weeks.map((w, col) => {
    const cellRows = [0, 1, 2, 3, 4, 5, 6].map(row => {
      const cell = w[row];
      if (!cell) return '<rect class="stella-hm-cell stella-hm-empty" x="0" y="0" width="0" height="0"/>';
      const lvl   = intensity(cell.info);
      const isToday = cell.iso === todayIso;
      const isSel   = cell.iso === selectedIso;
      const hasCall = !!cell.info;
      const tt = cell.info
        ? `${formatDateLong(cell.iso)} · ${cell.info.calls} call${cell.info.calls===1?'':'s'} · ${cell.info.completed}/${cell.info.commitments} done`
        : `${formatDateLong(cell.iso)} · no call`;
      const x = col * 14, y = row * 14;
      return `<rect class="stella-hm-cell lvl-${lvl}${isToday ? ' is-today' : ''}${isSel ? ' is-selected' : ''}"
                data-date="${cell.iso}" ${hasCall ? 'data-has-call="1"' : ''}
                x="${x}" y="${y}" width="11" height="11" rx="2" ry="2">
                <title>${esc(tt)}</title>
              </rect>`;
    }).join('');
    return cellRows;
  }).join('');

  const gridW = weeks.length * 14 + 2;
  const gridH = 7 * 14 + 2;

  const labelsHtml = monthLabels.map(m =>
    `<text class="stella-hm-monthlabel" x="${m.idx * 14}" y="10">${esc(m.label)}</text>`
  ).join('');
  const dayLabelsHtml = dayLabels.map((lbl, i) =>
    lbl ? `<text class="stella-hm-daylabel" x="-6" y="${i * 14 + 9}" text-anchor="end">${esc(lbl)}</text>` : ''
  ).join('');

  const sel = stellaState.heroDate
    ? `<button class="btn btn-ghost btn-small" id="stella-hm-clear">✕ Clear (${formatDateShort(stellaState.heroDate)})</button>`
    : '';

  wrap.innerHTML = `
    <div class="stella-hm-header">
      <h2>Your year with Stella</h2>
      <div class="stella-hm-right">
        ${sel}
        <span class="stella-hm-scale">Less
          <span class="stella-hm-cell lvl-0"></span>
          <span class="stella-hm-cell lvl-1"></span>
          <span class="stella-hm-cell lvl-2"></span>
          <span class="stella-hm-cell lvl-3"></span>
          <span class="stella-hm-cell lvl-4"></span>
        More</span>
      </div>
    </div>
    <div class="stella-hm-scroll">
      <svg viewBox="-24 -16 ${gridW + 28} ${gridH + 22}" preserveAspectRatio="xMinYMin meet" class="stella-hm-svg">
        <g>${labelsHtml}</g>
        <g>${dayLabelsHtml}</g>
        <g transform="translate(0,0)">${cells}</g>
      </svg>
    </div>
  `;

  wrap.querySelectorAll('[data-has-call="1"]').forEach(el => {
    el.addEventListener('click', () => {
      const d = el.getAttribute('data-date');
      stellaState.heroDate = (stellaState.heroDate === d) ? null : d;
      loadStella();
    });
  });
  const clearBtn = qs('#stella-hm-clear');
  if (clearBtn) clearBtn.addEventListener('click', () => { stellaState.heroDate = null; loadStella(); });
}

async function openStellaSettings() {
  const msg = qs('#stella-settings-msg');
  if (msg) { msg.textContent = ''; msg.className = 'form-msg'; }
  try {
    const s = await api.get('/api/coaching/settings');
    qs('#stella-enable-toggle').checked = !!s.coaching_enabled;
    qs('#stella-phone').value = s.coaching_phone || '';
  } catch {
    qs('#stella-enable-toggle').checked = false;
    qs('#stella-phone').value = '';
  }
  qs('#stella-settings-modal').classList.add('active');
}

async function saveStellaSettings() {
  const msg = qs('#stella-settings-msg');
  const btn = qs('#stella-settings-save');
  const enabled = qs('#stella-enable-toggle').checked;
  const phone   = qs('#stella-phone').value.trim();
  btn.disabled = true;
  msg.textContent = 'Saving…'; msg.className = 'form-msg';
  try {
    await api.put('/api/coaching/settings', { coaching_enabled: enabled, coaching_phone: phone });
    msg.textContent = 'Saved.'; msg.className = 'form-msg form-msg-ok';
    setTimeout(() => { closeModal('stella-settings-modal'); loadStella(); }, 400);
  } catch (e) {
    msg.textContent = e.message; msg.className = 'form-msg form-msg-err';
  } finally {
    btn.disabled = false;
  }
}

qs('#stella-settings-btn')?.addEventListener('click', openStellaSettings);
qs('#stella-settings-save')?.addEventListener('click', saveStellaSettings);

function renderStellaStats(s) {
  const { calls, streak_days, completion } = s;
  const box = (label, value, sub) =>
    `<div class="stella-stat"><div class="stella-stat-label">${label}</div>`
    + `<div class="stella-stat-value">${value}</div>`
    + (sub ? `<div class="stella-stat-sub">${sub}</div>` : '')
    + '</div>';
  const pct = (w) => completion[w].pct == null
    ? '—'
    : `${completion[w].pct}% <span class="stella-stat-sub">(${completion[w].done}/${completion[w].total})</span>`;
  qs('#stella-stats').innerHTML = [
    box('Streak', `${streak_days}🔥`, streak_days === 1 ? 'day' : 'days'),
    box('Calls (7d)',  calls.calls_7d,  `${calls.calls_30d} in 30d`),
    box('Done (7d)',   pct('last_7d'),  'commitments completed'),
    box('Done (30d)',  pct('last_30d'), 'commitments completed'),
    box('Done (90d)',  pct('last_90d'), 'commitments completed'),
  ].join('');
}

function renderStellaHero(call) {
  if (!call) {
    qs('#stella-hero').innerHTML = '<div class="stella-hero-empty">No calls yet. Make your first call to Stella and it\'ll show up here.</div>';
    return;
  }
  const commitsHtml = renderCommitmentList(call.commitments, true);
  const gratitude = call.gratitude ? `<div class="stella-hero-section"><h3>Gratitude</h3><div class="stella-gratitude">${esc(call.gratitude)}</div></div>` : '';
  const summary   = call.summary   ? `<div class="stella-hero-section"><h3>Summary</h3><p>${esc(call.summary)}</p></div>` : '';
  qs('#stella-hero').innerHTML = `
    <div class="stella-hero-header">
      <div>
        <div class="stella-hero-eyebrow">Latest call</div>
        <div class="stella-hero-date">${formatDateLong(call.call_date)}</div>
      </div>
      <button class="btn btn-ghost btn-small" data-view-transcript="${call.id}">View transcript</button>
    </div>
    <div class="stella-hero-section">
      <h3>Commitments</h3>
      ${commitsHtml}
    </div>
    ${gratitude}
    ${summary}
  `;
}

function renderCommitmentList(commits, withToggle) {
  if (!commits || !commits.length) return '<p class="stella-empty-inline">(no commitments from this call)</p>';
  const rows = commits.map(c => {
    const done = c.completed;
    const cls = done ? 'stella-commit done' : 'stella-commit';
    const toggle = withToggle
      ? `<button class="stella-check" data-toggle-commit="${c.id}" data-done="${done ? '1' : '0'}" aria-label="${done ? 'Mark open' : 'Mark done'}">${done ? '✓' : ''}</button>`
      : `<span class="stella-check-static">${done ? '✓' : '○'}</span>`;
    const due = c.due_date ? `<span class="stella-commit-meta">${formatDateShort(c.due_date)}</span>` : '';
    const pri = c.priority && c.priority !== 'medium' ? `<span class="stella-badge pri-${c.priority}">${c.priority}</span>` : '';
    return `<div class="${cls}">${toggle}<div class="stella-commit-title">${esc(c.title)}</div>${pri}${due}</div>`;
  });
  return rows.join('');
}

function renderStellaTimeline(calls) {
  const list = qs('#stella-timeline');
  const filter = stellaState.filterMissed;
  const filtered = filter
    ? calls.filter(c => (c.commitments || []).some(x => !x.completed))
    : calls;
  if (!filtered.length) {
    list.innerHTML = '<div class="stella-empty-inline">No earlier calls on this page.</div>';
    return;
  }
  list.innerHTML = filtered.map(c => {
    const commits = (c.commitments || []);
    const done = commits.filter(x => x.completed).length;
    const statusLine = commits.length
      ? `${done}/${commits.length} commitment${commits.length === 1 ? '' : 's'} done`
      : 'no commitments';
    return `
      <details class="stella-entry">
        <summary>
          <span class="stella-entry-date">${formatDateShort(c.call_date)}</span>
          <span class="stella-entry-status">${statusLine}</span>
          <span class="stella-entry-summary">${c.summary ? esc(truncate(c.summary, 100)) : '(no summary)'}</span>
        </summary>
        <div class="stella-entry-body">
          ${commits.length ? `<h4>Commitments</h4>${renderCommitmentList(commits, true)}` : ''}
          ${c.gratitude ? `<h4>Gratitude</h4><div class="stella-gratitude">${esc(c.gratitude)}</div>` : ''}
          ${c.summary ? `<h4>Summary</h4><p>${esc(c.summary)}</p>` : ''}
          <button class="btn btn-ghost btn-small" data-view-transcript="${c.id}">View transcript</button>
        </div>
      </details>
    `;
  }).join('');
}

function renderStellaPager() {
  const pager = qs('#stella-pager');
  const { offset, pageSize, hasMore } = stellaState;
  if (offset === 0 && !hasMore) { pager.innerHTML = ''; return; }
  const prev = offset > 0
    ? `<button class="btn btn-ghost btn-small" id="stella-prev">← Newer</button>`
    : `<button class="btn btn-ghost btn-small" disabled>← Newer</button>`;
  const next = hasMore
    ? `<button class="btn btn-ghost btn-small" id="stella-next">Older →</button>`
    : `<button class="btn btn-ghost btn-small" disabled>Older →</button>`;
  const from = offset + 1;
  pager.innerHTML = `${prev}<span class="stella-pager-info">Page ${Math.floor(offset / pageSize) + 1}</span>${next}`;
  if (offset > 0) qs('#stella-prev').addEventListener('click', () => { stellaState.offset = Math.max(0, offset - pageSize); loadStella(); });
  if (hasMore)    qs('#stella-next').addEventListener('click', () => { stellaState.offset += pageSize; loadStella(); });
}

/* Commitment check-off + transcript modal + filter */
document.addEventListener('click', async (e) => {
  const t = e.target;
  if (t.matches('[data-toggle-commit]')) {
    const id   = t.dataset.toggleCommit;
    const done = t.dataset.done === '1';
    t.disabled = true;
    try {
      await api.put(`/api/issues/${id}`, { status: done ? 'in_progress' : 'solved' });
      loadStella();
    } catch (err) { alert('Could not update: ' + err.message); t.disabled = false; }
  }
  if (t.matches('[data-view-transcript]')) {
    const id = t.dataset.viewTranscript;
    try {
      const call = await api.get(`/api/coaching/calls/${id}`);
      openStellaTranscript(call);
    } catch (err) { alert('Could not load transcript: ' + err.message); }
  }
});
qs('#stella-filter-missed')?.addEventListener('change', (e) => {
  stellaState.filterMissed = e.target.checked;
  loadStella();
});

function openStellaTranscript(call) {
  const existing = qs('#stella-transcript-modal');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id = 'stella-transcript-modal';
  el.className = 'modal-overlay';
  el.innerHTML = `
    <div class="modal modal-large">
      <div class="modal-header">
        <h3>Transcript — ${formatDateLong(call.call_date)}</h3>
        <button class="modal-close">✕</button>
      </div>
      <div class="modal-body">
        <pre class="stella-transcript">${esc(call.transcript || '(no transcript stored)')}</pre>
      </div>
    </div>`;
  document.body.appendChild(el);
  const close = () => el.remove();
  el.querySelector('.modal-close').addEventListener('click', close);
  el.addEventListener('click', (ev) => { if (ev.target === el) close(); });
}

// DB ships call_date as either 'YYYY-MM-DD' (from Postgres DATE type) or a
// full timestamp. Extract just the date portion and format in UTC so we render
// the date the server stored, not whatever the browser's local TZ shifts it to.
function _dateOnly(d) {
  if (!d) return null;
  const s = String(d);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}
function formatDateShort(d) {
  const dt = _dateOnly(d); if (!dt) return '';
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function formatDateLong(d) {
  const dt = _dateOnly(d); if (!dt) return '';
  return dt.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

/* ── V/TO (Vision / Traction Organizer) ──────────────────────────── */
/* Single-doc editor. Six vision sections, each with a display mode and
   an inline edit form. State: state.vto holds the row; state.vtoEditing
   holds the section key currently in edit mode (null = all in display).

   Data shape coming from /api/vto (single row, always present):
     core_values           : [{ label, description }]
     core_focus_purpose    : string
     core_focus_niche      : string
     ten_year_target       : string
     ten_year_measurables  : [{ label, value }]
     target_market         : string
     three_uniques         : [string, string, string]  (exactly 3 in practice)
     proven_process        : string
     guarantee             : string
     three_year_*          : future_date (YYYY-MM-DD), revenue, profit,
                             measurables [{label,value}], looks_like [string]
     one_year_*            : future_date, revenue, profit,
                             measurables [{label,value}], goals [{ text, owner_id }]
*/

const VTO_SECTIONS = [
  'core_values', 'core_focus', 'ten_year',
  'marketing_strategy', 'three_year', 'one_year',
];

async function loadVto() {
  state.vto = await api.get('/api/vto');
  state.vtoEditing = null;
  renderVto();
  // Wire the Print button to open the branded standalone page. ?auto=1
  // makes the new tab trigger its own print dialog once the fonts load.
  const printBtn = qs('#vto-print-btn');
  if (printBtn) {
    printBtn.onclick = () => window.open('/vto-print.html?auto=1', '_blank');
  }
}

async function saveVtoSection(patch) {
  state.vto = await api.put('/api/vto', patch);
  state.vtoEditing = null;
  renderVto();
}

function renderVto() {
  if (!state.vto) return;
  // "Last updated" header
  const u = qs('#vto-last-updated');
  if (u) {
    u.textContent = state.vto.updated_at
      ? `Last updated ${new Date(state.vto.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
      : '';
  }
  renderVtoCoreValues();
  renderVtoCoreFocus();
  renderVtoTenYear();
  renderVtoMarketingStrategy();
  renderVtoThreeYear();
  renderVtoOneYear();
  wireVtoEditButtons();
}

function wireVtoEditButtons() {
  qsa('#view-vto .vto-edit-btn').forEach(btn => {
    btn.onclick = () => {
      const section = btn.dataset.section;
      state.vtoEditing = state.vtoEditing === section ? null : section;
      renderVto();
    };
  });
  qsa('#view-vto .vto-section-link').forEach(card => {
    card.onclick = () => {
      const target = card.dataset.linkView;
      const navBtn = qs(`.nav-item[data-view="${target}"]`);
      if (navBtn) navBtn.click();
    };
  });
}

/* ── Display helpers ───────────────────────────── */
function emptyText(s) {
  const el = document.createElement('p');
  el.className = 'vto-empty-field';
  el.textContent = s;
  return el;
}

function labelValueRow(label, value) {
  const row = document.createElement('div');
  row.className = 'vto-lv-row';
  const l = document.createElement('span'); l.className = 'vto-lv-label'; l.textContent = label;
  const v = document.createElement('span'); v.className = 'vto-lv-value'; v.textContent = value || '—';
  row.append(l, v);
  return row;
}

function bulletList(items, className) {
  const ul = document.createElement('ul');
  ul.className = className || 'vto-bullets';
  items.forEach(item => {
    const li = document.createElement('li');
    li.textContent = item;
    ul.appendChild(li);
  });
  return ul;
}

/* ── Core Values ───────────────────────────────── */
function renderVtoCoreValues() {
  const body = qs('#vto-core-values-body');
  body.innerHTML = '';
  const list = state.vto.core_values || [];

  if (state.vtoEditing === 'core_values') {
    const form = document.createElement('div');
    form.className = 'vto-edit-form';
    const listWrap = document.createElement('div'); listWrap.className = 'vto-dyn-list';
    const draft = list.length ? [...list] : [{ label: '', description: '' }];

    const repaint = () => {
      listWrap.innerHTML = '';
      draft.forEach((v, i) => {
        const row = document.createElement('div'); row.className = 'vto-dyn-row';
        const label = document.createElement('input');
        label.type = 'text'; label.placeholder = 'Value (e.g. Integrity)';
        label.value = v.label || '';
        label.className = 'input vto-dyn-main';
        label.oninput = () => { draft[i].label = label.value; };
        const desc = document.createElement('input');
        desc.type = 'text'; desc.placeholder = 'Short description (optional)';
        desc.value = v.description || '';
        desc.className = 'input';
        desc.oninput = () => { draft[i].description = desc.value; };
        const rm = document.createElement('button');
        rm.type = 'button'; rm.className = 'btn btn-ghost btn-sm vto-dyn-remove';
        rm.textContent = '×';
        rm.onclick = () => { draft.splice(i, 1); repaint(); };
        row.append(label, desc, rm);
        listWrap.appendChild(row);
      });
    };
    repaint();

    const add = document.createElement('button');
    add.type = 'button'; add.className = 'btn btn-ghost btn-sm';
    add.textContent = '+ Add value';
    add.onclick = () => { draft.push({ label: '', description: '' }); repaint(); };

    form.append(listWrap, add, vtoFormActions('core_values', () => {
      const cleaned = draft.map(v => ({
        label: (v.label || '').trim(),
        description: (v.description || '').trim(),
      })).filter(v => v.label);
      return { core_values: cleaned };
    }));
    body.appendChild(form);
    return;
  }

  if (!list.length) { body.appendChild(emptyText('No core values yet.')); return; }
  const wrap = document.createElement('div'); wrap.className = 'vto-values-list';
  list.forEach(v => {
    const item = document.createElement('div'); item.className = 'vto-value-item';
    const label = document.createElement('div'); label.className = 'vto-value-label'; label.textContent = v.label;
    item.appendChild(label);
    if (v.description) {
      const desc = document.createElement('div'); desc.className = 'vto-value-desc'; desc.textContent = v.description;
      item.appendChild(desc);
    }
    wrap.appendChild(item);
  });
  body.appendChild(wrap);
}

/* ── Core Focus ────────────────────────────────── */
function renderVtoCoreFocus() {
  const body = qs('#vto-core-focus-body');
  body.innerHTML = '';

  if (state.vtoEditing === 'core_focus') {
    const form = document.createElement('div'); form.className = 'vto-edit-form';
    form.append(
      vtoTextareaField('Purpose / Cause / Passion', 'core_focus_purpose_input', state.vto.core_focus_purpose, 'Why we exist — the purpose behind the work.'),
      vtoTextareaField('Our Niche', 'core_focus_niche_input', state.vto.core_focus_niche, 'What we do best. The one thing we will build a company around.'),
      vtoFormActions('core_focus', () => ({
        core_focus_purpose: qs('#core_focus_purpose_input').value,
        core_focus_niche:   qs('#core_focus_niche_input').value,
      })),
    );
    body.appendChild(form);
    return;
  }

  body.append(
    vtoDisplayBlock('Purpose / Cause / Passion', state.vto.core_focus_purpose),
    vtoDisplayBlock('Our Niche', state.vto.core_focus_niche),
  );
}

/* ── 10-Year Target ────────────────────────────── */
function renderVtoTenYear() {
  const body = qs('#vto-ten-year-body');
  body.innerHTML = '';

  if (state.vtoEditing === 'ten_year') {
    const form = document.createElement('div'); form.className = 'vto-edit-form';
    form.append(
      vtoTextareaField('Target', 'ten_year_target_input', state.vto.ten_year_target, 'What does success look like 10 years from now?'),
      vtoMeasurablesEditor('ten_year_measurables', state.vto.ten_year_measurables || []),
      vtoFormActions('ten_year', () => ({
        ten_year_target:      qs('#ten_year_target_input').value,
        ten_year_measurables: vtoCollectMeasurables('ten_year_measurables'),
      })),
    );
    body.appendChild(form);
    return;
  }

  body.append(vtoDisplayBlock(null, state.vto.ten_year_target));
  const measurables = state.vto.ten_year_measurables || [];
  if (measurables.length) {
    const mWrap = document.createElement('div'); mWrap.className = 'vto-measurables';
    const h = document.createElement('h4'); h.textContent = 'Measurables'; mWrap.appendChild(h);
    measurables.forEach(m => mWrap.appendChild(labelValueRow(m.label, m.value)));
    body.appendChild(mWrap);
  }
}

/* ── Marketing Strategy ────────────────────────── */
function renderVtoMarketingStrategy() {
  const body = qs('#vto-marketing-strategy-body');
  body.innerHTML = '';

  if (state.vtoEditing === 'marketing_strategy') {
    const form = document.createElement('div'); form.className = 'vto-edit-form';
    const uniques = (state.vto.three_uniques && state.vto.three_uniques.length === 3)
      ? state.vto.three_uniques
      : [...(state.vto.three_uniques || []), '', '', ''].slice(0, 3);

    form.append(
      vtoTextareaField('Target Market / "The List"', 'target_market_input', state.vto.target_market, 'Who you sell to — the demographic, psychographic, geographic profile.'),
      (() => {
        const wrap = document.createElement('div'); wrap.className = 'vto-field';
        const lbl = document.createElement('label'); lbl.textContent = 'Three Uniques';
        wrap.appendChild(lbl);
        uniques.forEach((u, i) => {
          const inp = document.createElement('input');
          inp.type = 'text'; inp.className = 'input';
          inp.id = `three_unique_input_${i}`;
          inp.placeholder = `Unique ${i + 1}`;
          inp.value = u || '';
          wrap.appendChild(inp);
        });
        return wrap;
      })(),
      vtoTextareaField('Proven Process', 'proven_process_input', state.vto.proven_process, 'The branded, repeatable way you deliver your product or service.'),
      vtoTextareaField('Guarantee', 'guarantee_input', state.vto.guarantee, 'What you promise the customer — specific, bold, backed up.'),
      vtoFormActions('marketing_strategy', () => ({
        target_market:   qs('#target_market_input').value,
        three_uniques:   [0, 1, 2].map(i => (qs(`#three_unique_input_${i}`).value || '').trim()).filter(Boolean),
        proven_process:  qs('#proven_process_input').value,
        guarantee:       qs('#guarantee_input').value,
      })),
    );
    body.appendChild(form);
    return;
  }

  body.append(vtoDisplayBlock('Target Market / "The List"', state.vto.target_market));
  const uniques = state.vto.three_uniques || [];
  if (uniques.length) {
    const wrap = document.createElement('div'); wrap.className = 'vto-subsection';
    const h = document.createElement('h4'); h.textContent = 'Three Uniques'; wrap.appendChild(h);
    wrap.appendChild(bulletList(uniques, 'vto-uniques-list'));
    body.appendChild(wrap);
  }
  body.append(
    vtoDisplayBlock('Proven Process', state.vto.proven_process),
    vtoDisplayBlock('Guarantee', state.vto.guarantee),
  );
}

/* ── 3-Year Picture ────────────────────────────── */
function renderVtoThreeYear() {
  const body = qs('#vto-three-year-body');
  body.innerHTML = '';

  if (state.vtoEditing === 'three_year') {
    const form = document.createElement('div'); form.className = 'vto-edit-form';
    form.append(
      vtoDateField('Future Date', 'three_year_future_date_input', state.vto.three_year_future_date),
      vtoInputField('Revenue', 'three_year_revenue_input', state.vto.three_year_revenue, 'e.g. $2.4M'),
      vtoInputField('Profit',  'three_year_profit_input',  state.vto.three_year_profit,  'e.g. $600K'),
      vtoMeasurablesEditor('three_year_measurables', state.vto.three_year_measurables || []),
      vtoStringListEditor('three_year_looks_like', state.vto.three_year_looks_like || [], 'What does it look like?', 'Add a bullet'),
      vtoFormActions('three_year', () => ({
        three_year_future_date:  qs('#three_year_future_date_input').value || null,
        three_year_revenue:      qs('#three_year_revenue_input').value,
        three_year_profit:       qs('#three_year_profit_input').value,
        three_year_measurables:  vtoCollectMeasurables('three_year_measurables'),
        three_year_looks_like:   vtoCollectStringList('three_year_looks_like'),
      })),
    );
    body.appendChild(form);
    return;
  }

  const head = document.createElement('div'); head.className = 'vto-picture-head';
  head.appendChild(labelValueRow('Future Date', formatVtoDate(state.vto.three_year_future_date)));
  head.appendChild(labelValueRow('Revenue',     state.vto.three_year_revenue || '—'));
  head.appendChild(labelValueRow('Profit',      state.vto.three_year_profit  || '—'));
  body.appendChild(head);

  const measurables = state.vto.three_year_measurables || [];
  if (measurables.length) {
    const mWrap = document.createElement('div'); mWrap.className = 'vto-measurables';
    const h = document.createElement('h4'); h.textContent = 'Measurables'; mWrap.appendChild(h);
    measurables.forEach(m => mWrap.appendChild(labelValueRow(m.label, m.value)));
    body.appendChild(mWrap);
  }
  const looks = state.vto.three_year_looks_like || [];
  if (looks.length) {
    const lWrap = document.createElement('div'); lWrap.className = 'vto-subsection';
    const h = document.createElement('h4'); h.textContent = 'What does it look like?'; lWrap.appendChild(h);
    lWrap.appendChild(bulletList(looks));
    body.appendChild(lWrap);
  }
}

/* ── 1-Year Plan ───────────────────────────────── */
function renderVtoOneYear() {
  const body = qs('#vto-one-year-body');
  body.innerHTML = '';

  if (state.vtoEditing === 'one_year') {
    const form = document.createElement('div'); form.className = 'vto-edit-form';
    form.append(
      vtoDateField('Future Date', 'one_year_future_date_input', state.vto.one_year_future_date),
      vtoInputField('Revenue', 'one_year_revenue_input', state.vto.one_year_revenue, 'e.g. $1.5M'),
      vtoInputField('Profit',  'one_year_profit_input',  state.vto.one_year_profit,  'e.g. $300K'),
      vtoMeasurablesEditor('one_year_measurables', state.vto.one_year_measurables || []),
      vtoGoalsEditor(state.vto.one_year_goals || []),
      vtoFormActions('one_year', () => ({
        one_year_future_date:  qs('#one_year_future_date_input').value || null,
        one_year_revenue:      qs('#one_year_revenue_input').value,
        one_year_profit:       qs('#one_year_profit_input').value,
        one_year_measurables:  vtoCollectMeasurables('one_year_measurables'),
        one_year_goals:        vtoCollectGoals(),
      })),
    );
    body.appendChild(form);
    return;
  }

  const head = document.createElement('div'); head.className = 'vto-picture-head';
  head.appendChild(labelValueRow('Future Date', formatVtoDate(state.vto.one_year_future_date)));
  head.appendChild(labelValueRow('Revenue',     state.vto.one_year_revenue || '—'));
  head.appendChild(labelValueRow('Profit',      state.vto.one_year_profit  || '—'));
  body.appendChild(head);

  const measurables = state.vto.one_year_measurables || [];
  if (measurables.length) {
    const mWrap = document.createElement('div'); mWrap.className = 'vto-measurables';
    const h = document.createElement('h4'); h.textContent = 'Measurables'; mWrap.appendChild(h);
    measurables.forEach(m => mWrap.appendChild(labelValueRow(m.label, m.value)));
    body.appendChild(mWrap);
  }
  const goals = state.vto.one_year_goals || [];
  if (goals.length) {
    const gWrap = document.createElement('div'); gWrap.className = 'vto-subsection';
    const h = document.createElement('h4'); h.textContent = 'Goals for the Year'; gWrap.appendChild(h);
    const ul = document.createElement('ul'); ul.className = 'vto-goals-list';
    goals.forEach(g => {
      const li = document.createElement('li');
      const text = document.createElement('span'); text.textContent = g.text || '';
      li.appendChild(text);
      const ownerIds = Array.isArray(g.owner_ids) && g.owner_ids.length
        ? g.owner_ids
        : (g.owner_id ? [+g.owner_id] : []);
      ownerIds.forEach(id => {
        const owner = state.users.find(u => u.id === +id);
        if (!owner) return;
        const tag = document.createElement('span');
        tag.className = 'vto-goal-owner';
        tag.textContent = owner.name;
        li.appendChild(tag);
      });
      ul.appendChild(li);
    });
    gWrap.appendChild(ul);
    body.appendChild(gWrap);
  }
}

/* ── Shared form-builder helpers ───────────────── */
function vtoDisplayBlock(label, text) {
  const wrap = document.createElement('div'); wrap.className = 'vto-display-block';
  if (label) {
    const h = document.createElement('h4'); h.textContent = label; wrap.appendChild(h);
  }
  if (text && text.trim()) {
    const p = document.createElement('p'); p.className = 'vto-display-text';
    p.textContent = text;
    wrap.appendChild(p);
  } else {
    wrap.appendChild(emptyText('—'));
  }
  return wrap;
}

function vtoTextareaField(label, id, value, placeholder) {
  const wrap = document.createElement('div'); wrap.className = 'vto-field';
  const l = document.createElement('label'); l.htmlFor = id; l.textContent = label;
  const t = document.createElement('textarea');
  t.id = id; t.rows = 3; t.className = 'input';
  t.value = value || '';
  if (placeholder) t.placeholder = placeholder;
  wrap.append(l, t);
  return wrap;
}

function vtoInputField(label, id, value, placeholder) {
  const wrap = document.createElement('div'); wrap.className = 'vto-field';
  const l = document.createElement('label'); l.htmlFor = id; l.textContent = label;
  const i = document.createElement('input');
  i.type = 'text'; i.id = id; i.className = 'input';
  i.value = value || '';
  if (placeholder) i.placeholder = placeholder;
  wrap.append(l, i);
  return wrap;
}

function vtoDateField(label, id, value) {
  const wrap = document.createElement('div'); wrap.className = 'vto-field';
  const l = document.createElement('label'); l.htmlFor = id; l.textContent = label;
  const i = document.createElement('input');
  i.type = 'date'; i.id = id; i.className = 'input';
  if (value) i.value = (typeof value === 'string') ? value.slice(0, 10) : '';
  wrap.append(l, i);
  return wrap;
}

function vtoMeasurablesEditor(fieldName, items) {
  const wrap = document.createElement('div'); wrap.className = 'vto-field';
  const l = document.createElement('label'); l.textContent = 'Measurables';
  wrap.appendChild(l);
  const listWrap = document.createElement('div');
  listWrap.className = 'vto-dyn-list';
  listWrap.dataset.field = fieldName;
  const draft = items.length ? items.map(x => ({ ...x })) : [{ label: '', value: '' }];

  const repaint = () => {
    listWrap.innerHTML = '';
    draft.forEach((m, i) => {
      const row = document.createElement('div'); row.className = 'vto-dyn-row';
      const label = document.createElement('input');
      label.type = 'text'; label.placeholder = 'Measurable (e.g. Revenue)';
      label.value = m.label || '';
      label.className = 'input vto-dyn-main';
      label.oninput = () => { draft[i].label = label.value; };
      const value = document.createElement('input');
      value.type = 'text'; value.placeholder = 'Target (e.g. $2.4M)';
      value.value = m.value || '';
      value.className = 'input';
      value.oninput = () => { draft[i].value = value.value; };
      const rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'btn btn-ghost btn-sm vto-dyn-remove';
      rm.textContent = '×';
      rm.onclick = () => { draft.splice(i, 1); repaint(); };
      row.append(label, value, rm);
      listWrap.appendChild(row);
    });
  };
  repaint();
  listWrap._draft = draft;

  const add = document.createElement('button');
  add.type = 'button'; add.className = 'btn btn-ghost btn-sm';
  add.textContent = '+ Add measurable';
  add.onclick = () => { draft.push({ label: '', value: '' }); repaint(); };

  wrap.append(listWrap, add);
  return wrap;
}
function vtoCollectMeasurables(fieldName) {
  const listWrap = qs(`.vto-dyn-list[data-field="${fieldName}"]`);
  if (!listWrap || !listWrap._draft) return [];
  return listWrap._draft
    .map(m => ({ label: (m.label || '').trim(), value: (m.value || '').trim() }))
    .filter(m => m.label || m.value);
}

function vtoStringListEditor(fieldName, items, label, placeholder) {
  const wrap = document.createElement('div'); wrap.className = 'vto-field';
  const l = document.createElement('label'); l.textContent = label;
  wrap.appendChild(l);
  const listWrap = document.createElement('div');
  listWrap.className = 'vto-dyn-list';
  listWrap.dataset.field = fieldName;
  const draft = items.length ? [...items] : [''];

  const repaint = () => {
    listWrap.innerHTML = '';
    draft.forEach((s, i) => {
      const row = document.createElement('div'); row.className = 'vto-dyn-row';
      const inp = document.createElement('input');
      inp.type = 'text'; inp.placeholder = placeholder;
      inp.value = s || '';
      inp.className = 'input vto-dyn-main';
      inp.oninput = () => { draft[i] = inp.value; };
      const rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'btn btn-ghost btn-sm vto-dyn-remove';
      rm.textContent = '×';
      rm.onclick = () => { draft.splice(i, 1); repaint(); };
      row.append(inp, rm);
      listWrap.appendChild(row);
    });
  };
  repaint();
  listWrap._draft = draft;

  const add = document.createElement('button');
  add.type = 'button'; add.className = 'btn btn-ghost btn-sm';
  add.textContent = '+ Add';
  add.onclick = () => { draft.push(''); repaint(); };

  wrap.append(listWrap, add);
  return wrap;
}
function vtoCollectStringList(fieldName) {
  const listWrap = qs(`.vto-dyn-list[data-field="${fieldName}"]`);
  if (!listWrap || !listWrap._draft) return [];
  return listWrap._draft.map(s => (s || '').trim()).filter(Boolean);
}

function vtoGoalsEditor(goals) {
  const wrap = document.createElement('div'); wrap.className = 'vto-field';
  const l = document.createElement('label'); l.textContent = 'Goals for the Year';
  wrap.appendChild(l);
  const listWrap = document.createElement('div');
  listWrap.className = 'vto-dyn-list';
  listWrap.dataset.field = 'one_year_goals';
  // Each goal carries an owner_ids array. Legacy single owner_id is migrated in.
  const initOwnerIds = (g) => {
    if (Array.isArray(g.owner_ids) && g.owner_ids.length) return g.owner_ids.map(id => +id);
    if (g.owner_id) return [+g.owner_id];
    return [];
  };
  const draft = goals.length
    ? goals.map(g => ({ text: g.text || '', owner_ids: initOwnerIds(g) }))
    : [{ text: '', owner_ids: [] }];

  const repaint = () => {
    listWrap.innerHTML = '';
    draft.forEach((g, i) => {
      const row = document.createElement('div'); row.className = 'vto-dyn-row vto-dyn-row--goal';

      const text = document.createElement('input');
      text.type = 'text'; text.placeholder = 'Goal for the year';
      text.value = g.text || '';
      text.className = 'input vto-dyn-main';
      text.oninput = () => { draft[i].text = text.value; };

      const ownersWrap = document.createElement('div');
      ownersWrap.className = 'vto-owner-chips';
      const ownersLabel = document.createElement('span');
      ownersLabel.className = 'vto-owner-chips-label';
      ownersLabel.textContent = 'Owners:';
      ownersWrap.appendChild(ownersLabel);
      state.users.forEach(u => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'vto-owner-chip' + (g.owner_ids.includes(u.id) ? ' selected' : '');
        chip.textContent = u.name;
        chip.onclick = () => {
          const idx = draft[i].owner_ids.indexOf(u.id);
          if (idx >= 0) draft[i].owner_ids.splice(idx, 1);
          else draft[i].owner_ids.push(u.id);
          chip.classList.toggle('selected');
        };
        ownersWrap.appendChild(chip);
      });

      const rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'btn btn-ghost btn-sm vto-dyn-remove';
      rm.textContent = '×';
      rm.onclick = () => { draft.splice(i, 1); repaint(); };

      row.append(text, ownersWrap, rm);
      listWrap.appendChild(row);
    });
  };
  repaint();
  listWrap._draft = draft;

  const add = document.createElement('button');
  add.type = 'button'; add.className = 'btn btn-ghost btn-sm';
  add.textContent = '+ Add goal';
  add.onclick = () => { draft.push({ text: '', owner_ids: [] }); repaint(); };

  wrap.append(listWrap, add);
  return wrap;
}
function vtoCollectGoals() {
  const listWrap = qs('.vto-dyn-list[data-field="one_year_goals"]');
  if (!listWrap || !listWrap._draft) return [];
  return listWrap._draft
    .map(g => {
      const ids = (g.owner_ids || []).map(x => +x).filter(Boolean);
      return {
        text: (g.text || '').trim(),
        owner_ids: ids,
        owner_id: ids[0] || null,  // backward compat with consumers reading owner_id
      };
    })
    .filter(g => g.text);
}

function vtoFormActions(section, buildPatch) {
  const actions = document.createElement('div'); actions.className = 'vto-form-actions';
  const save = document.createElement('button');
  save.type = 'button'; save.className = 'btn btn-primary btn-sm';
  save.textContent = 'Save';
  save.onclick = async () => {
    save.disabled = true;
    try { await saveVtoSection(buildPatch()); }
    catch (e) { alert('Save failed: ' + e.message); save.disabled = false; }
  };
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'btn btn-ghost btn-sm';
  cancel.textContent = 'Cancel';
  cancel.onclick = () => { state.vtoEditing = null; renderVto(); };
  actions.append(save, cancel);
  return actions;
}

function formatVtoDate(d) {
  if (!d) return '—';
  const s = typeof d === 'string' ? d.slice(0, 10) : '';
  if (!s) return '—';
  const [y, m, day] = s.split('-').map(Number);
  if (!y) return '—';
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* ── Budget (owner-only) ─────────────────────────────────────────── */
/* Monthly grid for a fiscal year. Rows are budget_lines, columns are the 12
   months + a Total. Each monthly cell renders two values: budget (top,
   inline-editable) and actual (bottom, read-only, populated by QB sync).
   Sections (Income / COGS / OpEx / Other) get header rows + subtotal rows. */

const BUDGET_SECTION_LABELS = {
  income: 'Income',
  cogs:   'Cost of Goods Sold',
  opex:   'Operating Expenses',
  other:  'Other',
};
const BUDGET_SECTION_ORDER = ['income', 'cogs', 'opex', 'other'];

function fiscalYearMonths(fy) {
  // FY27 = May 2026 → April 2027. FY<NN> starts May of (2000 + NN - 1).
  const n = parseInt(String(fy).replace(/\D/g, ''), 10);
  if (!Number.isFinite(n)) return [];
  const startYear = 2000 + n - 1;
  const months = [];
  for (let i = 0; i < 12; i++) {
    const m = (4 + i) % 12;
    const y = startYear + Math.floor((4 + i) / 12);
    months.push({
      year:   y,
      month0: m,                                               // 0-indexed
      period: `${y}-${String(m + 1).padStart(2, '0')}-01`,     // ISO first-of-month
      label:  new Date(y, m, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
    });
  }
  return months;
}

function budgetFiscalYearOptions() {
  // Offer FY26..FY29 for now. Small, hand-curated — avoids auto-drift.
  return ['FY26', 'FY27', 'FY28', 'FY29'];
}

function budgetCellsFor(lineId) {
  const out = {};
  state.budget.cells.forEach(c => {
    if (c.line_id === lineId) out[String(c.period_date).slice(0, 10)] = c;
  });
  return out;
}

function fmtMoney(n) {
  if (n == null || n === '') return '—';
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  if (num === 0) return '$0';
  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  if (abs >= 1000) return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}
function parseMoneyInput(str) {
  if (str == null) return 0;
  const s = String(str).trim().replace(/[\$,\s]/g, '');
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

// Classify any (budget, actual) pair against a section so the UI can paint
// it green/red. Good direction is section-specific:
//   Income  → higher is better (actual ≥ 90% of budget = favorable)
//   Expense → lower  is better (actual ≤ 110% of budget = favorable)
// Within ±10% either way counts as on-plan (still green). Returns null
// when there's nothing meaningful to compare (no actual yet, or both zero).
// Operating-profit-style totals use section='income' — higher is better.
function variancePaintRaw(section, budget, actual) {
  if (actual == null) return null;
  const b = Number(budget) || 0;
  const a = Number(actual) || 0;
  if (b === 0 && a === 0) return null;
  if (b === 0) return 'unfavorable'; // unbudgeted spend / unbudgeted revenue both flag
  const isRevenue = section === 'income';
  if (isRevenue) return a < b * 0.9  ? 'unfavorable' : 'favorable';
  return                a > b * 1.1 ? 'unfavorable' : 'favorable';
}
function variancePaint(line, cell) {
  if (!cell) return null;
  return variancePaintRaw(line.section, cell.budget_amount, cell.actual_amount);
}
function varianceTitleRaw(budget, actual, sourceHint) {
  const src = sourceHint ? `Actual source: ${sourceHint}` : '';
  if (actual == null) return src;
  const b = Number(budget) || 0;
  if (b === 0) return `${src}${src ? ' · ' : ''}No budget set`;
  const pct = ((Number(actual) - b) / b) * 100;
  const sign = pct > 0 ? '+' : '';
  return `${src}${src ? ' · ' : ''}Variance ${sign}${pct.toFixed(1)}% vs budget`;
}
function varianceTitle(line, cell) {
  if (!cell) return '';
  return varianceTitleRaw(cell.budget_amount, cell.actual_amount, cell.actual_source);
}

// Two-line static cell (budget on top, actual underneath, variance-painted).
// Used for section subtotals, row totals, and the Operating Profit row —
// anywhere we need to display budget vs actual without editability.
// hasActual controls whether the actual slot shows a number or "—".
function dualCell(section, budget, actual, hasActual) {
  const wrap = document.createElement('div'); wrap.className = 'budget-cell';
  const b = document.createElement('div'); b.className = 'budget-cell-budget-display';
  b.textContent = budget ? fmtMoney(budget) : '—';
  const a = document.createElement('div'); a.className = 'budget-cell-actual';
  if (hasActual) {
    a.textContent = fmtMoney(actual);
    const paint = variancePaintRaw(section, budget, actual);
    if (paint) a.classList.add(paint);
    a.title = varianceTitleRaw(budget, actual, '');
  } else {
    a.textContent = '—';
  }
  wrap.append(b, a);
  return wrap;
}

async function loadBudget() {
  populateBudgetFySelect();
  const [data, qbStatus] = await Promise.all([
    api.get(`/api/budget?fiscal_year=${encodeURIComponent(state.budgetFiscalYear)}`),
    api.get('/api/quickbooks/status').catch(() => ({ configured: false, connected: false })),
  ]);
  state.budget = data || { lines: [], cells: [] };
  state.qbStatus = qbStatus;
  renderBudget();
  renderBudgetQbStatus();
  maybeFlashQbOauthResult();
}

// One-shot: if the URL has ?qb=connected or ?error=qb_*, surface a status
// message in the budget status strip, then strip the param so refreshes
// don't replay the flash.
function maybeFlashQbOauthResult() {
  const params = new URLSearchParams(location.search);
  const status = qs('#budget-status');
  if (!status) return;
  const err = params.get('error');
  if (params.get('qb') === 'connected') {
    status.innerHTML = '<span class="budget-msg-ok">QuickBooks connected.</span>';
  } else if (err && err.startsWith('qb_')) {
    const msg = ({
      qb_denied:            'QuickBooks connection cancelled.',
      qb_forbidden:         'Only owners can connect QuickBooks.',
      qb_not_configured:    'QuickBooks credentials are not configured on the server.',
      qb_missing_params:    'QuickBooks callback was missing required parameters.',
      qb_state_mismatch:    'QuickBooks security check failed — try again.',
      qb_no_session:        'Session expired during the QuickBooks flow — sign in and retry.',
      qb_token_exchange:    'QuickBooks token exchange failed. Check app credentials.',
      qb_server_error:      'Unexpected server error starting the QuickBooks flow.',
    }[err]) || `QuickBooks error: ${err}`;
    status.innerHTML = `<span class="budget-msg-err">${msg}</span>`;
  }
  if (params.has('qb') || err) {
    const url = new URL(location.href);
    url.searchParams.delete('qb');
    url.searchParams.delete('error');
    history.replaceState(null, '', url.toString());
    setTimeout(() => { if (status) status.innerHTML = ''; }, 6000);
  }
}

function renderBudgetQbStatus() {
  const btn = qs('#budget-qb-btn');
  const row = qs('#budget-qb-row');
  if (!btn || !row) return;
  const s = state.qbStatus || { configured: false, connected: false };

  if (!s.configured) {
    btn.textContent = 'QB not configured';
    btn.disabled = true;
    btn.title = 'Add QBO_CLIENT_ID and QBO_CLIENT_SECRET to .env';
    row.textContent = '';
    return;
  }

  if (!s.connected) {
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Connect QuickBooks';
    btn.disabled = false;
    btn.title = `Connect the SRED.ca QuickBooks company (${s.env || 'sandbox'})`;
    btn.onclick = () => { window.location.href = '/auth/quickbooks'; };
    row.textContent = '';
    return;
  }

  // Connected: Sync button + status + disconnect + map link.
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Sync QB';
  btn.disabled = false;
  btn.title = 'Pull the monthly P&L from QuickBooks into the Actual row';
  btn.onclick = () => syncQb();

  row.innerHTML = '';
  const label = document.createElement('span');
  label.className = 'budget-qb-label';
  const when = s.last_synced_at
    ? `last synced ${new Date(s.last_synced_at).toLocaleString()}`
    : 'not yet synced';
  label.textContent = `Connected to QuickBooks (${s.env || 'sandbox'}, realm ${s.realm_id}) — ${when}.`;

  const mapBtn = document.createElement('button');
  mapBtn.type = 'button';
  mapBtn.className = 'btn-link';
  mapBtn.textContent = 'Map accounts';
  mapBtn.onclick = () => openMapQbModal();

  const disc = document.createElement('button');
  disc.type = 'button';
  disc.className = 'btn-link';
  disc.textContent = 'Disconnect';
  disc.onclick = async () => {
    if (!confirm('Disconnect QuickBooks? You can re-connect anytime.')) return;
    await api.post('/api/quickbooks/disconnect', {});
    state.qbStatus = await api.get('/api/quickbooks/status');
    renderBudgetQbStatus();
  };
  row.append(label, mapBtn, disc);
}

/* ── QB Sync action ──────────────────────────────────────────── */
async function syncQb() {
  const btn = qs('#budget-qb-btn');
  const status = qs('#budget-status');
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
  if (status) status.innerHTML = '';
  try {
    const result = await api.post('/api/quickbooks/sync', {
      fiscal_year: state.budgetFiscalYear,
    });
    // Reload budget to pull in newly-written actuals
    await loadBudget();
    const msg = [];
    msg.push(`<span class="budget-msg-ok">Synced ${result.synced_cells} cells across ${result.mapped_accounts.length} account${result.mapped_accounts.length === 1 ? '' : 's'}.</span>`);
    if (result.unmapped_accounts && result.unmapped_accounts.length) {
      msg.push(` <span class="budget-msg-err">${result.unmapped_accounts.length} QB account${result.unmapped_accounts.length === 1 ? '' : 's'} unmapped.</span>`);
      msg.push(' <a href="#" id="budget-unmapped-open">Map them →</a>');
      state.lastUnmappedAccounts = result.unmapped_accounts;
    } else {
      state.lastUnmappedAccounts = [];
    }
    if (status) {
      status.innerHTML = msg.join('');
      const link = qs('#budget-unmapped-open');
      if (link) link.onclick = (e) => { e.preventDefault(); openMapQbModal(); };
    }
  } catch (e) {
    if (status) status.innerHTML = `<span class="budget-msg-err">Sync failed: ${e.message}</span>`;
  }
}

/* ── Map QB Accounts modal ─────────────────────────────────── */
async function openMapQbModal() {
  const body = qs('#map-qb-body');
  const msg  = qs('#map-qb-msg');
  const hint = qs('#map-qb-hint');
  if (msg) msg.textContent = '';
  if (body) body.innerHTML = '<p class="form-hint">Loading QB accounts…</p>';
  openModal('map-qb-modal');

  try {
    const [accounts, latestBudget] = await Promise.all([
      api.get('/api/quickbooks/accounts'),
      api.get(`/api/budget?fiscal_year=${encodeURIComponent(state.budgetFiscalYear)}`),
    ]);
    state.budget = latestBudget || { lines: [], cells: [] };

    // Unmapped QB accounts: any account in the chart of accounts that is NOT
    // already attached to a budget line. Call out the ones from the most
    // recent sync response (the ones that actually had P&L data and got
    // skipped) at the top.
    const mappedAccountIds = new Set(
      state.budget.lines.filter(l => l.qb_account_id).map(l => String(l.qb_account_id))
    );
    const recentUnmappedIds = new Set((state.lastUnmappedAccounts || []).map(a => String(a.id)));
    if (hint) {
      const flagged = recentUnmappedIds.size;
      hint.textContent = flagged
        ? `Pick the QB account for each budget line. ${flagged} QB account${flagged === 1 ? '' : 's'} had P&L data on the last sync but no line to feed — those are marked ⚠.`
        : 'Pick the QB account that feeds each budget line. Lines with no mapping are skipped on sync.';
    }

    // Group lines by section for readability
    const bySection = {};
    BUDGET_SECTION_ORDER.forEach(s => { bySection[s] = []; });
    state.budget.lines.forEach(l => { (bySection[l.section] || (bySection[l.section] = [])).push(l); });

    const table = document.createElement('div');
    table.className = 'map-qb-table';
    const draft = {}; // line_id → selected account_id (or '' for none)

    BUDGET_SECTION_ORDER.forEach(section => {
      const sectionLines = bySection[section];
      if (!sectionLines || !sectionLines.length) return;
      const h = document.createElement('div');
      h.className = 'map-qb-group-head';
      h.textContent = BUDGET_SECTION_LABELS[section] || section;
      table.appendChild(h);

      sectionLines.forEach(line => {
        const currentId = line.qb_account_id ? String(line.qb_account_id) : '';
        draft[line.id] = currentId;
        const row = document.createElement('div');
        row.className = 'map-qb-row';

        const label = document.createElement('div');
        label.className = 'map-qb-line-label';
        label.textContent = line.category;
        row.appendChild(label);

        const sel = document.createElement('select');
        sel.className = 'select-input';
        const opt0 = document.createElement('option');
        opt0.value = ''; opt0.textContent = '— no mapping —';
        sel.appendChild(opt0);
        accounts.forEach(a => {
          const opt = document.createElement('option');
          opt.value = a.id;
          const warn = recentUnmappedIds.has(a.id) ? ' ⚠' : '';
          opt.textContent = `${a.name}${warn}${a.type ? ` · ${a.type}` : ''}`;
          if (currentId === a.id) opt.selected = true;
          sel.appendChild(opt);
        });
        sel.onchange = () => { draft[line.id] = sel.value; };
        row.appendChild(sel);
        table.appendChild(row);
      });
    });
    body.innerHTML = '';
    body.appendChild(table);

    qs('#map-qb-save-btn').onclick = async () => {
      if (msg) msg.innerHTML = '<span class="form-msg-ok">Saving…</span>';
      try {
        // Persist only the lines whose mapping changed.
        const changed = state.budget.lines.filter(l => {
          const was = l.qb_account_id ? String(l.qb_account_id) : '';
          return (draft[l.id] ?? '') !== was;
        });
        for (const line of changed) {
          await api.put(`/api/budget/lines/${line.id}`, {
            qb_account_id: draft[line.id] || null,
          });
        }
        if (msg) msg.innerHTML = `<span class="form-msg-ok">Saved ${changed.length} mapping${changed.length === 1 ? '' : 's'}.</span>`;
        closeModal('map-qb-modal');
        await loadBudget();
      } catch (e) {
        if (msg) msg.innerHTML = `<span class="form-msg-err">Save failed: ${e.message}</span>`;
      }
    };

    qs('#map-qb-auto-btn').onclick = async () => {
      const autoBtn = qs('#map-qb-auto-btn');
      autoBtn.disabled = true;
      if (msg) msg.innerHTML = '<span class="form-msg-ok">Running auto-map…</span>';
      try {
        const result = await api.post('/api/quickbooks/auto-map', {
          fiscal_year: state.budgetFiscalYear,
        });
        // Build a human-readable summary, then reload the modal so the
        // newly-mapped lines show up in the dropdowns pre-selected.
        const bits = [];
        bits.push(`<span class="form-msg-ok">Auto-mapped ${result.mapped_now.length} line${result.mapped_now.length === 1 ? '' : 's'}.</span>`);
        if (result.ambiguous_lines.length) {
          bits.push(` <span class="form-msg-err">${result.ambiguous_lines.length} line${result.ambiguous_lines.length === 1 ? '' : 's'} still need your call.</span>`);
        }
        if (msg) msg.innerHTML = bits.join('');
        // Stash the report so the user can inspect it if they want
        state.lastAutoMapReport = result;
        console.log('Auto-map report', result);
        // Re-open modal — refresh dropdowns from the new state
        await openMapQbModal();
      } catch (e) {
        if (msg) msg.innerHTML = `<span class="form-msg-err">Auto-map failed: ${e.message}</span>`;
      } finally {
        autoBtn.disabled = false;
      }
    };
  } catch (e) {
    if (body) body.innerHTML = `<p class="form-msg-err">Failed to load QB accounts: ${e.message}</p>`;
  }
}

function populateBudgetFySelect() {
  const sel = qs('#budget-fy-select');
  if (!sel) return;
  if (!sel.options.length) {
    budgetFiscalYearOptions().forEach(fy => {
      const o = document.createElement('option');
      o.value = fy; o.textContent = fy;
      sel.appendChild(o);
    });
    sel.value = state.budgetFiscalYear;
    sel.onchange = () => { state.budgetFiscalYear = sel.value; loadBudget(); };
  } else {
    sel.value = state.budgetFiscalYear;
  }
}

function renderBudget() {
  const months = fiscalYearMonths(state.budgetFiscalYear);
  renderBudgetHead(months);
  renderBudgetBody(months);
  wireBudgetControls();
}

function renderBudgetHead(months) {
  const head = qs('#budget-table-head');
  head.innerHTML = '';
  const tr = document.createElement('tr');
  const th0 = document.createElement('th'); th0.className = 'budget-th-category'; th0.textContent = 'Category';
  tr.appendChild(th0);
  months.forEach(m => {
    const th = document.createElement('th');
    th.className = 'budget-th-month';
    th.textContent = m.label;
    tr.appendChild(th);
  });
  const thTotal = document.createElement('th'); thTotal.className = 'budget-th-total'; thTotal.textContent = 'Total';
  const thActions = document.createElement('th'); thActions.className = 'budget-th-actions';
  tr.append(thTotal, thActions);
  head.appendChild(tr);
}

function renderBudgetBody(months) {
  const body = qs('#budget-table-body');
  body.innerHTML = '';

  if (!state.budget.lines.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = months.length + 3;
    td.className = 'budget-empty';
    td.textContent = `No budget lines yet for ${state.budgetFiscalYear}. Click "Add line" to start.`;
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  // Group lines by section
  const bySection = {};
  BUDGET_SECTION_ORDER.forEach(s => { bySection[s] = []; });
  state.budget.lines.forEach(l => {
    (bySection[l.section] || (bySection[l.section] = [])).push(l);
  });

  BUDGET_SECTION_ORDER.forEach(section => {
    const lines = bySection[section];
    if (!lines || !lines.length) return;

    // Section header row
    const sh = document.createElement('tr');
    sh.className = `budget-section-head budget-section-${section}`;
    const shTd = document.createElement('td');
    shTd.colSpan = months.length + 3;
    shTd.textContent = BUDGET_SECTION_LABELS[section] || section;
    sh.appendChild(shTd);
    body.appendChild(sh);

    // Line rows
    lines.forEach(line => {
      const cellsByPeriod = budgetCellsFor(line.id);
      const tr = document.createElement('tr');
      tr.className = 'budget-line-row';
      tr.dataset.lineId = line.id;

      // Category cell (inline-editable)
      const nameTd = document.createElement('td'); nameTd.className = 'budget-td-category';
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = line.category;
      nameInput.className = 'budget-category-input';
      nameInput.onblur = async () => {
        const v = nameInput.value.trim();
        if (!v || v === line.category) { nameInput.value = line.category; return; }
        await api.put(`/api/budget/lines/${line.id}`, { category: v });
        line.category = v;
      };
      nameTd.appendChild(nameInput);
      tr.appendChild(nameTd);

      // Monthly cells
      let rowBudgetTotal = 0, rowActualTotal = 0, rowHasActual = false;
      months.forEach(m => {
        const td = document.createElement('td'); td.className = 'budget-td-month';
        const cell = cellsByPeriod[m.period] || null;
        const budgetVal = cell ? Number(cell.budget_amount) : 0;
        rowBudgetTotal += budgetVal;
        if (cell && cell.actual_amount != null) {
          rowActualTotal += Number(cell.actual_amount);
          rowHasActual = true;
        }

        const wrap = document.createElement('div'); wrap.className = 'budget-cell';
        const bInput = document.createElement('input');
        bInput.type = 'text';
        bInput.className = 'budget-cell-input';
        bInput.value = budgetVal ? budgetVal.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '';
        bInput.placeholder = '—';
        bInput.dataset.lineId = line.id;
        bInput.dataset.period = m.period;
        bInput.onblur = async () => {
          const n = parseMoneyInput(bInput.value);
          if (!Number.isFinite(n)) { bInput.value = budgetVal ? budgetVal.toLocaleString('en-US', { maximumFractionDigits: 0 }) : ''; return; }
          if (n === budgetVal) return;
          const saved = await api.put('/api/budget/cells', { line_id: line.id, period_date: m.period, budget_amount: n });
          // Update local state to match server
          const idx = state.budget.cells.findIndex(c => c.id === saved.id);
          if (idx >= 0) state.budget.cells[idx] = saved; else state.budget.cells.push(saved);
          renderBudget();
        };
        bInput.onkeydown = (e) => { if (e.key === 'Enter') bInput.blur(); };

        const actual = document.createElement('div'); actual.className = 'budget-cell-actual';
        actual.textContent = (cell && cell.actual_amount != null)
          ? fmtMoney(cell.actual_amount)
          : '—';
        const paint = variancePaint(line, cell);
        if (paint) actual.classList.add(paint);
        actual.title = varianceTitle(line, cell);

        wrap.append(bInput, actual);
        td.appendChild(wrap);
        tr.appendChild(td);
      });

      // Row total: budget sum + actual sum, variance-painted.
      const totalTd = document.createElement('td'); totalTd.className = 'budget-td-total';
      totalTd.appendChild(dualCell(line.section, rowBudgetTotal, rowActualTotal, rowHasActual));
      tr.appendChild(totalTd);

      // Actions
      const actTd = document.createElement('td'); actTd.className = 'budget-td-actions';
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'btn btn-ghost btn-sm';
      del.innerHTML = '×'; del.title = 'Delete line';
      del.onclick = async () => {
        if (!confirm(`Delete "${line.category}"? This clears its monthly values.`)) return;
        await api.del(`/api/budget/lines/${line.id}`);
        await loadBudget();
      };
      actTd.appendChild(del);
      tr.appendChild(actTd);

      body.appendChild(tr);
    });

    // Section subtotal row: budget + actual per month + total, painted.
    const sub = document.createElement('tr');
    sub.className = 'budget-subtotal-row';
    const subName = document.createElement('td');
    subName.className = 'budget-td-category';
    subName.textContent = `${BUDGET_SECTION_LABELS[section]} subtotal`;
    sub.appendChild(subName);

    let secBudgetTotal = 0, secActualTotal = 0, secHasActual = false;
    months.forEach(m => {
      let monthBudget = 0, monthActual = 0, monthHasActual = false;
      lines.forEach(l => {
        const c = state.budget.cells.find(x => x.line_id === l.id && String(x.period_date).slice(0, 10) === m.period);
        if (!c) return;
        monthBudget += Number(c.budget_amount) || 0;
        if (c.actual_amount != null) {
          monthActual += Number(c.actual_amount);
          monthHasActual = true;
        }
      });
      secBudgetTotal += monthBudget;
      if (monthHasActual) { secActualTotal += monthActual; secHasActual = true; }
      const td = document.createElement('td'); td.className = 'budget-td-month budget-td-subtotal';
      td.appendChild(dualCell(section, monthBudget, monthActual, monthHasActual));
      sub.appendChild(td);
    });
    const subTotalTd = document.createElement('td');
    subTotalTd.className = 'budget-td-total budget-td-subtotal';
    subTotalTd.appendChild(dualCell(section, secBudgetTotal, secActualTotal, secHasActual));
    sub.appendChild(subTotalTd);
    sub.appendChild(document.createElement('td'));
    body.appendChild(sub);
  });

  // ── Operating Profit row ────────────────────────────────────────
  // Income - COGS - OpEx - Other, computed per month from every cell.
  // Paints with income direction (higher = better) since OP is the
  // bottom line you want to maximize.
  const opRow = document.createElement('tr');
  opRow.className = 'budget-subtotal-row budget-op-row';
  const opName = document.createElement('td');
  opName.className = 'budget-td-category';
  opName.textContent = 'Operating profit';
  opRow.appendChild(opName);

  let opBudgetTotal = 0, opActualTotal = 0, opHasActual = false;
  const SECTION_SIGN = { income: 1, cogs: -1, opex: -1, other: -1 };
  months.forEach(m => {
    let monthOpBudget = 0, monthOpActual = 0, monthOpHasActual = false;
    state.budget.lines.forEach(l => {
      const sign = SECTION_SIGN[l.section];
      if (sign == null) return;
      const c = state.budget.cells.find(x => x.line_id === l.id && String(x.period_date).slice(0, 10) === m.period);
      if (!c) return;
      monthOpBudget += sign * (Number(c.budget_amount) || 0);
      if (c.actual_amount != null) {
        monthOpActual += sign * Number(c.actual_amount);
        monthOpHasActual = true;
      }
    });
    opBudgetTotal += monthOpBudget;
    if (monthOpHasActual) { opActualTotal += monthOpActual; opHasActual = true; }
    const td = document.createElement('td'); td.className = 'budget-td-month budget-td-subtotal';
    td.appendChild(dualCell('income', monthOpBudget, monthOpActual, monthOpHasActual));
    opRow.appendChild(td);
  });
  const opTotalTd = document.createElement('td');
  opTotalTd.className = 'budget-td-total budget-td-subtotal';
  opTotalTd.appendChild(dualCell('income', opBudgetTotal, opActualTotal, opHasActual));
  opRow.appendChild(opTotalTd);
  opRow.appendChild(document.createElement('td'));
  body.appendChild(opRow);
}

function wireBudgetControls() {
  const addBtn = qs('#budget-add-line-btn');
  if (addBtn) addBtn.onclick = () => openBudgetAddLineModal();

  const rebuildBtn = qs('#budget-rebuild-btn');
  if (rebuildBtn) {
    // Disable Rebuild when QB isn't connected — it would 400 anyway.
    const connected = !!(state.qbStatus && state.qbStatus.connected);
    rebuildBtn.disabled = !connected;
    rebuildBtn.title = connected
      ? 'Wipe current budget and rebuild from QuickBooks chart of accounts'
      : 'Connect QuickBooks first';
    rebuildBtn.onclick = () => rebuildBudgetFromQb();
  }
}

/* Wipe + rebuild the current fiscal year's budget using QB accounts as
   the category source. Destructive — user confirms first. On success the
   budget view reloads so the user can see the new QB-aligned grid. */
async function rebuildBudgetFromQb() {
  const fy = state.budgetFiscalYear;
  if (!confirm(
    `Rebuild ${fy} budget from QuickBooks?\n\n` +
    `This wipes the current ${fy} budget lines and monthly values, ` +
    `then recreates one line per active QB account with ${fy} budgets ` +
    `scaled from the prior-year actuals. Any manual edits to the ` +
    `current grid will be lost.`
  )) return;

  const status = qs('#budget-status');
  if (status) status.innerHTML = '<span class="budget-msg-ok">Rebuilding from QuickBooks… this takes ~10–20s.</span>';
  try {
    const result = await api.post('/api/quickbooks/rebuild-budget', { fiscal_year: fy });
    await loadBudget();
    const lineCount = result.total_lines || 0;
    if (status) {
      status.innerHTML = `<span class="budget-msg-ok">Rebuilt: ${lineCount} line${lineCount === 1 ? '' : 's'} from ${result.chart_of_accounts} active QB accounts. Prior year ${result.prior_start} → ${result.prior_end}.</span>`;
    }
    state.lastRebuildReport = result;
    console.log('Rebuild report', result);
  } catch (e) {
    if (status) status.innerHTML = `<span class="budget-msg-err">Rebuild failed: ${e.message}</span>`;
  }
}

async function openBudgetAddLineModal() {
  // Light-touch prompt-based add. Swap for a proper modal if this gets heavy.
  const category = prompt('New budget line — category name?');
  if (!category) return;
  const sectionRaw = prompt('Section? One of: income, cogs, opex, other', 'opex');
  const section = (sectionRaw || 'opex').toLowerCase().trim();
  if (!BUDGET_SECTION_ORDER.includes(section)) { alert('Unknown section.'); return; }
  try {
    await api.post('/api/budget/lines', {
      fiscal_year: state.budgetFiscalYear,
      section,
      category: category.trim(),
      sort_order: state.budget.lines.length,
    });
    await loadBudget();
  } catch (e) {
    alert('Failed to add line: ' + e.message);
  }
}

/* ── Load all ────────────────────────────────────────────────────── */
/* ════════════════════════════════════════════════════════════════════
   GOALS TAB  (Goal → Rock → To-Do drill-down)
   ════════════════════════════════════════════════════════════════════ */

const goalsState = { expandedGoals: new Set(), expandedRocks: new Set() };

async function loadGoals() {
  // Fetch fresh data — V/TO for goals, all rocks (every quarter), all issues.
  const [vto, rocks, issues] = await Promise.all([
    api.get('/api/vto').catch(() => ({})),
    api.get('/api/rocks'),
    api.get('/api/issues?include_archived=1'),
  ]);
  state.vto    = vto || {};
  state.rocks  = rocks || [];
  state.issues = issues || [];
  renderGoals();
}

function renderGoals() {
  const root = qs('#goals-tree');
  const goals = (state.vto?.one_year_goals) || [];
  const sub   = qs('#goals-subtitle');
  if (state.vto?.one_year_future_date) {
    const fy = new Date(state.vto.one_year_future_date).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    sub.textContent = `Annual goals to ${fy} — drill into rocks and to-dos`;
  }

  if (!goals.length) {
    root.innerHTML = `<div class="empty-state"><p>No annual goals yet. Add them in the V/TO tab.</p></div>`;
    return;
  }

  root.innerHTML = goals.map((g, i) => renderGoalCard(g, i)).join('');

  // Wire interactions
  root.querySelectorAll('[data-toggle-goal]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.toggleGoal;
      if (goalsState.expandedGoals.has(id)) goalsState.expandedGoals.delete(id);
      else goalsState.expandedGoals.add(id);
      renderGoals();
    });
  });
  root.querySelectorAll('[data-toggle-rock]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = +el.dataset.toggleRock;
      if (goalsState.expandedRocks.has(id)) goalsState.expandedRocks.delete(id);
      else goalsState.expandedRocks.add(id);
      renderGoals();
    });
  });
  root.querySelectorAll('[data-rock-edit]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openRockModal(+el.dataset.rockEdit);
    });
  });
  root.querySelectorAll('[data-issue-edit]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openIssueModal(+el.dataset.issueEdit);
    });
  });
}

function renderGoalCard(goal, idx) {
  const goalRocks = (state.rocks || []).filter(r => r.goal_id === goal.id);
  const totalRocks = goalRocks.length;
  const doneRocks  = goalRocks.filter(r => r.status === 'done').length;
  const pct = totalRocks ? Math.round((doneRocks / totalRocks) * 100) : 0;

  const ownerIds = Array.isArray(goal.owner_ids) && goal.owner_ids.length
    ? goal.owner_ids
    : (goal.owner_id ? [+goal.owner_id] : []);
  const owners = ownerIds.map(id => state.users.find(u => u.id === +id)).filter(Boolean);

  const expanded = goalsState.expandedGoals.has(goal.id);

  const ownersHtml = owners.length
    ? owners.map(o => `<span class="goal-owner">${esc(o.name.split(' ')[0])}</span>`).join('')
    : '<span class="goal-owner goal-owner-empty">No owner</span>';

  // Sort rocks by quarter then status (done last)
  const statusOrder = { not_started: 0, on_track: 1, off_track: 2, done: 3 };
  goalRocks.sort((a, b) => (a.quarter || '').localeCompare(b.quarter || '')
    || (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99));

  const rocksHtml = expanded
    ? (totalRocks === 0
        ? `<div class="goal-empty">No rocks linked to this goal yet — link one when you add or edit a rock.</div>`
        : goalRocks.map(r => renderRockRow(r)).join(''))
    : '';

  return `
    <div class="goal-card">
      <div class="goal-card-head" data-toggle-goal="${esc(goal.id)}">
        <div class="goal-card-num">${idx + 1}</div>
        <div class="goal-card-main">
          <div class="goal-card-title">${esc(goal.text || '')}</div>
          <div class="goal-card-meta">
            ${ownersHtml}
            <span class="goal-progress-summary">
              ${doneRocks} / ${totalRocks} rock${totalRocks === 1 ? '' : 's'} done
            </span>
          </div>
        </div>
        <div class="goal-card-progress">
          <div class="goal-progress-bar"><div class="goal-progress-fill" style="width:${pct}%"></div></div>
          <div class="goal-progress-pct">${pct}%</div>
        </div>
        <div class="goal-card-toggle">${expanded ? '▾' : '▸'}</div>
      </div>
      ${expanded ? `<div class="goal-card-body">${rocksHtml}</div>` : ''}
    </div>
  `;
}

function renderRockRow(rock) {
  const owner = rock.owner_id ? state.users.find(u => u.id === rock.owner_id) : null;
  const expanded = goalsState.expandedRocks.has(rock.id);
  const todos = (state.issues || []).filter(i => i.rock_id === rock.id && !i.archived);
  const doneCount = todos.filter(t => t.status === 'solved').length;

  const statusLabel = { not_started: 'Not Started', on_track: 'On Track', off_track: 'Off Track', done: 'Done' }[rock.status] || rock.status;
  const statusClass = `rock-status rock-status--${rock.status}`;

  const todosHtml = expanded
    ? (todos.length === 0
        ? `<div class="goal-rock-todos-empty">No to-dos linked to this rock.</div>`
        : todos.map(t => renderTodoRow(t)).join(''))
    : '';

  return `
    <div class="goal-rock">
      <div class="goal-rock-head" data-toggle-rock="${rock.id}">
        <div class="goal-rock-toggle">${expanded ? '▾' : '▸'}</div>
        <div class="goal-rock-main">
          <div class="goal-rock-title">${esc(rock.title)}</div>
          <div class="goal-rock-meta">
            <span class="goal-rock-quarter">${esc(rock.quarter || '')}</span>
            ${owner ? `<span class="goal-owner">${esc(owner.name.split(' ')[0])}</span>` : ''}
            <span class="${statusClass}">${statusLabel}</span>
            <span class="goal-rock-progress-text">${rock.progress || 0}%</span>
            ${todos.length ? `<span class="goal-rock-todos-count">${doneCount} / ${todos.length} to-do${todos.length === 1 ? '' : 's'}</span>` : ''}
          </div>
        </div>
        <button class="btn btn-ghost btn-sm goal-rock-edit" data-rock-edit="${rock.id}" title="Edit rock">Edit</button>
      </div>
      ${expanded ? `<div class="goal-rock-todos">${todosHtml}</div>` : ''}
    </div>
  `;
}

function renderTodoRow(todo) {
  const owner = todo.owner_id ? state.users.find(u => u.id === todo.owner_id) : null;
  const done = todo.status === 'solved';
  const statusLabel = { in_progress: 'In Progress', waiting_for: 'Waiting For', blocker: 'Blocker', solved: 'Solved' }[todo.status] || todo.status;
  return `
    <div class="goal-todo${done ? ' done' : ''}" data-issue-edit="${todo.id}">
      <span class="goal-todo-check">${done ? '✓' : '○'}</span>
      <span class="goal-todo-title">${esc(todo.title)}</span>
      ${todo.due_date ? `<span class="goal-todo-due">${formatDateShort(todo.due_date)}</span>` : ''}
      ${owner ? `<span class="goal-owner">${esc(owner.name.split(' ')[0])}</span>` : ''}
      <span class="goal-todo-status goal-todo-status--${todo.status}">${statusLabel}</span>
    </div>
  `;
}

async function loadAll() {
  await Promise.all([
    populateQuarterFilter().then(() => loadRocks()),
    loadIssues(),
    loadTeamIssues(),
    loadMeetings(),
    loadMy90(),
    // Cache V/TO so modals (rock goal dropdown, etc.) can read goals without
    // first navigating to the V/TO tab. Falls back to {} on failure (e.g.
    // no permission) so callers can read .one_year_goals safely.
    api.get('/api/vto').then(v => { state.vto = v || {}; }).catch(() => { state.vto = {}; }),
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

/* ════════════════════════════════════════════════════════════════════
   ADMIN — tab access per user (owner-only)
   ════════════════════════════════════════════════════════════════════ */

const ADMIN_TAB_LABELS = {
  vto:    'V/TO',
  rocks:  'Rocks',
  budget: 'Budget',
  stella: 'Stella',
};

async function loadAdmin() {
  try {
    const d = await api.get('/api/admin/tab-access');
    renderAdmin(d);
  } catch (e) {
    qs('#admin-table').innerHTML = `<div class="my90-empty">Failed to load: ${esc(e.message)}</div>`;
  }
}

function renderAdmin({ assignable_tabs, users }) {
  const host = qs('#admin-table');
  host.style.setProperty('--admin-tab-cols', String(assignable_tabs.length));

  const headerCells = assignable_tabs.map(t =>
    `<span>${esc(ADMIN_TAB_LABELS[t] || t)}</span>`
  ).join('');
  const header = `
    <div class="admin-table-header">
      <span>User</span>
      <span>Role</span>
      ${headerCells}
    </div>
  `;

  const rowsHtml = users.map(u => {
    const grantedSet = new Set(u.tabs || []);
    const tabCells = assignable_tabs.map(t => {
      if (u.role === 'owner') {
        return `<div class="admin-tab-cell granted-owner" title="Owners always see every tab"></div>`;
      }
      const checked = grantedSet.has(t) ? 'checked' : '';
      return `<div class="admin-tab-cell"><input type="checkbox" data-user-id="${u.id}" data-tab="${t}" ${checked} /></div>`;
    }).join('');
    return `
      <div class="admin-table-row" data-user-id="${u.id}">
        <div class="admin-cell-user">
          <span class="admin-cell-user-name">${esc(u.name || '(no name)')}</span>
          <span class="admin-cell-user-email">${esc(u.email || '')}</span>
        </div>
        <select class="admin-role-select ${u.role}" data-user-id="${u.id}" data-prev="${u.role}">
          <option value="member" ${u.role === 'member' ? 'selected' : ''}>member</option>
          <option value="owner"  ${u.role === 'owner'  ? 'selected' : ''}>owner</option>
        </select>
        ${tabCells}
      </div>
    `;
  }).join('');

  host.innerHTML = header + rowsHtml;

  host.querySelectorAll('input[type="checkbox"][data-tab]').forEach(cb => {
    cb.addEventListener('change', async () => {
      const userId = cb.dataset.userId;
      // Collect this user's currently-checked tabs after the toggle
      const row = cb.closest('.admin-table-row');
      const tabs = Array.from(row.querySelectorAll('input[type="checkbox"][data-tab]'))
        .filter(c => c.checked)
        .map(c => c.dataset.tab);
      cb.disabled = true;
      try {
        await api.put(`/api/admin/tab-access/${userId}`, { tabs });
        // If the edited user is me, my own tabs list changed — re-pull /api/me
        // so the sidebar updates without a full reload.
        if (state.currentUser && +userId === state.currentUser.id) {
          const me = await api.get('/api/me');
          if (me) { state.currentUser = me; applyTabVisibility(me); }
        }
      } catch (e) {
        alert(e.message);
        cb.checked = !cb.checked; // revert
      } finally {
        cb.disabled = false;
      }
    });
  });

  host.querySelectorAll('select.admin-role-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const userId = sel.dataset.userId;
      const newRole = sel.value;
      const prevRole = sel.dataset.prev;
      sel.disabled = true;
      try {
        await api.put(`/api/admin/users/${userId}/role`, { role: newRole });
        // Role flip changes how the row renders (owner = readonly checkmarks,
        // member = toggleable checkboxes). Reload the matrix.
        await loadAdmin();
        // If self-edit, refresh /api/me so the sidebar (incl. Admin tab) updates.
        if (state.currentUser && +userId === state.currentUser.id) {
          const me = await api.get('/api/me');
          if (me) { state.currentUser = me; applyTabVisibility(me); }
        }
      } catch (e) {
        alert(e.message);
        sel.value = prevRole; // revert
      } finally {
        sel.disabled = false;
      }
    });
  });
}
