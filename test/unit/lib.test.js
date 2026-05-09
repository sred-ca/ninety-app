const test = require('node:test');
const assert = require('node:assert/strict');

const lib = require('../../public/lib.js');

test('initials', async (t) => {
  await t.test('returns first-letter pair from a two-word name', () => {
    assert.equal(lib.initials('Logan Hanson'), 'LH');
  });
  await t.test('uppercases', () => {
    assert.equal(lib.initials('alice baker'), 'AB');
  });
  await t.test('truncates to 2 chars for longer names', () => {
    assert.equal(lib.initials('Alice Beth Carter'), 'AB');
  });
  await t.test('returns ? for empty input', () => {
    assert.equal(lib.initials(''), '?');
    assert.equal(lib.initials(null), '?');
    assert.equal(lib.initials(undefined), '?');
  });
});

test('issueStatusLabel', async (t) => {
  await t.test('maps known statuses to display labels', () => {
    assert.equal(lib.issueStatusLabel('in_progress'), 'In Progress');
    assert.equal(lib.issueStatusLabel('waiting_for'), 'Waiting For');
    assert.equal(lib.issueStatusLabel('blocker'), 'Blocked');
    assert.equal(lib.issueStatusLabel('solved'), 'Complete');
  });
  await t.test('falls back to underscore-split for unknown statuses', () => {
    assert.equal(lib.issueStatusLabel('not_a_real_status'), 'not a real status');
  });
});

test('issuePriorityLabel', async (t) => {
  await t.test('renders priority_1 as "Priority 1"', () => {
    assert.equal(lib.issuePriorityLabel('priority_1'), 'Priority 1');
  });
  await t.test('passes existing tier names through unchanged', () => {
    assert.equal(lib.issuePriorityLabel('high'), 'high');
    assert.equal(lib.issuePriorityLabel('medium'), 'medium');
    assert.equal(lib.issuePriorityLabel('low'), 'low');
  });
  await t.test('handles null/empty by returning empty string', () => {
    assert.equal(lib.issuePriorityLabel(null), '');
    assert.equal(lib.issuePriorityLabel(''), '');
  });
});

test('quarters', async (t) => {
  await t.test('returns four entries spanning Q4..Q1 of current year', () => {
    const qs = lib.quarters();
    const y = new Date().getFullYear();
    assert.deepEqual(qs, [`Q4 ${y}`, `Q3 ${y}`, `Q2 ${y}`, `Q1 ${y}`]);
  });
});

test('currentQuarter', async (t) => {
  await t.test('matches the current calendar quarter', () => {
    const now = new Date();
    const expected = `Q${Math.ceil((now.getMonth() + 1) / 3)} ${now.getFullYear()}`;
    assert.equal(lib.currentQuarter(), expected);
  });
});

test('periodDateRange', async (t) => {
  await t.test('"current" spans the current quarter', () => {
    const r = lib.periodDateRange('current');
    assert.ok(r.start instanceof Date);
    assert.ok(r.end   instanceof Date);
    assert.ok(r.end > r.start);
    const now = new Date();
    assert.ok(r.start <= now && now <= r.end);
  });
  await t.test('"last" returns a quarter ending strictly before now', () => {
    const r = lib.periodDateRange('last');
    assert.ok(r.end < new Date());
  });
  await t.test('unknown period returns an open-ended range', () => {
    const r = lib.periodDateRange('all-time-or-something');
    assert.ok(r.start.getFullYear() <= 1970);
    assert.ok(r.end.getFullYear() >= 9999);
  });
});

test('localDateISO', async (t) => {
  await t.test('formats a Date as YYYY-MM-DD', () => {
    const d = new Date(2026, 4, 1); // May 1, 2026 (month is 0-indexed)
    assert.equal(lib.localDateISO(d), '2026-05-01');
  });
  await t.test('zero-pads single-digit months and days', () => {
    const d = new Date(2026, 0, 5);
    assert.equal(lib.localDateISO(d), '2026-01-05');
  });
});

test('addBusinessDays', async (t) => {
  await t.test('returns a YYYY-MM-DD string', () => {
    const r = lib.addBusinessDays(1);
    assert.match(r, /^\d{4}-\d{2}-\d{2}$/);
  });
  await t.test('result is in the future', () => {
    const today = lib.localDateISO();
    assert.ok(lib.addBusinessDays(1) > today);
  });
  await t.test('skips weekends — 5 business days from Monday lands on next Monday', () => {
    // We can't pin "today" without injecting a clock, so prove the resulting
    // date never falls on Sat/Sun for any positive N up to 14.
    for (let n = 1; n <= 14; n++) {
      const r = lib.addBusinessDays(n);
      const [y, m, d] = r.split('-').map(Number);
      const dow = new Date(y, m - 1, d).getDay();
      assert.notEqual(dow, 0, `addBusinessDays(${n}) → ${r} fell on a Sunday`);
      assert.notEqual(dow, 6, `addBusinessDays(${n}) → ${r} fell on a Saturday`);
    }
  });
});

test('formatDueDate', async (t) => {
  await t.test('returns null for missing input', () => {
    assert.equal(lib.formatDueDate(null), null);
    assert.equal(lib.formatDueDate(''),   null);
  });
  await t.test('flags past dates as overdue', () => {
    const r = lib.formatDueDate('2000-01-01');
    assert.equal(r.urgency, 'overdue');
  });
  await t.test('flags today as today', () => {
    const r = lib.formatDueDate(lib.localDateISO());
    assert.equal(r.urgency, 'today');
    assert.equal(r.text, 'Today');
  });
  await t.test('flags tomorrow as soon', () => {
    const t = new Date(); t.setDate(t.getDate() + 1);
    const r = lib.formatDueDate(lib.localDateISO(t));
    assert.equal(r.urgency, 'soon');
    assert.equal(r.text, 'Tomorrow');
  });
  await t.test('future dates beyond tomorrow render with normal urgency', () => {
    const t = new Date(); t.setDate(t.getDate() + 10);
    const r = lib.formatDueDate(lib.localDateISO(t));
    assert.equal(r.urgency, 'normal');
  });
});

test('withClickGuard', async (t) => {
  await t.test('disables button while async work runs, re-enables after', async () => {
    const btn = { disabled: false };
    let resolved = false;
    const slow = async () => { await new Promise(r => setTimeout(r, 10)); resolved = true; };
    const guarded = lib.withClickGuard(slow);
    const promise = guarded({ currentTarget: btn });
    assert.equal(btn.disabled, true);
    await promise;
    assert.equal(resolved, true);
    assert.equal(btn.disabled, false);
  });
  await t.test('drops re-entrant calls while disabled', async () => {
    const btn = { disabled: true }; // already disabled
    let calls = 0;
    const guarded = lib.withClickGuard(async () => { calls++; });
    await guarded({ currentTarget: btn });
    assert.equal(calls, 0);
  });
});
