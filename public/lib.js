/* ── Pure helpers ──────────────────────────────────────────────────
   Shared between the browser app (loaded as a global script) and the
   Node test suite (require'd directly). DO NOT touch document/window
   here — anything that needs the DOM lives in app.js.
*/

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

const ISSUE_STATUS_LABELS = {
  in_progress: 'In Progress',
  waiting_for: 'Waiting For',
  blocker:     'Blocked',
  solved:      'Complete',
};
function issueStatusLabel(s) { return ISSUE_STATUS_LABELS[s] || s.replace(/_/g, ' '); }

const ISSUE_PRIORITY_LABELS = {
  priority_1: 'Priority 1',
  high:       'high',
  medium:     'medium',
  low:        'low',
};
function issuePriorityLabel(p) { return ISSUE_PRIORITY_LABELS[p] || (p || '').replace(/_/g, ' '); }

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

function withClickGuard(fn) {
  return async function (e) {
    const btn = e && e.currentTarget;
    if (btn && btn.disabled) return;
    if (btn) btn.disabled = true;
    try { await fn.call(this, e); }
    finally { if (btn) btn.disabled = false; }
  };
}

// Build YYYY-MM-DD in the user's local timezone. toISOString() shifts by ±1
// day for anyone east or west of UTC — always compare local-to-local.
function localDateISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addBusinessDays(n) {
  const d = new Date();
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return localDateISO(d);
}

function formatDueDate(dateStr) {
  if (!dateStr) return null;
  const today = localDateISO();
  const due   = dateStr.slice(0, 10);
  const [y, m, d] = due.split('-').map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (due < today)  return { text: label, urgency: 'overdue' };
  if (due === today) return { text: 'Today', urgency: 'today' };
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  if (due === localDateISO(tomorrow)) return { text: 'Tomorrow', urgency: 'soon' };
  return { text: label, urgency: 'normal' };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    initials,
    ISSUE_STATUS_LABELS, issueStatusLabel,
    ISSUE_PRIORITY_LABELS, issuePriorityLabel,
    quarters, currentQuarter, periodDateRange,
    withClickGuard, localDateISO, addBusinessDays, formatDueDate,
  };
}
